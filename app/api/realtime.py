import asyncio
import json
from datetime import UTC, datetime
from typing import Any, Protocol, cast

from fastapi import APIRouter, HTTPException, WebSocket
from fastapi.websockets import WebSocketDisconnect

from app.domain.agent import Agent
from app.domain.event import EventRecord
from app.domain.node import TopologyNode
from app.services.observer_data import (
    BufferedObserverEvent,
    ObserverRealtimeEvent,
    agent_detail_channel,
    agents_list_channel,
    get_observer_data_source,
    get_observer_data_source_name,
)

router = APIRouter()


class RealtimeObserverDataSource(Protocol):
    def get_agent(self, agent_id: str) -> Agent | None: ...

    def read_buffer(self, channel: str, *, last_seq: int | None = None) -> Any: ...

    def validate_realtime_channel(self, channel: str) -> None: ...

    def pump_realtime(self, channel: str) -> None: ...


@router.websocket("/ws/observer")
async def observer_websocket(websocket: WebSocket) -> None:
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
        data_source = cast(
            RealtimeObserverDataSource,
            get_observer_data_source(selected_data_source),
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
