import asyncio
import json
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from queue import Empty
from typing import Any, Protocol, cast
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, WebSocket
from fastapi.responses import StreamingResponse
from fastapi.websockets import WebSocketDisconnect

from app.domain.agent import Agent
from app.domain.event import EventRecord
from app.domain.node import TopologyNode
from app.db.session import get_session
from app.services.board_task_realtime import get_board_task_realtime_hub
from app.services.observer_data import (
    BufferedObserverEvent,
    ObserverRealtimeEvent,
    agent_detail_channel,
    agents_list_channel,
    get_observer_data_source_name,
)
from app.services.provider_application_service import (
    ProviderApplicationService,
    ProviderExecutionContext,
)
from app.services.realtime_access_service import RealtimeAccessService

router = APIRouter()


RealtimeOpenClawContext = ProviderExecutionContext


class RealtimeObserverDataSource(Protocol):
    def get_agent(self, agent_id: str) -> Agent | None: ...

    def read_buffer(self, channel: str, *, last_seq: int | None = None) -> Any: ...

    def validate_realtime_channel(self, channel: str) -> None: ...

    def pump_realtime(self, channel: str) -> None: ...


def get_provider_application_service(websocket: WebSocket) -> ProviderApplicationService:
    return cast(ProviderApplicationService, websocket.app.state.provider_application_service)


def get_realtime_access_service() -> RealtimeAccessService:
    return RealtimeAccessService()


def _resolve_realtime_data_source(
    provider_application_service: ProviderApplicationService,
    data_source_name: str,
    request_context: RealtimeOpenClawContext | None,
) -> RealtimeObserverDataSource:
    return cast(
        RealtimeObserverDataSource,
        provider_application_service.resolve_observer_data_source(
            data_source_name,
            request_context,
        ),
    )


@router.websocket("/ws/observer")
async def observer_websocket(
    websocket: WebSocket,
    provider_application_service: ProviderApplicationService = Depends(get_provider_application_service),
    realtime_access_service: RealtimeAccessService = Depends(get_realtime_access_service),
    db_session=Depends(get_session),
) -> None:
    await websocket.accept()
    channel = "unknown"

    try:
        message = await websocket.receive_json()

        if not _is_valid_subscribe_message(message):
            raise ValueError("Invalid subscribe message")

        channel = str(message["channel"])
        last_seq = _parse_last_seq(message.get("last_seq"))
        data_source_name = websocket.query_params.get("data_source")
        selected_data_source = get_observer_data_source_name(data_source_name)
        request_context = realtime_access_service.resolve_realtime_openclaw_context(
            db_session,
            websocket,
            data_source_name=selected_data_source,
            provider_application_service=provider_application_service,
        )
        data_source = _resolve_realtime_data_source(
            provider_application_service,
            selected_data_source,
            request_context,
        )

        data_source.validate_realtime_channel(channel)
        _validate_channel(channel, data_source)

        current_seq = _latest_seq(data_source, channel) if last_seq is None else last_seq
        if last_seq is not None:
            read_result = data_source.read_buffer(channel, last_seq=last_seq)
            if read_result.needs_resync:
                await _send_message(
                    websocket,
                    message_type="resync_required",
                    channel=channel,
                    seq=last_seq,
                    payload={"reason": "last_seq_out_of_window"},
                )
                return
        else:
            read_result = None

        await _send_message(
            websocket,
            message_type="snapshot_ready",
            channel=channel,
            seq=current_seq,
            payload={"status": "ok"},
        )

        if read_result is not None:
            for buffered_message in read_result.messages:
                await _send_buffered_event(websocket, buffered_message)
                current_seq = buffered_message.seq

        await _stream_channel_updates(websocket, data_source, channel, current_seq)
    except WebSocketDisconnect:
        return
    except Exception as exc:
        await _send_message(
            websocket,
            message_type="error",
            channel=channel,
            seq=0,
            payload={"detail": _error_detail(exc)},
        )
        await websocket.close(code=1008)


@router.get("/sse/boards/{board_id}/tasks", tags=["realtime"])
async def board_tasks_sse(
    request: Request,
    board_id: str,
    snapshot_only: bool = Query(default=False, alias="snapshotOnly"),
    instance_id: str | None = Query(default=None, alias="instanceId"),
    realtime_access_service: RealtimeAccessService = Depends(get_realtime_access_service),
    db_session=Depends(get_session),
) -> Response:
    normalized_board_id = board_id.strip() or "default"
    channel = f"board:{normalized_board_id}:tasks"
    current_user = realtime_access_service.resolve_http_realtime_user(db_session, request)
    resolved_instance_id = realtime_access_service.resolve_sse_instance_id(
        db_session,
        current_user=current_user,
        instance_id=instance_id,
    )
    hub = get_board_task_realtime_hub()

    base_headers = {
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
    }
    if snapshot_only:
        latest_seq = hub.latest_seq(
            user_id=current_user.id,
            board_id=normalized_board_id,
        )
        return Response(
            content=_to_sse_data(
                {
                    "type": "snapshot_ready",
                    "channel": channel,
                    "seq": latest_seq,
                    "timestamp": _timestamp(),
                    "payload": {"status": "ok"},
                }
            ),
            media_type="text/event-stream",
            headers=base_headers,
        )

    subscriber_id, subscriber_queue, latest_seq = hub.subscribe(
        user_id=current_user.id,
        board_id=normalized_board_id,
    )

    async def event_stream() -> AsyncIterator[str]:
        known_task_instances: dict[str, UUID | None] = {}
        try:
            yield _to_sse_data(
                {
                    "type": "snapshot_ready",
                    "channel": channel,
                    "seq": latest_seq,
                    "timestamp": _timestamp(),
                    "payload": {"status": "ok"},
                }
            )
            if snapshot_only:
                return

            while True:
                if await request.is_disconnected():
                    return
                try:
                    event = await asyncio.to_thread(subscriber_queue.get, True, 20.0)
                except Empty:
                    yield ": keep-alive\n\n"
                    continue
                if not _is_board_task_event_visible_for_instance(
                    cast(dict[str, Any], event),
                    instance_id=resolved_instance_id,
                    known_task_instances=known_task_instances,
                ):
                    continue
                yield _to_sse_data(event)
        finally:
            hub.unsubscribe(
                user_id=current_user.id,
                board_id=normalized_board_id,
                subscriber_id=subscriber_id,
            )

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers=base_headers,
    )


def _is_valid_subscribe_message(message: object) -> bool:
    if not isinstance(message, dict):
        return False
    if message.get("type") != "subscribe":
        return False

    channel = message.get("channel")
    if channel == agents_list_channel():
        return True

    if not isinstance(channel, str):
        return False

    if isinstance(channel, str) and channel.startswith("session:") and channel.endswith(":messages"):
        session_key = channel[len("session:"):-len(":messages")]
        return bool(session_key)

    if not channel.startswith("agent:") or not channel.endswith(":detail"):
        return False

    agent_id = channel[len("agent:") : -len(":detail")]
    return channel == agent_detail_channel(agent_id) and bool(agent_id)


def _parse_last_seq(value: object) -> int | None:
    if value is None:
        return None
    if not isinstance(value, int) or value < 0:
        raise ValueError("last_seq must be a non-negative integer")
    return value


def _validate_channel(channel: str, data_source: RealtimeObserverDataSource) -> None:
    if channel == agents_list_channel():
        return

    if channel.startswith("session:") and channel.endswith(":messages"):
        session_key = channel[len("session:") : -len(":messages")]
        if session_key:
            return

    agent_id = channel[len("agent:") : -len(":detail")]
    if data_source.get_agent(agent_id) is None:
        raise ValueError("Agent not found for detail channel")


def _latest_seq(data_source: RealtimeObserverDataSource, channel: str) -> int:
    messages = data_source.read_buffer(channel).messages
    if not messages:
        return 0
    return messages[-1].seq


async def _send_message(
    websocket: WebSocket,
    *,
    message_type: str,
    channel: str,
    seq: int,
    payload: dict[str, Any],
    timestamp: str | None = None,
) -> None:
    await websocket.send_text(
        json.dumps(
            {
                "type": message_type,
                "channel": channel,
                "seq": seq,
                "timestamp": timestamp or _timestamp(),
                "payload": payload,
            }
        )
    )


async def _send_buffered_event(websocket: WebSocket, message: BufferedObserverEvent) -> None:
    await _send_message(
        websocket,
        message_type=message.event.type,
        channel=message.channel,
        seq=message.seq,
        timestamp=_event_timestamp(message.event),
        payload=_event_payload(message.event),
    )


async def _stream_channel_updates(
    websocket: WebSocket,
    data_source: RealtimeObserverDataSource,
    channel: str,
    current_seq: int,
) -> None:
    while True:
        try:
            message = await asyncio.wait_for(websocket.receive(), timeout=0.1)
        except TimeoutError:
            message = None
        except WebSocketDisconnect:
            return

        if message is not None and message["type"] == "websocket.disconnect":
            return

        data_source.pump_realtime(channel)
        read_result = data_source.read_buffer(channel, last_seq=current_seq)
        if read_result.needs_resync:
            await _send_message(
                websocket,
                message_type="resync_required",
                channel=channel,
                seq=current_seq,
                payload={"reason": "last_seq_out_of_window"},
            )
            return

        for buffered_message in read_result.messages:
            await _send_buffered_event(websocket, buffered_message)
            current_seq = buffered_message.seq


def _event_payload(event: ObserverRealtimeEvent) -> dict[str, Any]:
    if event.type == "agent_summary_updated" and event.agent is not None:
        return {"agent": _serialize_agent(event.agent)}
    if event.type == "topology_updated" and event.agent_id is not None:
        return {
            "agent_id": event.agent_id,
            "nodes": [_serialize_node(node) for node in event.nodes],
        }
    if event.type == "node_events_appended" and event.agent_id is not None and event.node_id is not None:
        return {
            "agent_id": event.agent_id,
            "node_id": event.node_id,
            "events": [_serialize_event(item) for item in event.events],
        }
    if event.type == "session_messages_updated" and event.session_key is not None:
        payload = {
            "session_key": event.session_key,
            "messages": event.messages or [],
        }
        if isinstance(event.payload, dict):
            update_mode = event.payload.get("update_mode")
            if isinstance(update_mode, str):
                payload["update_mode"] = update_mode
        return payload
    return event.payload or {}


def _event_timestamp(event: ObserverRealtimeEvent) -> str:
    if event.events:
        return event.events[-1].timestamp
    if event.agent is not None and event.agent.last_active_at is not None:
        return event.agent.last_active_at
    if event.nodes:
        last_node = event.nodes[-1]
        if last_node.last_active_started_at is not None:
            return last_node.last_active_started_at
    return _timestamp()


def _serialize_agent(agent: Agent) -> dict[str, Any]:
    return {
        "id": agent.id,
        "name": agent.name,
        "status": agent.status.value,
        "is_active": agent.is_active,
        "last_active_at": agent.last_active_at,
    }


def _serialize_node(node: TopologyNode) -> dict[str, Any]:
    return {
        "id": node.id,
        "agent_id": node.agent_id,
        "name": node.name,
        "status": node.status.value,
        "is_active": node.is_active,
        "child_count": node.child_count,
        "parent_id": node.parent_id,
        "last_active_started_at": node.last_active_started_at,
    }


def _serialize_event(event: EventRecord) -> dict[str, Any]:
    return {
        "id": event.id,
        "node_id": event.node_id,
        "type": event.type.value,
        "timestamp": event.timestamp,
        "description": event.description,
    }


def _timestamp() -> str:
    return datetime.now(tz=UTC).isoformat().replace("+00:00", "Z")


def _error_detail(exc: Exception) -> str:
    if isinstance(exc, HTTPException):
        detail = exc.detail
        if isinstance(detail, str):
            return detail
        return json.dumps(detail)
    return str(exc)


def _is_board_task_event_visible_for_instance(
    event: dict[str, Any],
    *,
    instance_id: UUID | None,
    known_task_instances: dict[str, UUID | None],
) -> bool:
    if instance_id is None:
        return True
    if event.get("type") != "tasks_changed":
        return True

    payload = event.get("payload")
    if not isinstance(payload, dict):
        return False

    action = payload.get("action")
    if action == "upsert":
        task_payload = payload.get("task")
        if not isinstance(task_payload, dict):
            return False
        task_id = _extract_task_id(task_payload)
        task_instance_id = _extract_task_instance_id(task_payload)
        if task_id is not None:
            known_task_instances[task_id] = task_instance_id
        return task_instance_id == instance_id

    if action == "delete":
        task_id = _extract_task_id(payload)
        if task_id is None:
            return False
        task_instance_id = _extract_task_instance_id(payload)
        if task_instance_id is None:
            task_instance_id = known_task_instances.pop(task_id, None)
        else:
            known_task_instances.pop(task_id, None)
        if task_instance_id is None:
            return False
        return task_instance_id == instance_id

    return False


def _extract_task_id(payload: dict[str, Any]) -> str | None:
    raw_task_id = payload.get("id")
    if not isinstance(raw_task_id, str):
        raw_task_id = payload.get("task_id")
    if not isinstance(raw_task_id, str):
        raw_task_id = payload.get("taskId")
    if not isinstance(raw_task_id, str):
        return None
    task_id = raw_task_id.strip()
    return task_id or None


def _extract_task_instance_id(payload: dict[str, Any]) -> UUID | None:
    raw_instance_id = payload.get("instance_id")
    if raw_instance_id is None:
        raw_instance_id = payload.get("instanceId")
    if raw_instance_id is None:
        return None
    if isinstance(raw_instance_id, UUID):
        return raw_instance_id
    if not isinstance(raw_instance_id, str):
        return None
    candidate = raw_instance_id.strip()
    if candidate == "":
        return None
    try:
        return UUID(candidate)
    except ValueError:
        return None


def _to_sse_data(payload: dict[str, Any]) -> str:
    encoded = json.dumps(payload, ensure_ascii=False)
    return f"data: {encoded}\n\n"
