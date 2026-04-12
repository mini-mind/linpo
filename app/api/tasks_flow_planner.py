from __future__ import annotations

from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass
from datetime import UTC, datetime
import asyncio
import json
import logging
from queue import Empty
from threading import Lock, Thread, current_thread
import time
from typing import Any, cast
from urllib.parse import unquote
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, status
from fastapi.responses import Response, StreamingResponse
from sqlalchemy.orm import Session

from app.api.flow_planner_helpers import (
    _build_planner_node_operations,
    _flow_canvas_nodes_signature,
    _normalize_canvas_nodes,
    _normalize_flow_chat_role,
    _serialize_iso_datetime,
    _to_planner_node_draft_payload,
)
from app.api.schemas import (
    FlowCanvasEdge,
    FlowCanvasNode,
    FlowChatMessageItem,
    FlowGenerateRequest,
    FlowGenerateResponse,
    FlowPlannerNodeDeleteRequest,
    FlowPlannerNodeUpsertRequest,
    FlowPlannerSessionCompleteRequest,
    FlowPlannerSessionEventsRequest,
    FlowPlannerSessionEventsResponse,
    FlowPlannerSessionFailRequest,
    FlowPlannerSessionItem,
    FlowPlannerSessionProbeResponse,
    FlowPlannerStopRequest,
    FlowPlannerStopResponse,
)
from app.api.tasks_dependencies import (
    get_current_user,
    get_flow_decomposition_service,
    get_instance_service,
    get_provider_application_service,
)
from app.api.tasks_common import build_canvas_edges
from app.db.models import User
from app.db.session import get_database_url, get_engine, get_session
from app.services.flow_decomposition_service import FlowDecompositionService
from app.services.flow_canvas_service import resolve_layers as resolve_flow_canvas_layers
from app.services.instance_service import InstanceNotFoundError, InstanceService
from app.services.flow_planner_realtime import get_flow_planner_realtime_hub
from app.services.flow_planner_session_service import (
    FlowPlannerSessionService,
    get_flow_planner_session_service,
)
from app.services.planner_agent_preference_service import PlannerAgentPreferenceService
from app.services.provider_application_service import ProviderApplicationService, ProviderExecutionContext

router = APIRouter(prefix="/boards/{board_id}/tasks")
logger = logging.getLogger("uvicorn.error")

_FLOW_PLANNER_AGENT_ID = "planner"
_FLOW_PLANNER_SSE_PUSH_WAIT_SECONDS = 0.8
_FLOW_PLANNER_SSE_KEEPALIVE_SECONDS = 12.0
_FLOW_PLANNER_SSE_TERMINAL_DRAIN_SECONDS = 1.2
# 兼容保留：历史测试仍会 monkeypatch 这些常量，当前主链路不再使用。
_FLOW_PLANNER_SSE_SYNC_INTERVAL_SECONDS = 1.8
_FLOW_PLANNER_SSE_MISSING_SESSION_RETRY_TIMEOUT_SECONDS = 8.0
_FLOW_PLANNER_SSE_MISSING_SESSION_RETRY_AFTER_MS = 1500
_FLOW_GENERATE_SYNC_WAIT_TIMEOUT_SECONDS = 12.0
_FLOW_GENERATE_SYNC_POLL_INTERVAL_SECONDS = 0.8
_FLOW_PLANNER_OBSERVER_BRIDGE_IDLE_SLEEP_SECONDS = 0.2
_FLOW_PLANNER_OBSERVER_BRIDGE_MAX_SECONDS = 1800.0
_FLOW_PLANNER_STRUCTURED_STREAM_MAX_BUFFER_CHARS = 16384
_MISSING = object()
_ACTIVE_PLANNER_OBSERVER_BRIDGES: dict[str, Thread] = {}
_ACTIVE_PLANNER_OBSERVER_BRIDGES_LOCK = Lock()
_FLOW_PLANNER_SSE_SEQ_BY_CHANNEL: dict[tuple[str, str, str], int] = {}
_FLOW_PLANNER_SSE_SEQ_BY_CHANNEL_LOCK = Lock()
_FLOW_PLANNER_SESSION_WRITE_LOCKS: dict[tuple[str, str], Lock] = {}
_FLOW_PLANNER_SESSION_WRITE_LOCKS_LOCK = Lock()
_FLOW_PLANNER_INGEST_OWNER_BY_SESSION: dict[tuple[str, str], str] = {}
_FLOW_PLANNER_INGEST_OWNER_LOCK = Lock()
_FLOW_PLANNER_INGEST_OWNER_INTERNAL = "internal_callback"
_FLOW_PLANNER_INGEST_OWNER_OBSERVER = "observer_bridge"


def _planner_sse_channel_state_key(*, user_id: UUID, board_id: str, session_key: str) -> tuple[str, str, str]:
    return (
        str(user_id),
        board_id.strip() or "default",
        session_key.strip(),
    )


def _planner_board_session_key(*, board_id: str, session_key: str) -> tuple[str, str]:
    return (
        board_id.strip() or "default",
        session_key.strip(),
    )


def _get_planner_session_write_lock(*, board_id: str, session_key: str) -> Lock:
    coordination_key = _planner_board_session_key(board_id=board_id, session_key=session_key)
    with _FLOW_PLANNER_SESSION_WRITE_LOCKS_LOCK:
        lock = _FLOW_PLANNER_SESSION_WRITE_LOCKS.get(coordination_key)
        if lock is None:
            lock = Lock()
            _FLOW_PLANNER_SESSION_WRITE_LOCKS[coordination_key] = lock
        return lock


def _claim_planner_ingest_owner_for_internal(*, board_id: str, session_key: str) -> str | None:
    """
    单源仲裁：internal callback 始终拥有更高优先级。
    一旦 internal 抢占 owner，observer bridge 后续必须停止 ingest。
    """
    owner_key = _planner_board_session_key(board_id=board_id, session_key=session_key)
    with _FLOW_PLANNER_INGEST_OWNER_LOCK:
        previous_owner = _FLOW_PLANNER_INGEST_OWNER_BY_SESSION.get(owner_key)
        _FLOW_PLANNER_INGEST_OWNER_BY_SESSION[owner_key] = _FLOW_PLANNER_INGEST_OWNER_INTERNAL
        return previous_owner


def _observer_bridge_can_ingest(*, board_id: str, session_key: str) -> bool:
    """
    observer bridge 仅在“无 owner”或“owner 仍是 observer”时允许写入。
    若 internal 已成为 owner，必须立刻停写，避免双源并发落库。
    """
    owner_key = _planner_board_session_key(board_id=board_id, session_key=session_key)
    with _FLOW_PLANNER_INGEST_OWNER_LOCK:
        current_owner = _FLOW_PLANNER_INGEST_OWNER_BY_SESSION.get(owner_key)
        if current_owner is None:
            _FLOW_PLANNER_INGEST_OWNER_BY_SESSION[owner_key] = _FLOW_PLANNER_INGEST_OWNER_OBSERVER
            return True
        return current_owner == _FLOW_PLANNER_INGEST_OWNER_OBSERVER


def _require_session_board_matches(
    *,
    route_name: str,
    route_board_id: str,
    session_board_id: object,
    session_key: str,
) -> None:
    normalized_route_board_id = route_board_id.strip() or "default"
    normalized_session_board_id = str(session_board_id).strip() or "default"
    if normalized_route_board_id == normalized_session_board_id:
        return
    logger.error(
        "[planner.board_guard] board_mismatch route=%s route_board=%s session_board=%s session=%s",
        route_name,
        normalized_route_board_id,
        normalized_session_board_id,
        _short_session_key(session_key),
    )
    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail=(
            "planner session board mismatch: "
            f"route={normalized_route_board_id}, session={normalized_session_board_id}"
        ),
    )


def _require_internal_route_board_consistency(
    *,
    route_name: str,
    board_id: str,
    session_key: str,
    planner_token: str,
    db_session: Session,
    flow_planner_session_service: FlowPlannerSessionService,
) -> None:
    # internal 路由先按 token 读取会话，再校验 board 一致性，避免把事件写入错误看板。
    snapshot = flow_planner_session_service.get_snapshot_by_token(
        db_session=db_session,
        session_key=session_key,
        planner_token=planner_token,
    )
    _require_session_board_matches(
        route_name=route_name,
        route_board_id=board_id,
        session_board_id=getattr(snapshot, "board_id", ""),
        session_key=session_key,
    )


def _run_internal_route_mutation(
    *,
    route_name: str,
    board_id: str,
    session_key: str,
    planner_token: str,
    db_session: Session,
    flow_planner_session_service: FlowPlannerSessionService,
    write_operation: Callable[[str], Any],
) -> Any:
    """
    internal 写路由统一模板：board/session 校验 + 串行写锁 + 单源 owner 认领。
    约束：该模板只做编排，不改具体业务写入语义。
    """
    normalized_board_id = board_id.strip() or "default"
    normalized_session_key = unquote(session_key).strip()
    session_write_lock = _get_planner_session_write_lock(
        board_id=normalized_board_id,
        session_key=normalized_session_key,
    )
    with session_write_lock:
        _require_internal_route_board_consistency(
            route_name=route_name,
            board_id=normalized_board_id,
            session_key=normalized_session_key,
            planner_token=planner_token,
            db_session=db_session,
            flow_planner_session_service=flow_planner_session_service,
        )
        previous_owner = _claim_planner_ingest_owner_for_internal(
            board_id=normalized_board_id,
            session_key=normalized_session_key,
        )
        if previous_owner != _FLOW_PLANNER_INGEST_OWNER_INTERNAL:
            logger.info(
                "[planner.ingest_owner] internal_claimed board=%s session=%s previous=%s route=%s",
                normalized_board_id,
                _short_session_key(normalized_session_key),
                previous_owner or "<none>",
                route_name,
            )
        return write_operation(normalized_session_key)


def _seed_planner_sse_seq(*, channel_key: tuple[str, str, str], candidate: int) -> int:
    """
    为 SSE 序号建立“连接级起点”。
    规则：取 max(服务端已知序号, 客户端续传序号)。
    这样可保证同一进程内跨连接单调递增，不会因重连回到 0。
    """
    normalized_candidate = max(0, int(candidate))
    with _FLOW_PLANNER_SSE_SEQ_BY_CHANNEL_LOCK:
        current = _FLOW_PLANNER_SSE_SEQ_BY_CHANNEL.get(channel_key, 0)
        seeded = max(current, normalized_candidate)
        _FLOW_PLANNER_SSE_SEQ_BY_CHANNEL[channel_key] = seeded
        return seeded


def _next_planner_sse_seq(*, channel_key: tuple[str, str, str]) -> int:
    with _FLOW_PLANNER_SSE_SEQ_BY_CHANNEL_LOCK:
        next_seq = _FLOW_PLANNER_SSE_SEQ_BY_CHANNEL.get(channel_key, 0) + 1
        _FLOW_PLANNER_SSE_SEQ_BY_CHANNEL[channel_key] = next_seq
        return next_seq


def _short_session_key(value: str) -> str:
    normalized = value.strip()
    if normalized == "":
        return "<empty>"
    if len(normalized) <= 20:
        return normalized
    return f"{normalized[:10]}...{normalized[-8:]}"


def _short_token(value: str) -> str:
    normalized = value.strip()
    if normalized == "":
        return "<empty>"
    if len(normalized) <= 8:
        return normalized
    return f"{normalized[:4]}...{normalized[-4:]}"


@dataclass(frozen=True)
class _FlowNodeDraft:
    id: str
    title: str
    description: str
    depends_on: list[str]
    sensitive: bool


def _normalize_depends_on(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    output: list[str] = []
    for item in value:
        if not isinstance(item, str):
            continue
        normalized = item.strip()
        if normalized:
            output.append(normalized)
    return output


def _extract_observer_assistant_chunks(raw_messages: object) -> list[str]:
    if not isinstance(raw_messages, list):
        return []

    def _collect_text_chunks(value: object, output: list[str]) -> None:
        if isinstance(value, str):
            # 保留原始换行，供 JSONL 解析器判断“是否已形成完整一行事件”。
            # 仅过滤纯空白，避免把空 chunk 落库。
            if value.strip():
                output.append(value)
            return
        if isinstance(value, list):
            for child in value:
                _collect_text_chunks(child, output)
            return
        if not isinstance(value, dict):
            return
        for key in ("text", "delta", "content", "chunk", "message", "output_text"):
            _collect_text_chunks(value.get(key), output)
        for key in ("parts", "fragments", "items", "segments"):
            nested = value.get(key)
            if isinstance(nested, list):
                _collect_text_chunks(nested, output)

    chunks: list[str] = []
    for item in raw_messages:
        if not isinstance(item, dict):
            continue
        _collect_text_chunks(item, chunks)
    return chunks


_STREAM_EVENT_TYPES = {
    "assistant_delta",
    "tool_call_start",
    "tool_call_delta",
    "tool_call_end",
    "flow.nodes",
    "status",
    "error",
}
_TERMINAL_STREAM_STATUSES = {"completed", "failed", "stopped"}


def _normalize_stream_event(raw_event: object) -> dict[str, Any] | None:
    if not isinstance(raw_event, dict):
        return None
    event_type = str(raw_event.get("type", "")).strip()
    if event_type not in _STREAM_EVENT_TYPES:
        return None
    normalized: dict[str, Any] = {"type": event_type}
    payload = raw_event.get("payload")
    if isinstance(payload, dict):
        normalized["payload"] = dict(payload)
    content = str(raw_event.get("content", "")).strip()
    if content:
        normalized["content"] = content
    if event_type == "status":
        status_value = str(raw_event.get("status", "")).strip() or str(
            normalized.get("payload", {}).get("status", "") if isinstance(normalized.get("payload"), dict) else ""
        ).strip()
        if status_value:
            normalized["status"] = status_value
    return normalized


def _looks_like_json_event_envelope_start(value: str) -> bool:
    normalized = value.strip()
    if normalized == "":
        return False
    if normalized.startswith("{") or normalized.startswith("["):
        return True
    return any(token in normalized for token in ('"type"', '"events"'))


def _extract_structured_events_from_chunk(
    *,
    chunk: str,
    pending_buffer: str,
    structured_mode_locked: bool,
) -> tuple[list[dict[str, Any]], str, list[str], bool]:
    """
    从 assistant 流增量中提取事件信封（JSON Lines）。
    解析规则：
    - 每行一个 JSON 对象；对象可直接是 event，或包含 events: [...]。
    - 进入结构化锁后，无法解析/非事件行先进入 pending，避免过早 plain fallback。
    - 未进入结构化锁时，非结构化行按普通 assistant 文本透传。
    - 最后一行若不完整会进入 pending_buffer，等待下一批 chunk 补齐。
    """
    def _append_pending(base: str, line: str) -> str:
        return f"{base}\n{line}" if base else line

    def _collect_events_from_payload(payload: object) -> list[dict[str, Any]]:
        events: list[dict[str, Any]] = []
        if isinstance(payload, dict) and isinstance(payload.get("events"), list):
            for item in payload["events"]:
                normalized_event = _normalize_stream_event(item)
                if normalized_event is not None:
                    events.append(normalized_event)
            return events
        if isinstance(payload, list):
            for item in payload:
                normalized_event = _normalize_stream_event(item)
                if normalized_event is not None:
                    events.append(normalized_event)
            return events
        normalized_event = _normalize_stream_event(payload)
        if normalized_event is not None:
            events.append(normalized_event)
        return events

    def _decode_json_stream(buffer: str) -> tuple[list[object], str]:
        decoder = json.JSONDecoder()
        values: list[object] = []
        index = 0
        length = len(buffer)
        while index < length:
            while index < length and buffer[index].isspace():
                index += 1
            if index >= length:
                return values, ""
            try:
                parsed, end_index = decoder.raw_decode(buffer, index)
            except json.JSONDecodeError:
                return values, buffer[index:]
            values.append(parsed)
            index = end_index
        return values, ""

    combined = f"{pending_buffer}{chunk}"
    if combined == "":
        return [], "", [], structured_mode_locked

    lines = combined.splitlines()
    has_trailing_newline = combined.endswith("\n") or combined.endswith("\r")
    next_pending = ""
    if not has_trailing_newline and lines:
        next_pending = lines.pop()

    extracted_events: list[dict[str, Any]] = []
    plain_lines: list[str] = []
    next_structured_mode_locked = structured_mode_locked
    if next_pending.strip() and _looks_like_json_event_envelope_start(next_pending):
        # JSON 分片可能没有换行，整段会直接落入 pending；
        # 这里先上锁，防止后续误走 plain fallback。
        next_structured_mode_locked = True

    for line in lines:
        normalized_line = line.strip()
        if normalized_line == "":
            continue
        if normalized_line.startswith("```"):
            continue
        if not next_structured_mode_locked and _looks_like_json_event_envelope_start(normalized_line):
            # 状态机：识别到 JSON 事件信封起始后立刻上锁，避免半截结构化片段被误当 plain 文本。
            next_structured_mode_locked = True
        should_try_json = next_structured_mode_locked
        try:
            payload = json.loads(normalized_line) if should_try_json else None
        except json.JSONDecodeError:
            if should_try_json:
                # 关键：进入结构化模式后，半截 JSON 先缓存，不立刻降级成普通文本，避免碎片刷屏。
                next_pending = _append_pending(next_pending, normalized_line)
                next_structured_mode_locked = True
            else:
                plain_lines.append(normalized_line)
            continue

        if not should_try_json:
            plain_lines.append(normalized_line)
            continue
        normalized_events = _collect_events_from_payload(payload)
        if normalized_events:
            extracted_events.extend(normalized_events)
            # 锁定目的已经达成：成功还原结构化事件后释放锁，后续 chunk 可按需再次上锁。
            next_structured_mode_locked = False
            continue
        # 锁定期间不做 plain fallback；即使 JSON 解析成功但非事件，也先缓存等待后续片段补齐。
        next_pending = _append_pending(next_pending, normalized_line)
        next_structured_mode_locked = True

    if next_pending.strip():
        should_decode_pending = (
            next_structured_mode_locked
            or _looks_like_json_event_envelope_start(next_pending)
        )
        if should_decode_pending:
            parsed_values, remaining = _decode_json_stream(next_pending)
            rebuilt_events: list[dict[str, Any]] = []
            for value in parsed_values:
                rebuilt_events.extend(_collect_events_from_payload(value))
            extracted_events.extend(rebuilt_events)
            next_pending = remaining
            if rebuilt_events and not next_pending.strip():
                next_structured_mode_locked = False
            else:
                next_structured_mode_locked = bool(next_pending.strip()) or next_structured_mode_locked
        else:
            # 关键修复：普通文本流通常没有换行分隔，之前会被长期滞留在 pending，直到终态才一次性 flush。
            # 这里在“非结构化模式且不像 JSON 事件信封”时立即透传，保证前端实时看到 assistant 增量。
            plain_lines.append(next_pending.strip())
            next_pending = ""

    if len(next_pending) > _FLOW_PLANNER_STRUCTURED_STREAM_MAX_BUFFER_CHARS:
        # 异常场景保护：长期无法解码时，降级为单条文本并清空 buffer，避免无限累积。
        plain_lines.append(next_pending.strip())
        next_pending = ""
        next_structured_mode_locked = False

    return extracted_events, next_pending, plain_lines, next_structured_mode_locked


def _flush_pending_stream_buffer(pending_buffer: str) -> tuple[list[dict[str, Any]], list[str]]:
    """
    终态/收尾阶段主动冲刷残留分片：
    - 先按“单行 JSON 事件”尝试解析；
    - 解析失败再作为 assistant_delta 文本落库，保证不丢内容。
    """
    normalized = pending_buffer.strip()
    if normalized == "":
        return [], []
    decoder = json.JSONDecoder()
    parsed_events: list[dict[str, Any]] = []
    index = 0
    length = len(normalized)
    while index < length:
        while index < length and normalized[index].isspace():
            index += 1
        if index >= length:
            break
        try:
            parsed, end_index = decoder.raw_decode(normalized, index)
        except json.JSONDecodeError:
            # 兜底策略：尾部残片无法再补齐时按普通文本落库，确保内容不丢。
            return parsed_events, [normalized[index:]]
        index = end_index
        if isinstance(parsed, dict) and isinstance(parsed.get("events"), list):
            for item in parsed["events"]:
                normalized_event = _normalize_stream_event(item)
                if normalized_event is not None:
                    parsed_events.append(normalized_event)
            continue
        if isinstance(parsed, list):
            for item in parsed:
                normalized_event = _normalize_stream_event(item)
                if normalized_event is not None:
                    parsed_events.append(normalized_event)
            continue
        normalized_event = _normalize_stream_event(parsed)
        if normalized_event is not None:
            parsed_events.append(normalized_event)
        else:
            return parsed_events, [normalized]
    return parsed_events, []


def _build_nodes_progress_delta_from_flow_nodes_event(
    event_payload: object,
) -> dict[str, Any]:
    node_count: int | None = None
    if isinstance(event_payload, dict):
        nodes_value = event_payload.get("nodes")
        if isinstance(nodes_value, list):
            node_count = len(nodes_value)
    content = f"已更新流程节点（{node_count} 个）。" if node_count is not None else "已更新流程节点。"
    return {
        "type": "assistant_delta",
        "content": content,
        "payload": {
            "source": "observer_realtime_bridge",
            "transport": "flow_nodes_progress",
            "synthetic": True,
        },
    }


def _try_start_planner_observer_bridge(
    *,
    board_id: str,
    planner_session_key: str,
    planner_token: str,
    provider_application_service: ProviderApplicationService,
    execution_context: ProviderExecutionContext,
    provider_name: str,
    flow_planner_session_service: FlowPlannerSessionService,
) -> None:
    """
    将 provider realtime 的 session 消息主动桥接到 planner events。
    设计目标：不依赖 planner 主动回调，也能持续把 assistant 增量推给前端。
    """
    normalized_provider_name = provider_name.strip() or "openclaw"
    logger.info(
        "[planner.observer_bridge] requested board=%s session=%s provider=%s",
        board_id,
        _short_session_key(planner_session_key),
        normalized_provider_name,
    )
    if normalized_provider_name != "openclaw":
        logger.info(
            "[planner.observer_bridge] skipped_non_openclaw board=%s session=%s provider=%s",
            board_id,
            _short_session_key(planner_session_key),
            normalized_provider_name,
        )
        return

    if not _observer_bridge_can_ingest(board_id=board_id, session_key=planner_session_key):
        logger.info(
            "[planner.observer_bridge] skipped_owner_internal board=%s session=%s",
            board_id,
            _short_session_key(planner_session_key),
        )
        return

    bridge_key = f"{board_id}:{planner_session_key}"
    with _ACTIVE_PLANNER_OBSERVER_BRIDGES_LOCK:
        active = _ACTIVE_PLANNER_OBSERVER_BRIDGES.get(bridge_key)
        if active is not None and active.is_alive():
            logger.info(
                "[planner.observer_bridge] already_running board=%s session=%s thread=%s",
                board_id,
                _short_session_key(planner_session_key),
                active.name,
            )
            return

        def _run() -> None:
            channel = f"session:{planner_session_key}:messages"
            session_write_lock = _get_planner_session_write_lock(
                board_id=board_id,
                session_key=planner_session_key,
            )
            seq = 0
            started_at = time.monotonic()
            pending_stream_buffer = ""
            structured_mode_locked = False
            logger.info(
                "[planner.observer_bridge] thread_started board=%s session=%s channel=%s token=%s",
                board_id,
                _short_session_key(planner_session_key),
                channel,
                _short_token(planner_token),
            )
            try:
                try:
                    data_source = provider_application_service.resolve_observer_data_source(
                        normalized_provider_name,
                        execution_context,
                    )
                except Exception:
                    logger.exception(
                        "[planner.observer_bridge] resolve_datasource_failed board=%s session=%s",
                        board_id,
                        _short_session_key(planner_session_key),
                    )
                    return
                if not hasattr(data_source, "pump_realtime") or not hasattr(data_source, "read_buffer"):
                    logger.warning(
                        "[planner.observer_bridge] datasource_missing_api board=%s session=%s has_pump=%s has_read=%s",
                        board_id,
                        _short_session_key(planner_session_key),
                        hasattr(data_source, "pump_realtime"),
                        hasattr(data_source, "read_buffer"),
                    )
                    return

                while time.monotonic() - started_at < _FLOW_PLANNER_OBSERVER_BRIDGE_MAX_SECONDS:
                    if not _observer_bridge_can_ingest(board_id=board_id, session_key=planner_session_key):
                        logger.info(
                            "[planner.observer_bridge] stop_ingest_owner_internal board=%s session=%s seq=%s",
                            board_id,
                            _short_session_key(planner_session_key),
                            seq,
                        )
                        return
                    try:
                        data_source.pump_realtime(channel)
                        read_result = data_source.read_buffer(channel, last_seq=seq)
                    except Exception:
                        # 上游实时流短暂失败时不终止会话，等待下一轮重试。
                        logger.exception(
                            "[planner.observer_bridge] read_failed board=%s session=%s seq=%s",
                            board_id,
                            _short_session_key(planner_session_key),
                            seq,
                        )
                        time.sleep(_FLOW_PLANNER_OBSERVER_BRIDGE_IDLE_SLEEP_SECONDS)
                        continue

                    if bool(getattr(read_result, "needs_resync", False)):
                        logger.info(
                            "[planner.observer_bridge] needs_resync board=%s session=%s seq=%s",
                            board_id,
                            _short_session_key(planner_session_key),
                            seq,
                        )
                        latest = data_source.read_buffer(channel)
                        buffered = list(getattr(latest, "messages", []))
                        if buffered:
                            seq = int(getattr(buffered[-1], "seq", seq))
                            logger.info(
                                "[planner.observer_bridge] resync_seq_advanced board=%s session=%s seq=%s",
                                board_id,
                                _short_session_key(planner_session_key),
                                seq,
                            )
                        time.sleep(_FLOW_PLANNER_OBSERVER_BRIDGE_IDLE_SLEEP_SECONDS)
                        continue

                    buffered_messages = list(getattr(read_result, "messages", []))
                    if not buffered_messages:
                        logger.debug(
                            "[planner.observer_bridge] no_messages board=%s session=%s seq=%s",
                            board_id,
                            _short_session_key(planner_session_key),
                            seq,
                        )
                        time.sleep(_FLOW_PLANNER_OBSERVER_BRIDGE_IDLE_SLEEP_SECONDS)
                        continue

                    should_stop = False
                    logger.info(
                        "[planner.observer_bridge] batch_received board=%s session=%s size=%s seq=%s",
                        board_id,
                        _short_session_key(planner_session_key),
                        len(buffered_messages),
                        seq,
                    )
                    for buffered_message in buffered_messages:
                        seq = int(getattr(buffered_message, "seq", seq))
                        observer_event = getattr(buffered_message, "event", None)
                        if observer_event is None:
                            logger.warning(
                                "[planner.observer_bridge] skip_empty_event board=%s session=%s seq=%s",
                                board_id,
                                _short_session_key(planner_session_key),
                                seq,
                            )
                            continue
                        if str(getattr(observer_event, "type", "")) != "session_messages_updated":
                            logger.debug(
                                "[planner.observer_bridge] skip_type type=%s board=%s session=%s seq=%s",
                                str(getattr(observer_event, "type", "")),
                                board_id,
                                _short_session_key(planner_session_key),
                                seq,
                            )
                            continue
                        if str(getattr(observer_event, "session_key", "")) != planner_session_key:
                            logger.warning(
                                "[planner.observer_bridge] skip_session_mismatch board=%s expected=%s got=%s seq=%s",
                                board_id,
                                _short_session_key(planner_session_key),
                                _short_session_key(str(getattr(observer_event, "session_key", ""))),
                                seq,
                            )
                            continue

                        callback_events: list[dict[str, Any]] = []
                        emitted_assistant_delta_in_batch = False
                        for chunk in _extract_observer_assistant_chunks(getattr(observer_event, "messages", [])):
                            (
                                parsed_events,
                                pending_stream_buffer,
                                plain_lines,
                                structured_mode_locked,
                            ) = _extract_structured_events_from_chunk(
                                chunk=chunk,
                                pending_buffer=pending_stream_buffer,
                                structured_mode_locked=structured_mode_locked,
                            )
                            for parsed_event in parsed_events:
                                event_type = str(parsed_event.get("type", "")).strip()
                                payload = parsed_event.get("payload")
                                if event_type == "assistant_delta":
                                    emitted_assistant_delta_in_batch = True
                                if event_type == "flow.nodes" and not emitted_assistant_delta_in_batch:
                                    # 事件协议允许 planner 直接只发 flow.nodes/status。
                                    # 为保证前端“请求进行中可见反馈”，这里把节点更新映射成可读进度增量。
                                    callback_events.append(
                                        _build_nodes_progress_delta_from_flow_nodes_event(payload)
                                    )
                                    emitted_assistant_delta_in_batch = True
                                if isinstance(payload, dict):
                                    merged_payload = {
                                        "source": "observer_realtime_bridge",
                                        **payload,
                                    }
                                else:
                                    merged_payload = {"source": "observer_realtime_bridge"}
                                normalized_event = dict(parsed_event)
                                normalized_event["payload"] = merged_payload
                                callback_events.append(normalized_event)
                            for plain_text in plain_lines:
                                emitted_assistant_delta_in_batch = True
                                callback_events.append(
                                    {
                                        "type": "assistant_delta",
                                        "content": plain_text,
                                        "payload": {
                                            "source": "observer_realtime_bridge",
                                            "transport": "plain_text",
                                        },
                                    }
                                )

                        payload = getattr(observer_event, "payload", None)
                        payload_dict = payload if isinstance(payload, dict) else {}
                        for event_item in callback_events:
                            if str(event_item.get("type", "")).strip() != "status":
                                continue
                            status_value = str(event_item.get("status", "")).strip()
                            if status_value in _TERMINAL_STREAM_STATUSES:
                                should_stop = True
                        lifecycle_phase = str(payload_dict.get("lifecycle_phase", "")).strip()
                        terminal_status = str(payload_dict.get("status", "")).strip()
                        if terminal_status in _TERMINAL_STREAM_STATUSES:
                            callback_events.append(
                                {
                                    "type": "status",
                                    "status": terminal_status,
                                    "content": "规划完成" if terminal_status == "completed" else "规划失败",
                                    "payload": {
                                        "source": "observer_realtime_bridge",
                                        "lifecycle_phase": lifecycle_phase or None,
                                    },
                                }
                            )
                            should_stop = True

                        if should_stop and (pending_stream_buffer.strip() or structured_mode_locked):
                            # 终态收尾：锁定模式可能还攒着半截结构化片段，这里必须主动 flush，避免线程悬挂。
                            flushed_events, flushed_plain_lines = _flush_pending_stream_buffer(
                                pending_stream_buffer
                            )
                            pending_stream_buffer = ""
                            structured_mode_locked = False
                            for parsed_event in flushed_events:
                                parsed_payload = parsed_event.get("payload")
                                if isinstance(parsed_payload, dict):
                                    merged_payload = {
                                        "source": "observer_realtime_bridge",
                                        **parsed_payload,
                                    }
                                else:
                                    merged_payload = {"source": "observer_realtime_bridge"}
                                callback_events.append(
                                    {
                                        **parsed_event,
                                        "payload": merged_payload,
                                    }
                                )
                            for plain_text in flushed_plain_lines:
                                callback_events.append(
                                    {
                                        "type": "assistant_delta",
                                        "content": plain_text,
                                        "payload": {
                                            "source": "observer_realtime_bridge",
                                            "transport": "pending_buffer_flush",
                                        },
                                    }
                                )
                            # flush 可能产出 terminal status，需要在收尾后重新判定 should_stop。
                            for event_item in flushed_events:
                                if str(event_item.get("type", "")).strip() != "status":
                                    continue
                                status_value = str(event_item.get("status", "")).strip()
                                if status_value in _TERMINAL_STREAM_STATUSES:
                                    should_stop = True

                        if not callback_events:
                            logger.debug(
                                "[planner.observer_bridge] skip_empty_callback_events board=%s session=%s seq=%s",
                                board_id,
                                _short_session_key(planner_session_key),
                                seq,
                            )
                            continue

                        # 关键仲裁：observer 与 internal callback 共用同一把 session 写锁，
                        # 保证同一时刻只会有一个写入源落库，避免并发双写。
                        with session_write_lock:
                            if not _observer_bridge_can_ingest(board_id=board_id, session_key=planner_session_key):
                                logger.info(
                                    "[planner.observer_bridge] drop_batch_owner_internal_after_lock board=%s session=%s seq=%s count=%s",
                                    board_id,
                                    _short_session_key(planner_session_key),
                                    seq,
                                    len(callback_events),
                                )
                                return
                            with Session(get_engine(get_database_url())) as thread_db_session:
                                flow_planner_session_service.ingest_events_by_token(
                                    db_session=thread_db_session,
                                    session_key=planner_session_key,
                                    planner_token=planner_token,
                                    events=callback_events,
                                    publish_realtime=True,
                                )
                        logger.info(
                            "[planner.observer_bridge] ingested board=%s session=%s seq=%s count=%s terminal=%s",
                            board_id,
                            _short_session_key(planner_session_key),
                            seq,
                            len(callback_events),
                            should_stop,
                        )
                        if should_stop:
                            logger.info(
                                "[planner.observer_bridge] terminal_exit board=%s session=%s seq=%s",
                                board_id,
                                _short_session_key(planner_session_key),
                                seq,
                            )
                            return
                logger.warning(
                    "[planner.observer_bridge] timeout_exit board=%s session=%s elapsed=%.3f",
                    board_id,
                    _short_session_key(planner_session_key),
                    time.monotonic() - started_at,
                )
            finally:
                with _ACTIVE_PLANNER_OBSERVER_BRIDGES_LOCK:
                    existing = _ACTIVE_PLANNER_OBSERVER_BRIDGES.get(bridge_key)
                    if existing is not None and existing is current_thread():
                        _ACTIVE_PLANNER_OBSERVER_BRIDGES.pop(bridge_key, None)
                logger.info(
                    "[planner.observer_bridge] thread_closed board=%s session=%s",
                    board_id,
                    _short_session_key(planner_session_key),
                )

        bridge_thread = Thread(
            target=_run,
            name=f"planner-observer-bridge:{planner_session_key}",
            daemon=True,
        )
        _ACTIVE_PLANNER_OBSERVER_BRIDGES[bridge_key] = bridge_thread
        bridge_thread.start()
        logger.info(
            "[planner.observer_bridge] thread_spawned board=%s session=%s thread=%s",
            board_id,
            _short_session_key(planner_session_key),
            bridge_thread.name,
        )


def _require_snapshot_nodes(snapshot: object) -> list[dict[str, object]]:
    raw_nodes = getattr(snapshot, "nodes", _MISSING)
    if raw_nodes is _MISSING:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="planner snapshot missing required field: nodes",
        )
    if not isinstance(raw_nodes, list):
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="planner snapshot field nodes must be a list",
        )
    for index, item in enumerate(raw_nodes):
        if not isinstance(item, dict):
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"planner snapshot nodes[{index}] must be an object",
            )
    return cast(list[dict[str, object]], raw_nodes)


def _require_node_field(
    node: dict[str, object],
    *,
    index: int,
    field: str,
) -> object:
    value = node.get(field, _MISSING)
    if value is _MISSING:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"planner snapshot nodes[{index}] missing required field: {field}",
        )
    return value


def _require_node_depends_on(
    node: dict[str, object],
    *,
    index: int,
) -> list[str]:
    raw_depends_on = _require_node_field(node, index=index, field="depends_on")
    if not isinstance(raw_depends_on, list):
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"planner snapshot nodes[{index}] field depends_on must be a list",
        )
    return _normalize_depends_on(raw_depends_on)


def _resolve_flow_planner_agent_id(raw: str | None, *, default_agent_id: str) -> str:
    value = (raw or "").strip()
    if value == "":
        return default_agent_id
    return value


def _is_requesting_system_default_planner_agent(
    *,
    request_planner_agent_id: str,
    system_default_planner_agent_id: str,
) -> bool:
    if request_planner_agent_id == "":
        return False
    return request_planner_agent_id == system_default_planner_agent_id.strip()


def get_planner_agent_preference_service() -> PlannerAgentPreferenceService:
    return PlannerAgentPreferenceService()


def _validate_planner_agent_membership_if_available(
    *,
    provider_application_service: ProviderApplicationService,
    execution_context: ProviderExecutionContext,
    planner_agent_id: str,
    data_source_name: str = "openclaw",
) -> None:
    try:
        data_source = provider_application_service.resolve_observer_data_source(
            data_source_name,
            execution_context,
        )
        available_agent_ids = {
            str(agent.id).strip()
            for agent in data_source.list_agents()
            if str(agent.id).strip() != ""
        }
    except HTTPException as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="planner_agent_id validation failed: cannot read instance agents",
        ) from exc
    if not available_agent_ids:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="planner_agent_id validation failed: instance agents unavailable",
        )
    if planner_agent_id not in available_agent_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="planner_agent_id is not available in current instance",
        )


def _list_available_planner_agent_ids(
    *,
    provider_application_service: ProviderApplicationService,
    execution_context: ProviderExecutionContext,
    data_source_name: str = "openclaw",
) -> list[str]:
    data_source = provider_application_service.resolve_observer_data_source(
        data_source_name,
        execution_context,
    )
    available_agent_ids: list[str] = []
    seen_agent_ids: set[str] = set()
    for agent in data_source.list_agents():
        agent_id = str(agent.id).strip()
        if agent_id == "" or agent_id in seen_agent_ids:
            continue
        seen_agent_ids.add(agent_id)
        available_agent_ids.append(agent_id)
    return available_agent_ids


def _planner_snapshot_nodes_to_canvas_nodes(nodes: list[dict[str, object]]) -> list[FlowCanvasNode]:
    drafts = [
        _FlowNodeDraft(
            id=str(item.get("id", "")).strip(),
            title=str(item.get("title", "未命名节点")).strip() or "未命名节点",
            description=str(item.get("description", "")).strip(),
            depends_on=_normalize_depends_on(item.get("depends_on")),
            sensitive=bool(item.get("sensitive", False)),
        )
        for item in nodes
        if str(item.get("id", "")).strip() != ""
    ]

    return _build_canvas_nodes(drafts, agent_id=None)


def _is_retryable_flow_history_error(exc: HTTPException) -> bool:
    if exc.status_code != status.HTTP_404_NOT_FOUND:
        return False
    detail = str(exc.detail)
    return (
        "planner session not found" in detail
        or "planner snapshot not found" in detail
        or "history not found" in detail
    )


def _is_retryable_provider_sync_error(exc: Exception) -> bool:
    if isinstance(exc, HTTPException):
        if _is_retryable_flow_history_error(exc):
            return True
        return exc.status_code in {
            status.HTTP_408_REQUEST_TIMEOUT,
            status.HTTP_429_TOO_MANY_REQUESTS,
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            status.HTTP_502_BAD_GATEWAY,
            status.HTTP_503_SERVICE_UNAVAILABLE,
            status.HTTP_504_GATEWAY_TIMEOUT,
        }
    return isinstance(exc, (TimeoutError, ConnectionError))


def _sync_planner_snapshot_from_provider_history(
    *,
    db_session: Session,
    current_user: User,
    session_key: str,
    flow_decomposition_service: FlowDecompositionService,
    flow_planner_session_service: FlowPlannerSessionService,
    execution_context: ProviderExecutionContext | None = None,
    provider_name: str | None = None,
) -> None:
    # breaking: provider history 主动同步已下线，保留符号仅用于兼容测试桩。
    del db_session
    del current_user
    del session_key
    del flow_decomposition_service
    del flow_planner_session_service
    del execution_context
    del provider_name


def _poll_planner_canvas_nodes_with_active_sync(
    *,
    db_session: Session,
    current_user: User,
    session_key: str,
    flow_decomposition_service: FlowDecompositionService,
    flow_planner_session_service: FlowPlannerSessionService,
    execution_context: ProviderExecutionContext,
    provider_name: str,
) -> tuple[list[FlowCanvasNode], object, bool]:
    # breaking: generate 改为 dispatch 后直接返回当前快照，轮询逻辑仅做兼容保留。
    snapshot = flow_planner_session_service.get_snapshot_for_user(
        db_session=db_session,
        user_id=current_user.id,
        session_key=session_key,
    )
    del flow_decomposition_service
    del execution_context
    del provider_name
    return _planner_snapshot_to_canvas_nodes(snapshot), snapshot, False


def _planner_snapshot_to_messages(snapshot: object) -> list[FlowChatMessageItem]:
    raw_messages = getattr(snapshot, "messages", [])
    parsed_messages: list[FlowChatMessageItem] = []
    if not isinstance(raw_messages, list):
        return parsed_messages
    for item in raw_messages:
        raw_message = item.to_payload() if hasattr(item, "to_payload") else item
        if not isinstance(raw_message, dict):
            continue
        role = _normalize_flow_chat_role(raw_message.get("role", "assistant"))
        kind = str(raw_message.get("kind", "message")).strip() or "message"
        content = str(raw_message.get("content", "")).strip()
        payload = raw_message.get("payload")
        normalized_payload = payload if isinstance(payload, dict) else {}
        created_at = str(raw_message.get("created_at", "")).strip() or datetime.now(tz=UTC).isoformat()
        if content == "" and kind == "message":
            continue
        parsed_messages.append(
            FlowChatMessageItem(
                role=role,
                content=content,
                kind=kind,
                payload=cast(dict[str, Any], normalized_payload),
                created_at=created_at,
            )
        )
    return parsed_messages


def _planner_snapshot_to_canvas_nodes(snapshot: object) -> list[FlowCanvasNode]:
    raw_nodes = _require_snapshot_nodes(snapshot)
    canvas_nodes: list[FlowCanvasNode] = []
    drafts: list[_FlowNodeDraft] = []
    for index, item in enumerate(raw_nodes):
        node_id = str(_require_node_field(item, index=index, field="id")).strip()
        if node_id == "":
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"planner snapshot nodes[{index}] field id must be non-empty",
            )
        title = str(_require_node_field(item, index=index, field="title")).strip() or "未命名节点"
        depends_on = _require_node_depends_on(item, index=index)
        description = str(_require_node_field(item, index=index, field="description")).strip()
        sensitive = bool(_require_node_field(item, index=index, field="sensitive"))
        if all(key in item for key in ("x", "y", "layer", "status")):
            explicit_agent_id = str(item.get("agent_id", "")).strip() or None
            canvas_nodes.append(
                FlowCanvasNode(
                    id=node_id,
                    title=title,
                    description=description,
                    depends_on=depends_on,
                    x=float(item.get("x", 160.0)),
                    y=float(item.get("y", 120.0)),
                    layer=int(item.get("layer", 1)),
                    sensitive=sensitive,
                    status=str(item.get("status", "queued")).strip() or "queued",
                    agent_id=explicit_agent_id,
                )
            )
            continue
        drafts.append(
            _FlowNodeDraft(
                id=node_id,
                title=title,
                description=description,
                depends_on=depends_on,
                sensitive=sensitive,
            )
        )
    if canvas_nodes:
        return canvas_nodes
    return _build_canvas_nodes(drafts, agent_id=None)


def _to_sse_data(payload: dict[str, object]) -> str:
    event_id: int | None = None
    raw_seq = payload.get("seq")
    try:
        if raw_seq is not None:
            event_id = int(raw_seq)
    except (TypeError, ValueError):
        event_id = None
    serialized = f"data: {json.dumps(_camelize_payload_keys(payload), ensure_ascii=False)}\n\n"
    if event_id is None:
        return serialized
    return f"id: {event_id}\n{serialized}"


def _normalize_sse_chat_messages(messages_raw: object) -> list[dict[str, Any]]:
    if not isinstance(messages_raw, list):
        return []
    normalized: list[dict[str, Any]] = []
    for item in messages_raw:
        if not isinstance(item, dict):
            continue
        kind = str(item.get("kind", "message")).strip() or "message"
        content = str(item.get("content", "")).strip()
        if content == "" and kind == "message":
            continue
        role = _normalize_flow_chat_role(item.get("role", "assistant"))
        created_at = str(item.get("created_at", "")).strip() or datetime.now(tz=UTC).isoformat()
        payload = item.get("payload")
        normalized_payload = payload if isinstance(payload, dict) else {}
        normalized.append(
            {
                "role": role,
                "kind": kind,
                "content": content,
                "payload": normalized_payload,
                "created_at": created_at,
            }
        )
    return normalized


def _flow_chat_messages_payload_signature(messages: list[dict[str, Any]]) -> str:
    return json.dumps(messages, ensure_ascii=False, separators=(",", ":"))


def _resolve_planner_messages_update_payload(
    *,
    session_key: str,
    previous_messages: list[dict[str, Any]],
    next_messages: list[dict[str, Any]],
    requested_update_mode: object | None = None,
    requested_append_chunk: object | None = None,
) -> dict[str, object]:
    payload: dict[str, object] = {
        "session_key": session_key,
        "messages": [dict(item) for item in next_messages],
        "update_mode": "replace",
    }
    normalized_update_mode = requested_update_mode.strip() if isinstance(requested_update_mode, str) else ""
    if normalized_update_mode not in {"replace", "append_chunk"}:
        normalized_update_mode = ""

    if normalized_update_mode == "append_chunk":
        append_chunk = _normalize_sse_chat_messages(requested_append_chunk)
        if append_chunk:
            payload["update_mode"] = "append_chunk"
            payload["append_chunk"] = [dict(item) for item in append_chunk]
            return payload

    is_append = (
        len(next_messages) > len(previous_messages)
        and next_messages[: len(previous_messages)] == previous_messages
    )
    if is_append:
        payload["update_mode"] = "append_chunk"
        payload["append_chunk"] = [dict(item) for item in next_messages[len(previous_messages):]]
    return payload


def _camelize_key(value: str) -> str:
    if "_" not in value:
        return value
    head, *tail = value.split("_")
    return head + "".join(part.capitalize() for part in tail)


def _camelize_payload_keys(value: object) -> object:
    if isinstance(value, dict):
        return {
            _camelize_key(str(key)): _camelize_payload_keys(item)
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [_camelize_payload_keys(item) for item in value]
    return value


def _build_canvas_edges(nodes: list[_FlowNodeDraft]) -> list[FlowCanvasEdge]:
    node_ids = {node.id for node in nodes}
    return build_canvas_edges(
        node_pairs=((node.id, node.depends_on) for node in nodes),
        known_node_ids=node_ids,
        deduplicate=True,
    )


def _build_execution_context_or_404(
    *,
    db_session: Session,
    current_user: User,
    instance_id: UUID,
    instance_service: InstanceService,
    provider_application_service: ProviderApplicationService,
) -> ProviderExecutionContext:
    try:
        instance_context = instance_service.get_openclaw_context(
            db_session,
            user_id=current_user.id,
            instance_id=instance_id,
        )
    except InstanceNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Instance not found") from exc
    return provider_application_service.build_execution_context(instance_context)


def _resolve_requested_or_default_instance_id(
    *,
    raw_instance_id: str | None,
    db_session: Session,
    current_user: User,
    instance_service: InstanceService,
) -> UUID:
    normalized = (raw_instance_id or "").strip()
    if normalized != "":
        try:
            requested_instance_id = UUID(normalized)
            instance_service.get_openclaw_context(
                db_session,
                user_id=current_user.id,
                instance_id=requested_instance_id,
            )
            return requested_instance_id
        except (ValueError, InstanceNotFoundError):
            pass

    instances = instance_service.list_instances(
        db_session,
        user_id=current_user.id,
    )
    if not instances:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Instance not found")
    return instances[0].id


def _build_canvas_nodes(
    nodes: list[_FlowNodeDraft],
    *,
    agent_id: str | None,
) -> list[FlowCanvasNode]:
    layers = resolve_flow_canvas_layers(
        node_ids=[node.id for node in nodes],
        depends_on_by_node={node.id: node.depends_on for node in nodes},
        on_cycle="append_unresolved",
    )
    layer_index_map: dict[str, int] = {}
    for idx, layer in enumerate(layers):
        for node_id in layer:
            layer_index_map[node_id] = idx + 1

    vertical_gap = 120.0
    horizontal_gap = 220.0
    lane_start_x = 100.0
    top_y = 120.0

    output: list[FlowCanvasNode] = []
    for idx, node in enumerate(nodes):
        layer = layer_index_map.get(node.id, 1)
        y = top_y + idx * vertical_gap
        x = lane_start_x + (layer - 1) * horizontal_gap
        output.append(
            FlowCanvasNode(
                id=node.id,
                title=node.title,
                description=node.description,
                depends_on=[dependency for dependency in node.depends_on if dependency in layer_index_map],
                x=x,
                y=y,
                layer=layer,
                sensitive=node.sensitive,
                status="queued",
                agent_id=agent_id or None,
            )
        )
    return output


def _build_structured_fallback_canvas_nodes(
    *,
    requirement: str,
    executor_agent_id: str,
) -> list[FlowCanvasNode]:
    normalized_requirement = requirement.strip()
    intake_id = f"node_fallback_intake_{uuid4().hex[:6]}"
    execute_id = f"node_fallback_execute_{uuid4().hex[:6]}"
    intake_description = (
        "梳理需求与运行约束，明确输入/输出文件路径、验收标准与风险。"
    )
    execution_requirement = normalized_requirement if normalized_requirement != "" else "按已确认的需求执行"
    execute_description = (
        f"任务目标：{execution_requirement}。"
        "输入：读取上游节点确认后的需求与约束。"
        "输出：至少产出 1 个可下载结果文件（建议 markdown/json）。"
        "验收：结果文件可预览、与目标一致。"
        "失败条件：无法产出有效结果文件时需 failed 并说明原因。"
    )
    drafts = [
        _FlowNodeDraft(
            id=intake_id,
            title="梳理需求与约束（自动兜底）",
            description=intake_description,
            depends_on=[],
            sensitive=False,
        ),
        _FlowNodeDraft(
            id=execute_id,
            title="执行需求并产出结果（自动兜底）",
            description=execute_description,
            depends_on=[intake_id],
            sensitive=True,
        ),
    ]
    return _build_canvas_nodes(
        drafts,
        agent_id=executor_agent_id.strip() or None,
    )


@router.post("/flow/generate", response_model=FlowGenerateResponse, tags=["flow"])
def generate_flow(
    board_id: str,
    payload: FlowGenerateRequest,
    db_session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
    flow_decomposition_service: FlowDecompositionService = Depends(get_flow_decomposition_service),
    instance_service: InstanceService = Depends(get_instance_service),
    provider_application_service: ProviderApplicationService = Depends(get_provider_application_service),
    flow_planner_session_service: FlowPlannerSessionService = Depends(get_flow_planner_session_service),
    planner_agent_preference_service: PlannerAgentPreferenceService = Depends(get_planner_agent_preference_service),
) -> FlowGenerateResponse:
    normalized_board_id = board_id.strip() or "default"
    requirement = payload.requirement.strip()
    logger.info(
        "[planner.generate] request_received board=%s user_id=%s requirement_len=%s session_key=%s",
        normalized_board_id,
        current_user.id,
        len(requirement),
        _short_session_key(str(payload.planner_session_key or "")),
    )
    if not requirement:
        logger.warning(
            "[planner.generate] invalid_request_missing_requirement board=%s user_id=%s",
            normalized_board_id,
            current_user.id,
        )
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="requirement is required")
    normalized_current_nodes = _normalize_canvas_nodes(
        nodes=payload.current_nodes,
        edges=payload.current_edges,
    )
    instance_uuid = _resolve_requested_or_default_instance_id(
        raw_instance_id=payload.instance_id,
        db_session=db_session,
        current_user=current_user,
        instance_service=instance_service,
    )
    execution_context = _build_execution_context_or_404(
        db_session=db_session,
        current_user=current_user,
        instance_id=instance_uuid,
        instance_service=instance_service,
        provider_application_service=provider_application_service,
    )
    # Planner agent should be selected/validated against the decomposition runtime
    # (FLOW_DECOMPOSITION_*), not the task execution instance runtime.
    planner_selection_execution_context = execution_context
    planner_selection_data_source_name = "openclaw"
    try:
        planner_selection_data_source_name = flow_decomposition_service.decomposition_provider_name().strip() or "openclaw"
        planner_selection_execution_context = flow_decomposition_service.build_realtime_execution_context()
    except HTTPException:
        planner_selection_execution_context = execution_context
    persisted_planner_agent_id = planner_agent_preference_service.get_for_instance(
        db_session,
        user_id=current_user.id,
        instance_id=instance_uuid,
    )
    request_planner_agent_id = (
        payload.planner_agent_id.strip()
        if isinstance(payload.planner_agent_id, str)
        else ""
    )
    has_explicit_request_planner_agent = request_planner_agent_id != ""
    normalized_persisted_planner_agent_id = (
        persisted_planner_agent_id.strip()
        if isinstance(persisted_planner_agent_id, str)
        else ""
    )
    system_default_planner_agent_id = flow_decomposition_service.resolve_planner_agent_id(None)
    if has_explicit_request_planner_agent:
        planner_agent_id = _resolve_flow_planner_agent_id(
            request_planner_agent_id,
            default_agent_id=system_default_planner_agent_id,
        )
    elif normalized_persisted_planner_agent_id != "":
        planner_agent_id = normalized_persisted_planner_agent_id
    else:
        # Default planner agent is `main`; fallback to available runtime agent
        # only when implicit default selection is unavailable.
        planner_agent_id = system_default_planner_agent_id
    if planner_agent_id:
        try:
            _validate_planner_agent_membership_if_available(
                provider_application_service=provider_application_service,
                execution_context=planner_selection_execution_context,
                planner_agent_id=planner_agent_id,
                data_source_name=planner_selection_data_source_name,
            )
        except HTTPException as exc:
            # Keep strict validation for explicit planner_agent_id from user request.
            # For implicit planner selection (persisted preference or default `main`), fallback to
            # first available planner when the chosen one is stale. Explicit request only gets
            # this fallback when it equals the system default planner agent.
            if (
                exc.status_code == status.HTTP_400_BAD_REQUEST
                and (
                    not has_explicit_request_planner_agent
                    or _is_requesting_system_default_planner_agent(
                        request_planner_agent_id=request_planner_agent_id,
                        system_default_planner_agent_id=system_default_planner_agent_id,
                    )
                )
            ):
                available_agent_ids = _list_available_planner_agent_ids(
                    provider_application_service=provider_application_service,
                    execution_context=planner_selection_execution_context,
                    data_source_name=planner_selection_data_source_name,
                )
                if available_agent_ids:
                    planner_agent_id = available_agent_ids[0]
                else:
                    raise
            else:
                raise

    provisional_session_key = (
        payload.planner_session_key.strip()
        if isinstance(payload.planner_session_key, str) and payload.planner_session_key.strip()
        else f"linpo:flow:{normalized_board_id}:planner:{planner_agent_id}:{uuid4().hex[:8]}"
    )
    session_record = flow_planner_session_service.ensure_session(
        db_session,
        user_id=current_user.id,
        board_id=normalized_board_id,
        planner_session_key=provisional_session_key,
        planner_agent_id=planner_agent_id,
        instance_id=instance_uuid,
        flow_name=(payload.flow_name or "").strip() or "未命名流程",
        current_nodes=[node.model_dump(mode="json") for node in normalized_current_nodes],
    )
    flow_planner_session_service.append_message(
        db_session=db_session,
        session_key=session_record.session_key,
        role="user",
        kind="instruction",
        content=requirement,
        payload={
            "flow_name": (payload.flow_name or "").strip() or "未命名流程",
            "current_node_count": len(normalized_current_nodes),
        },
    )

    try:
        dispatch = flow_decomposition_service.dispatch_planner(
            requirement=requirement,
            board_id=normalized_board_id,
            planner_agent_id=planner_agent_id,
            planner_session_key=session_record.session_key,
            flow_name=payload.flow_name,
            current_nodes=[node.model_dump(mode="json") for node in normalized_current_nodes],
            current_edges=[edge.model_dump(mode="json") for edge in payload.current_edges],
            prompt_history=flow_planner_session_service.prompt_history(
                db_session=db_session,
                session_key=session_record.session_key,
            ),
            execution_context=execution_context,
            provider_name=flow_decomposition_service.decomposition_provider_name(),
        )
        logger.info(
            "[planner.generate] dispatch_ok board=%s session=%s planner_agent=%s",
            normalized_board_id,
            _short_session_key(session_record.session_key),
            planner_agent_id,
        )
    except HTTPException as exc:
        logger.exception(
            "[planner.generate] dispatch_failed board=%s session=%s status=%s detail=%s",
            normalized_board_id,
            _short_session_key(session_record.session_key),
            exc.status_code,
            exc.detail,
        )
        flow_planner_session_service.fail_session(
            session_key=session_record.session_key,
            reason=str(exc.detail),
            payload={"origin": "dispatch_error"},
            db_session=db_session,
            publish_realtime=True,
        )
        raise
    planner_session_key = dispatch.planner_session_key
    if planner_session_key != session_record.session_key:
        logger.error(
            "[planner.generate] dispatch_session_mismatch board=%s expected=%s got=%s",
            normalized_board_id,
            _short_session_key(session_record.session_key),
            _short_session_key(planner_session_key),
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="planner dispatch returned mismatched session key",
        )
    _try_start_planner_observer_bridge(
        board_id=normalized_board_id,
        planner_session_key=planner_session_key,
        planner_token=session_record.planner_token,
        provider_application_service=provider_application_service,
        execution_context=execution_context,
        provider_name=flow_decomposition_service.decomposition_provider_name(),
        flow_planner_session_service=flow_planner_session_service,
    )
    manager_session_key = f"linpo:flow:{normalized_board_id}:manager"
    execution_session_prefix = f"linpo:flow:{normalized_board_id}:exec"
    latest_snapshot = flow_planner_session_service.get_snapshot_for_user(
        db_session=db_session,
        user_id=current_user.id,
        session_key=planner_session_key,
    )
    logger.info(
        "[planner.generate] response_ready board=%s session=%s status=%s revision=%s nodes=%s messages=%s",
        normalized_board_id,
        _short_session_key(planner_session_key),
        getattr(latest_snapshot, "status", "<unknown>"),
        getattr(latest_snapshot, "revision", "<unknown>"),
        len(getattr(latest_snapshot, "nodes", []) if isinstance(getattr(latest_snapshot, "nodes", []), list) else []),
        len(getattr(latest_snapshot, "messages", []) if isinstance(getattr(latest_snapshot, "messages", []), list) else []),
    )
    # breaking: generate 只做会话创建与 planner 派发；节点与回复均由 assistant 事件流驱动。
    canvas_nodes = _planner_snapshot_to_canvas_nodes(latest_snapshot)
    messages = _planner_snapshot_to_messages(latest_snapshot)
    canvas_edges = _build_canvas_edges(
        [
            _FlowNodeDraft(
                id=node.id,
                title=node.title,
                description=(node.description or "").strip(),
                depends_on=node.depends_on,
                sensitive=node.sensitive,
            )
            for node in canvas_nodes
        ]
    )

    return FlowGenerateResponse(
        board_id=normalized_board_id,
        planner_session_key=planner_session_key,
        manager_session_key=manager_session_key,
        execution_session_prefix=execution_session_prefix,
        nodes=canvas_nodes,
        edges=canvas_edges,
        messages=messages,
        created_task_ids=[],
    )


@router.get("/flow/planner-sessions/{session_key}/exists", response_model=FlowPlannerSessionProbeResponse, tags=["flow"])
def probe_flow_planner_session_exists(
    board_id: str,
    session_key: str,
    db_session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
    flow_planner_session_service: FlowPlannerSessionService = Depends(get_flow_planner_session_service),
) -> FlowPlannerSessionProbeResponse:
    del board_id
    normalized_session_key = session_key.strip()
    logger.info(
        "[planner.probe] request user_id=%s session=%s",
        current_user.id,
        _short_session_key(normalized_session_key),
    )
    if normalized_session_key == "":
        logger.info("[planner.probe] empty_session_false")
        return FlowPlannerSessionProbeResponse(exists=False)
    try:
        flow_planner_session_service.get_snapshot_for_user(
            db_session=db_session,
            user_id=current_user.id,
            session_key=normalized_session_key,
        )
    except HTTPException as exc:
        if exc.status_code == status.HTTP_404_NOT_FOUND:
            logger.info(
                "[planner.probe] session_not_found user_id=%s session=%s",
                current_user.id,
                _short_session_key(normalized_session_key),
            )
            return FlowPlannerSessionProbeResponse(exists=False)
        raise
    logger.info(
        "[planner.probe] session_exists user_id=%s session=%s",
        current_user.id,
        _short_session_key(normalized_session_key),
    )
    return FlowPlannerSessionProbeResponse(exists=True)


@router.get("/flow/planner-sse", response_model=None, tags=["flow"])
async def flow_planner_sse(
    board_id: str,
    request: Request,
    session_key: str = Query(alias="sessionKey"),
    snapshot_only: bool = Query(default=False, alias="snapshotOnly"),
    last_seq: int | None = Query(default=None, alias="last_seq"),
    last_event_id: str | None = Header(default=None, alias="Last-Event-ID"),
    db_session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
    flow_planner_session_service: FlowPlannerSessionService = Depends(get_flow_planner_session_service),
) -> Response:
    normalized_board_id = board_id.strip() or "default"
    normalized_session_key = session_key.strip()
    logger.info(
        "[planner.sse] connect board=%s session=%s snapshot_only=%s user_id=%s",
        normalized_board_id,
        _short_session_key(normalized_session_key),
        snapshot_only,
        current_user.id,
    )
    if normalized_session_key == "":
        logger.warning(
            "[planner.sse] invalid_missing_session_key board=%s user_id=%s",
            normalized_board_id,
            current_user.id,
        )
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="sessionKey is required")

    channel = f"session:{normalized_session_key}:messages"
    channel_state_key = _planner_sse_channel_state_key(
        user_id=current_user.id,
        board_id=normalized_board_id,
        session_key=normalized_session_key,
    )
    realtime_hub = get_flow_planner_realtime_hub()
    headers = {
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
    }

    def _safe_int(value: object, *, default: int = 0) -> int:
        try:
            return int(value)
        except (TypeError, ValueError):
            return default

    def _resolve_resume_seq() -> int:
        """
        续传优先级约束：
        1) 先读 Last-Event-ID（SSE 标准断线重连字段）
        2) header 无效/缺失时，再读 query `last_seq`
        """
        if isinstance(last_event_id, str):
            parsed_header_seq = _safe_int(last_event_id.strip(), default=-1)
            if parsed_header_seq >= 0:
                return parsed_header_seq
        if last_seq is None:
            return 0
        return max(0, _safe_int(last_seq, default=0))

    requested_resume_seq = _resolve_resume_seq()
    logger.info(
        "[planner.sse] resume_cursor board=%s session=%s last_event_id=%s last_seq=%s resolved=%s",
        normalized_board_id,
        _short_session_key(normalized_session_key),
        (last_event_id.strip() if isinstance(last_event_id, str) else "<none>"),
        last_seq,
        requested_resume_seq,
    )

    def _build_pending_events(*, next_seq: Callable[[], int]) -> list[str]:
        now = datetime.now(tz=UTC).isoformat()
        return [
            _to_sse_data(
                {
                    "type": "snapshot_ready",
                    "channel": channel,
                    "seq": next_seq(),
                    "timestamp": now,
                    "payload": {"status": "pending"},
                }
            ),
            _to_sse_data(
                {
                    "type": "planner_session_updated",
                    "channel": channel,
                    "seq": next_seq(),
                    "timestamp": now,
                    "payload": {
                        "session_key": normalized_session_key,
                        "status": "planning",
                        "revision": 0,
                        "updated_at": now,
                        "last_error": "planner session not found",
                    },
                }
            ),
        ]

    def build_snapshot_events(*, snapshot_value: object, next_seq: Callable[[], int]) -> list[str]:
        snapshot_messages = [item.model_dump(mode="json") for item in _planner_snapshot_to_messages(snapshot_value)]
        snapshot_nodes = _planner_snapshot_to_canvas_nodes(snapshot_value)
        return [
            _to_sse_data(
                {
                    "type": "snapshot_ready",
                    "channel": channel,
                    "seq": next_seq(),
                    "timestamp": datetime.now(tz=UTC).isoformat(),
                    "payload": {"status": "ok"},
                }
            ),
            _to_sse_data(
                {
                    "type": "planner_session_updated",
                    "channel": channel,
                    "seq": next_seq(),
                    "timestamp": datetime.now(tz=UTC).isoformat(),
                    "payload": {
                        "session_key": getattr(snapshot_value, "session_key"),
                        "status": getattr(snapshot_value, "status"),
                        "revision": getattr(snapshot_value, "revision"),
                        "updated_at": getattr(snapshot_value, "updated_at"),
                        "last_error": getattr(snapshot_value, "last_error", None),
                    },
                }
            ),
            _to_sse_data(
                {
                    "type": "planner_messages_updated",
                    "channel": channel,
                    "seq": next_seq(),
                    "timestamp": datetime.now(tz=UTC).isoformat(),
                    "payload": {
                        "session_key": getattr(snapshot_value, "session_key"),
                        "messages": snapshot_messages,
                        "update_mode": "replace",
                    },
                }
            ),
            _to_sse_data(
                {
                    "type": "planner_nodes_patched",
                    "channel": channel,
                    "seq": next_seq(),
                    "timestamp": datetime.now(tz=UTC).isoformat(),
                    "payload": {
                        "session_key": getattr(snapshot_value, "session_key"),
                        "revision": getattr(snapshot_value, "revision"),
                        "operations": _build_planner_node_operations([], snapshot_nodes),
                    },
                }
            ),
            _to_sse_data(
                {
                    "type": "planner_snapshot_updated",
                    "channel": channel,
                    "seq": next_seq(),
                    "timestamp": datetime.now(tz=UTC).isoformat(),
                    "payload": {
                        "session_key": getattr(snapshot_value, "session_key"),
                        "revision": getattr(snapshot_value, "revision"),
                        "nodes": [_to_planner_node_draft_payload(item) for item in snapshot_nodes],
                    },
                }
            ),
        ]

    db_session.expire_all()
    if snapshot_only:
        snapshot = flow_planner_session_service.get_snapshot_for_user(
            db_session=db_session,
            user_id=current_user.id,
            session_key=normalized_session_key,
        )
        _require_session_board_matches(
            route_name="planner.sse.snapshot_only",
            route_board_id=normalized_board_id,
            session_board_id=getattr(snapshot, "board_id", ""),
            session_key=normalized_session_key,
        )
        snapshot_only_seed = _seed_planner_sse_seq(
            channel_key=channel_state_key,
            candidate=max(
                requested_resume_seq,
                realtime_hub.latest_seq(
                    user_id=current_user.id,
                    board_id=normalized_board_id,
                    session_key=normalized_session_key,
                ),
            ),
        )
        snapshot_only_seq = snapshot_only_seed

        def _next_snapshot_only_seq() -> int:
            nonlocal snapshot_only_seq
            snapshot_only_seq = _next_planner_sse_seq(channel_key=channel_state_key)
            return snapshot_only_seq

        logger.info(
            "[planner.sse] snapshot_only_response board=%s session=%s status=%s revision=%s resume=%s seed=%s",
            normalized_board_id,
            _short_session_key(normalized_session_key),
            getattr(snapshot, "status", "<unknown>"),
            getattr(snapshot, "revision", "<unknown>"),
            requested_resume_seq,
            snapshot_only_seed,
        )
        return Response(
            content="".join(build_snapshot_events(snapshot_value=snapshot, next_seq=_next_snapshot_only_seq)),
            media_type="text/event-stream",
            headers=headers,
        )

    # 先订阅再读快照：避免“先读后订阅”窗口内的增量事件漏收。
    subscriber_id, subscriber_queue, subscriber_baseline_seq = realtime_hub.subscribe(
        user_id=current_user.id,
        board_id=normalized_board_id,
        session_key=normalized_session_key,
    )
    logger.info(
        "[planner.sse] subscribed board=%s session=%s subscriber=%s baseline_seq=%s",
        normalized_board_id,
        _short_session_key(normalized_session_key),
        subscriber_id,
        subscriber_baseline_seq,
    )
    initial_stream_seq = _seed_planner_sse_seq(
        channel_key=channel_state_key,
        candidate=max(requested_resume_seq, subscriber_baseline_seq),
    )
    db_session.expire_all()
    try:
        snapshot: object | None = flow_planner_session_service.get_snapshot_for_user(
            db_session=db_session,
            user_id=current_user.id,
            session_key=normalized_session_key,
        )
        _require_session_board_matches(
            route_name="planner.sse.stream",
            route_board_id=normalized_board_id,
            session_board_id=getattr(snapshot, "board_id", ""),
            session_key=normalized_session_key,
        )
    except HTTPException as error:
        if error.status_code != status.HTTP_404_NOT_FOUND:
            logger.exception(
                "[planner.sse] snapshot_load_failed board=%s session=%s status=%s detail=%s",
                normalized_board_id,
                _short_session_key(normalized_session_key),
                error.status_code,
                error.detail,
            )
            realtime_hub.unsubscribe(
                user_id=current_user.id,
                board_id=normalized_board_id,
                session_key=normalized_session_key,
                subscriber_id=subscriber_id,
            )
            raise
        snapshot = None
        logger.warning(
            "[planner.sse] snapshot_not_found_emit_pending board=%s session=%s",
            normalized_board_id,
            _short_session_key(normalized_session_key),
        )
    del snapshot_only, last_seq, last_event_id

    async def event_stream() -> AsyncIterator[str]:
        seq = initial_stream_seq

        def _next_stream_seq() -> int:
            nonlocal seq
            seq = _next_planner_sse_seq(channel_key=channel_state_key)
            return seq

        keepalive_elapsed = 0.0
        last_status_signature = ""
        last_message_signature = _flow_chat_messages_payload_signature([])
        last_messages_payload: list[dict[str, Any]] = []
        last_snapshot_nodes: list[FlowCanvasNode] = []
        last_snapshot_signature = ""
        last_snapshot_revision = 0
        last_hub_seq = subscriber_baseline_seq
        terminal_drain_status: str | None = None
        terminal_drain_revision = 0
        terminal_drain_deadline = 0.0
        terminal_drain_seen_messages = False
        terminal_drain_seen_snapshot = False

        # 终态 drain 状态机（核心约束）：
        # - 收到 completed/failed/stopped 不能立刻断流；
        # - 给一个短窗口，优先等待终态后的 messages/snapshot 增量；
        # - 若窗口耗尽仍无增量，再安全关闭，避免连接无界等待。
        def _enter_terminal_drain(*, status_value: str, revision_value: int) -> None:
            nonlocal terminal_drain_status
            nonlocal terminal_drain_revision
            nonlocal terminal_drain_deadline
            nonlocal terminal_drain_seen_messages
            nonlocal terminal_drain_seen_snapshot
            terminal_drain_status = status_value
            terminal_drain_revision = max(0, revision_value)
            terminal_drain_deadline = time.monotonic() + _FLOW_PLANNER_SSE_TERMINAL_DRAIN_SECONDS
            terminal_drain_seen_messages = False
            terminal_drain_seen_snapshot = False

        def _mark_terminal_drain_messages_seen() -> None:
            nonlocal terminal_drain_seen_messages
            if terminal_drain_status is None:
                return
            terminal_drain_seen_messages = True

        def _mark_terminal_drain_snapshot_seen(*, revision_value: int) -> None:
            nonlocal terminal_drain_seen_snapshot
            if terminal_drain_status is None:
                return
            # 若终态给出了 revision，则等待同 revision（或更新）的快照事件。
            if terminal_drain_revision > 0 and revision_value > 0 and revision_value < terminal_drain_revision:
                return
            terminal_drain_seen_snapshot = True

        def _should_close_after_terminal_drain() -> bool:
            if terminal_drain_status is None:
                return False
            if terminal_drain_seen_messages or terminal_drain_seen_snapshot:
                logger.info(
                    "[planner.sse] terminal_drain_completed board=%s session=%s status=%s messages_seen=%s snapshot_seen=%s",
                    normalized_board_id,
                    _short_session_key(normalized_session_key),
                    terminal_drain_status,
                    terminal_drain_seen_messages,
                    terminal_drain_seen_snapshot,
                )
                return True
            if time.monotonic() >= terminal_drain_deadline:
                logger.info(
                    "[planner.sse] terminal_drain_timeout board=%s session=%s status=%s revision=%s",
                    normalized_board_id,
                    _short_session_key(normalized_session_key),
                    terminal_drain_status,
                    terminal_drain_revision,
                )
                return True
            return False

        def _refresh_state_from_snapshot(snapshot_value: object) -> None:
            nonlocal last_status_signature
            nonlocal last_messages_payload
            nonlocal last_message_signature
            nonlocal last_snapshot_nodes
            nonlocal last_snapshot_signature
            nonlocal last_snapshot_revision
            last_status_signature = json.dumps(
                {
                    "status": getattr(snapshot_value, "status"),
                    "revision": getattr(snapshot_value, "revision"),
                    "updated_at": getattr(snapshot_value, "updated_at"),
                    "last_error": getattr(snapshot_value, "last_error", None),
                },
                ensure_ascii=False,
                sort_keys=True,
            )
            last_messages_payload = [
                item.model_dump(mode="json")
                for item in _planner_snapshot_to_messages(snapshot_value)
            ]
            last_message_signature = _flow_chat_messages_payload_signature(last_messages_payload)
            last_snapshot_nodes = _planner_snapshot_to_canvas_nodes(snapshot_value)
            last_snapshot_signature = _flow_canvas_nodes_signature(last_snapshot_nodes)
            last_snapshot_revision = _safe_int(getattr(snapshot_value, "revision", 0), default=0)

        try:
            if snapshot is None:
                for payload in _build_pending_events(next_seq=_next_stream_seq):
                    yield payload
            else:
                for payload in build_snapshot_events(snapshot_value=snapshot, next_seq=_next_stream_seq):
                    yield payload
                _refresh_state_from_snapshot(snapshot)

            while True:
                if await request.is_disconnected():
                    logger.info(
                        "[planner.sse] client_disconnected board=%s session=%s seq=%s",
                        normalized_board_id,
                        _short_session_key(normalized_session_key),
                        seq,
                    )
                    return
                # 主链路只消费 Hub 推送队列；不再做 provider/history 主动同步。
                try:
                    hub_event = await asyncio.to_thread(
                        subscriber_queue.get,
                        True,
                        _FLOW_PLANNER_SSE_PUSH_WAIT_SECONDS,
                    )
                    keepalive_elapsed = 0.0
                except Empty:
                    hub_event = None
                    keepalive_elapsed += _FLOW_PLANNER_SSE_PUSH_WAIT_SECONDS

                if isinstance(hub_event, dict):
                    hub_seq = _safe_int(hub_event.get("seq"), default=0)
                    if hub_seq <= last_hub_seq:
                        logger.debug(
                            "[planner.sse] skip_outdated_hub_event board=%s session=%s hub_seq=%s last_hub_seq=%s",
                            normalized_board_id,
                            _short_session_key(normalized_session_key),
                            hub_seq,
                            last_hub_seq,
                        )
                        continue
                    last_hub_seq = hub_seq
                    event_type = str(hub_event.get("type", "")).strip()
                    event_payload = hub_event.get("payload")
                    if not isinstance(event_payload, dict):
                        event_payload = {}

                    if event_type in {
                        "planner_session_updated",
                        "planner_messages_updated",
                        "planner_nodes_patched",
                        "planner_snapshot_updated",
                    }:
                        pass

                    if event_type == "planner_session_updated":
                        revision = _safe_int(event_payload.get("revision"), default=0)
                        status_signature = json.dumps(
                            {
                                "status": event_payload.get("status"),
                                "revision": revision,
                                "updated_at": event_payload.get("updated_at"),
                                "last_error": event_payload.get("last_error"),
                            },
                            ensure_ascii=False,
                            sort_keys=True,
                        )
                        if status_signature != last_status_signature:
                            logger.info(
                                "[planner.sse] forward_session_updated board=%s session=%s revision=%s status=%s",
                                normalized_board_id,
                                _short_session_key(normalized_session_key),
                                revision,
                                event_payload.get("status"),
                            )
                            last_status_signature = status_signature
                            yield _to_sse_data(
                                {
                                    "type": "planner_session_updated",
                                    "channel": channel,
                                    "seq": _next_stream_seq(),
                                    "timestamp": datetime.now(tz=UTC).isoformat(),
                                    "payload": {
                                        "session_key": str(event_payload.get("session_key", normalized_session_key)),
                                        "status": str(event_payload.get("status", "planning")),
                                        "revision": revision,
                                        "updated_at": str(event_payload.get("updated_at", datetime.now(tz=UTC).isoformat())),
                                        "completed_at": event_payload.get("completed_at"),
                                        "last_error": event_payload.get("last_error"),
                                    },
                                }
                            )
                            terminal_status = str(event_payload.get("status", "")).strip()
                            if terminal_status in {"completed", "stopped", "failed"}:
                                _enter_terminal_drain(status_value=terminal_status, revision_value=revision)
                                logger.info(
                                    "[planner.sse] terminal_status_enter_drain board=%s session=%s status=%s revision=%s drain_seconds=%s",
                                    normalized_board_id,
                                    _short_session_key(normalized_session_key),
                                    terminal_status,
                                    revision,
                                    _FLOW_PLANNER_SSE_TERMINAL_DRAIN_SECONDS,
                                )
                        if _should_close_after_terminal_drain():
                            return
                        continue

                    if event_type == "planner_messages_updated":
                        if isinstance(event_payload.get("messages"), list):
                            _mark_terminal_drain_messages_seen()
                        next_messages_payload = _normalize_sse_chat_messages(event_payload.get("messages"))
                        next_message_signature = _flow_chat_messages_payload_signature(next_messages_payload)
                        if next_message_signature != last_message_signature:
                            logger.info(
                                "[planner.sse] forward_messages_updated board=%s session=%s msg_count=%s update_mode=%s",
                                normalized_board_id,
                                _short_session_key(normalized_session_key),
                                len(next_messages_payload),
                                event_payload.get("update_mode"),
                            )
                            message_payload = _resolve_planner_messages_update_payload(
                                session_key=str(event_payload.get("session_key", normalized_session_key)),
                                previous_messages=last_messages_payload,
                                next_messages=next_messages_payload,
                                requested_update_mode=event_payload.get("update_mode"),
                                requested_append_chunk=event_payload.get("append_chunk"),
                            )
                            last_messages_payload = [dict(item) for item in next_messages_payload]
                            last_message_signature = next_message_signature
                            yield _to_sse_data(
                                {
                                    "type": "planner_messages_updated",
                                    "channel": channel,
                                    "seq": _next_stream_seq(),
                                    "timestamp": datetime.now(tz=UTC).isoformat(),
                                    "payload": message_payload,
                                }
                            )
                        if _should_close_after_terminal_drain():
                            return
                        continue

                    if event_type == "planner_nodes_patched":
                        revision = _safe_int(event_payload.get("revision"), default=0)
                        # 快照已覆盖的旧 revision 不再重放，避免同一批节点补丁重复应用。
                        if revision > 0 and revision <= last_snapshot_revision:
                            logger.debug(
                                "[planner.sse] skip_nodes_patched_old_revision board=%s session=%s revision=%s last_revision=%s",
                                normalized_board_id,
                                _short_session_key(normalized_session_key),
                                revision,
                                last_snapshot_revision,
                            )
                            continue
                        operations = event_payload.get("operations")
                        if isinstance(operations, list):
                            if revision > 0:
                                last_snapshot_revision = max(last_snapshot_revision, revision)
                            yield _to_sse_data(
                                {
                                    "type": "planner_nodes_patched",
                                    "channel": channel,
                                    "seq": _next_stream_seq(),
                                    "timestamp": datetime.now(tz=UTC).isoformat(),
                                    "payload": {
                                        "session_key": str(event_payload.get("session_key", normalized_session_key)),
                                        "revision": revision,
                                        "operations": operations,
                                    },
                                }
                            )
                        continue

                    if event_type == "planner_snapshot_updated":
                        raw_nodes = event_payload.get("nodes")
                        if isinstance(raw_nodes, list):
                            revision = _safe_int(event_payload.get("revision"), default=0)
                            _mark_terminal_drain_snapshot_seen(revision_value=revision)
                            if revision > 0 and revision < last_snapshot_revision:
                                logger.debug(
                                    "[planner.sse] skip_snapshot_old_revision board=%s session=%s revision=%s last_revision=%s",
                                    normalized_board_id,
                                    _short_session_key(normalized_session_key),
                                    revision,
                                    last_snapshot_revision,
                                )
                                continue
                            next_snapshot_nodes = _planner_snapshot_nodes_to_canvas_nodes(
                                cast(
                                    list[dict[str, object]],
                                    [item for item in raw_nodes if isinstance(item, dict)],
                                )
                            )
                            next_snapshot_signature = _flow_canvas_nodes_signature(next_snapshot_nodes)
                            if next_snapshot_signature != last_snapshot_signature:
                                last_snapshot_nodes = next_snapshot_nodes
                                last_snapshot_signature = next_snapshot_signature
                                if revision > 0:
                                    last_snapshot_revision = max(last_snapshot_revision, revision)
                                yield _to_sse_data(
                                    {
                                        "type": "planner_snapshot_updated",
                                        "channel": channel,
                                        "seq": _next_stream_seq(),
                                        "timestamp": datetime.now(tz=UTC).isoformat(),
                                        "payload": {
                                            "session_key": str(event_payload.get("session_key", normalized_session_key)),
                                            "revision": revision,
                                            "nodes": [_to_planner_node_draft_payload(item) for item in next_snapshot_nodes],
                                        },
                                    }
                                )
                            elif revision > 0:
                                last_snapshot_revision = max(last_snapshot_revision, revision)
                        if _should_close_after_terminal_drain():
                            return
                        continue

                    if event_type == "error":
                        logger.error(
                            "[planner.sse] hub_error board=%s session=%s detail=%s",
                            normalized_board_id,
                            _short_session_key(normalized_session_key),
                            event_payload.get("detail"),
                        )
                        yield _to_sse_data(
                            {
                                "type": "error",
                                "channel": channel,
                                "seq": _next_stream_seq(),
                                "timestamp": datetime.now(tz=UTC).isoformat(),
                                "payload": {"detail": str(event_payload.get("detail", "unknown error"))},
                            }
                        )
                        return

                # breaking: planner SSE 不再主动轮询 provider/history，仅转发已落库实时事件。

                if _should_close_after_terminal_drain():
                    return

                if keepalive_elapsed >= _FLOW_PLANNER_SSE_KEEPALIVE_SECONDS:
                    keepalive_elapsed = 0.0
                    yield ": keep-alive\n\n"
        except asyncio.CancelledError:
            logger.info(
                "[planner.sse] cancelled board=%s session=%s seq=%s",
                normalized_board_id,
                _short_session_key(normalized_session_key),
                seq,
            )
            raise
        except HTTPException as exc:
            logger.exception(
                "[planner.sse] http_exception board=%s session=%s status=%s detail=%s",
                normalized_board_id,
                _short_session_key(normalized_session_key),
                exc.status_code,
                exc.detail,
            )
            yield _to_sse_data(
                {
                    "type": "error",
                    "channel": channel,
                    "seq": _next_stream_seq(),
                    "timestamp": datetime.now(tz=UTC).isoformat(),
                    "payload": {"detail": str(exc.detail)},
                }
            )
            return
        finally:
            realtime_hub.unsubscribe(
                user_id=current_user.id,
                board_id=normalized_board_id,
                session_key=normalized_session_key,
                subscriber_id=subscriber_id,
            )
            logger.info(
                "[planner.sse] unsubscribed board=%s session=%s subscriber=%s",
                normalized_board_id,
                _short_session_key(normalized_session_key),
                subscriber_id,
            )

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers=headers,
    )


@router.post("/flow/planner-stop", response_model=FlowPlannerStopResponse, tags=["flow"])
def stop_flow_planner(
    board_id: str,
    payload: FlowPlannerStopRequest,
    db_session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
    flow_planner_session_service: FlowPlannerSessionService = Depends(get_flow_planner_session_service),
    flow_decomposition_service: FlowDecompositionService = Depends(get_flow_decomposition_service),
    provider_application_service: ProviderApplicationService = Depends(get_provider_application_service),
    instance_service: InstanceService = Depends(get_instance_service),
) -> FlowPlannerStopResponse:
    del board_id
    snapshot = flow_planner_session_service.stop_for_user(
        db_session=db_session,
        user_id=current_user.id,
        session_key=payload.planner_session_key,
    )
    if snapshot.instance_id is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="planner session missing instance binding",
        )
    execution_context: ProviderExecutionContext = _build_execution_context_or_404(
        db_session=db_session,
        current_user=current_user,
        instance_id=snapshot.instance_id,
        instance_service=instance_service,
        provider_application_service=provider_application_service,
    )
    try:
        provider_application_service.pause_agent_for_provider(
            data_source=flow_decomposition_service.decomposition_provider_name(),
            execution_context=execution_context,
            agent_id=snapshot.planner_agent_id,
            session_key=snapshot.session_key,
        )
    except HTTPException:
        pass
    return FlowPlannerStopResponse(
        session_key=snapshot.session_key,
        status=cast(Any, snapshot.status),
        revision=snapshot.revision,
        updated_at=_serialize_iso_datetime(snapshot.updated_at),
    )


@router.post(
    "/flow/planner-sessions/{session_key}/events",
    response_model=FlowPlannerSessionEventsResponse,
    tags=["flow-internal"],
)
def planner_append_session_events(
    board_id: str,
    session_key: str,
    payload: FlowPlannerSessionEventsRequest,
    planner_token: str = Header(alias="X-Linpo-Planner-Token"),
    db_session: Session = Depends(get_session),
    flow_planner_session_service: FlowPlannerSessionService = Depends(get_flow_planner_session_service),
) -> FlowPlannerSessionEventsResponse:
    normalized_session_key = unquote(session_key).strip()
    logger.info(
        "[planner.events] request session=%s event_count=%s token=%s",
        _short_session_key(normalized_session_key),
        len(payload.events),
        _short_token(planner_token),
    )
    apply_result = _run_internal_route_mutation(
        route_name="planner.events",
        board_id=board_id,
        session_key=session_key,
        planner_token=planner_token,
        db_session=db_session,
        flow_planner_session_service=flow_planner_session_service,
        write_operation=lambda normalized_session_key: flow_planner_session_service.ingest_events_by_token(
            db_session=db_session,
            session_key=normalized_session_key,
            planner_token=planner_token,
            events=[item.model_dump(mode="json", exclude_none=True) for item in payload.events],
            publish_realtime=True,
        ),
    )
    logger.info(
        "[planner.events] applied session=%s accepted=%s status=%s revision=%s",
        _short_session_key(apply_result.record.session_key),
        apply_result.accepted_events,
        apply_result.record.status,
        apply_result.record.revision,
    )
    return FlowPlannerSessionEventsResponse(
        session_key=apply_result.record.session_key,
        status=cast(Any, apply_result.record.status),
        revision=apply_result.record.revision,
        accepted_events=apply_result.accepted_events,
        updated_at=_serialize_iso_datetime(apply_result.record.updated_at),
    )


@router.post("/flow/planner-sessions/{session_key}/nodes/upsert", response_model=FlowPlannerSessionItem, tags=["flow-internal"])
def planner_upsert_single_node(
    board_id: str,
    session_key: str,
    payload: FlowPlannerNodeUpsertRequest,
    planner_token: str = Header(alias="X-Linpo-Planner-Token"),
    db_session: Session = Depends(get_session),
    flow_planner_session_service: FlowPlannerSessionService = Depends(get_flow_planner_session_service),
) -> FlowPlannerSessionItem:
    snapshot = _run_internal_route_mutation(
        route_name="planner.nodes.upsert",
        board_id=board_id,
        session_key=session_key,
        planner_token=planner_token,
        db_session=db_session,
        flow_planner_session_service=flow_planner_session_service,
        write_operation=lambda normalized_session_key: flow_planner_session_service.upsert_node_by_token(
            db_session=db_session,
            session_key=normalized_session_key,
            planner_token=planner_token,
            node=payload.node.model_dump(mode="json"),
        ),
    )
    return FlowPlannerSessionItem(
        session_key=snapshot.session_key,
        status=cast(Any, snapshot.status),
        revision=snapshot.revision,
        updated_at=_serialize_iso_datetime(snapshot.updated_at),
    )


@router.post("/flow/planner-sessions/{session_key}/nodes/delete", response_model=FlowPlannerSessionItem, tags=["flow-internal"])
def planner_delete_single_node(
    board_id: str,
    session_key: str,
    payload: FlowPlannerNodeDeleteRequest,
    planner_token: str = Header(alias="X-Linpo-Planner-Token"),
    db_session: Session = Depends(get_session),
    flow_planner_session_service: FlowPlannerSessionService = Depends(get_flow_planner_session_service),
) -> FlowPlannerSessionItem:
    snapshot = _run_internal_route_mutation(
        route_name="planner.nodes.delete",
        board_id=board_id,
        session_key=session_key,
        planner_token=planner_token,
        db_session=db_session,
        flow_planner_session_service=flow_planner_session_service,
        write_operation=lambda normalized_session_key: flow_planner_session_service.delete_node_by_token(
            db_session=db_session,
            session_key=normalized_session_key,
            planner_token=planner_token,
            node_id=payload.node_id,
        ),
    )
    return FlowPlannerSessionItem(
        session_key=snapshot.session_key,
        status=cast(Any, snapshot.status),
        revision=snapshot.revision,
        updated_at=_serialize_iso_datetime(snapshot.updated_at),
    )


@router.post("/flow/planner-sessions/{session_key}/complete", response_model=FlowPlannerSessionItem, tags=["flow-internal"])
def planner_complete_session(
    board_id: str,
    session_key: str,
    payload: FlowPlannerSessionCompleteRequest,
    planner_token: str = Header(alias="X-Linpo-Planner-Token"),
    db_session: Session = Depends(get_session),
    flow_planner_session_service: FlowPlannerSessionService = Depends(get_flow_planner_session_service),
) -> FlowPlannerSessionItem:
    snapshot = _run_internal_route_mutation(
        route_name="planner.complete",
        board_id=board_id,
        session_key=session_key,
        planner_token=planner_token,
        db_session=db_session,
        flow_planner_session_service=flow_planner_session_service,
        write_operation=lambda normalized_session_key: flow_planner_session_service.complete_by_token(
            db_session=db_session,
            session_key=normalized_session_key,
            planner_token=planner_token,
            nodes=[item.model_dump(mode="json") for item in payload.nodes],
            summary=payload.summary,
        ),
    )
    return FlowPlannerSessionItem(
        session_key=snapshot.session_key,
        status=cast(Any, snapshot.status),
        revision=snapshot.revision,
        updated_at=_serialize_iso_datetime(snapshot.updated_at),
    )


@router.post("/flow/planner-sessions/{session_key}/fail", response_model=FlowPlannerSessionItem, tags=["flow-internal"])
def planner_fail_session(
    board_id: str,
    session_key: str,
    payload: FlowPlannerSessionFailRequest,
    planner_token: str = Header(alias="X-Linpo-Planner-Token"),
    db_session: Session = Depends(get_session),
    flow_planner_session_service: FlowPlannerSessionService = Depends(get_flow_planner_session_service),
) -> FlowPlannerSessionItem:
    snapshot = _run_internal_route_mutation(
        route_name="planner.fail",
        board_id=board_id,
        session_key=session_key,
        planner_token=planner_token,
        db_session=db_session,
        flow_planner_session_service=flow_planner_session_service,
        write_operation=lambda normalized_session_key: flow_planner_session_service.fail_by_token(
            db_session=db_session,
            session_key=normalized_session_key,
            planner_token=planner_token,
            reason=payload.reason,
        ),
    )
    return FlowPlannerSessionItem(
        session_key=snapshot.session_key,
        status=cast(Any, snapshot.status),
        revision=snapshot.revision,
        updated_at=_serialize_iso_datetime(snapshot.updated_at),
    )
