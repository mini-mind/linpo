from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import UTC, datetime
import json
from secrets import token_urlsafe
from typing import Any, Iterator
from uuid import UUID, uuid4

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.models import FlowPlannerMessage, FlowPlannerSession
from app.services.flow_planner_realtime import FlowPlannerRealtimeHub, get_flow_planner_realtime_hub

PlannerSessionStatus = str
PlannerMessageRole = str
PlannerMessageKind = str
PlannerNodePayload = dict[str, Any]

_DEFAULT_BOARD_ID = "default"
_DEFAULT_PLANNER_AGENT_ID = "claw3"
_DEFAULT_FLOW_NAME = "未命名流程"
_DEFAULT_MESSAGE_LIMIT = 400
_ALLOWED_STATUSES = {"planning", "completed", "failed", "stopped"}


@dataclass(frozen=True)
class FlowPlannerMessageRecord:
    id: str
    session_key: str
    seq: int
    role: PlannerMessageRole
    kind: PlannerMessageKind
    content: str
    payload: dict[str, Any]
    created_at: datetime

    def to_payload(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "session_key": self.session_key,
            "seq": self.seq,
            "role": self.role,
            "kind": self.kind,
            "content": self.content,
            "payload": dict(self.payload),
            "created_at": _serialize_datetime(self.created_at),
        }


@dataclass(frozen=True)
class FlowPlannerSessionRecord:
    session_key: str
    user_id: UUID
    board_id: str
    instance_id: UUID | None
    planner_agent_id: str
    planner_token: str
    flow_name: str
    status: PlannerSessionStatus
    revision: int
    current_nodes: list[PlannerNodePayload]
    last_error: str | None
    created_at: datetime
    updated_at: datetime
    completed_at: datetime | None
    messages: list[FlowPlannerMessageRecord] = field(default_factory=list)

    def to_payload(
        self,
        *,
        include_messages: bool = True,
        include_planner_token: bool = False,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "session_key": self.session_key,
            "user_id": str(self.user_id),
            "board_id": self.board_id,
            "instance_id": str(self.instance_id) if self.instance_id is not None else None,
            "planner_agent_id": self.planner_agent_id,
            "flow_name": self.flow_name,
            "status": self.status,
            "revision": self.revision,
            "current_nodes": [_clone_node_payload(node) for node in self.current_nodes],
            "last_error": self.last_error,
            "created_at": _serialize_datetime(self.created_at),
            "updated_at": _serialize_datetime(self.updated_at),
            "completed_at": _serialize_datetime(self.completed_at),
        }
        if include_planner_token:
            payload["planner_token"] = self.planner_token
        if include_messages:
            payload["messages"] = [message.to_payload() for message in self.messages]
        return payload


@dataclass(frozen=True)
class PlannerSessionSnapshot:
    session_key: str
    planner_token: str
    planner_agent_id: str
    board_id: str
    flow_name: str
    status: PlannerSessionStatus
    revision: int
    nodes: list[PlannerNodePayload]
    updated_at: str
    messages: list[dict[str, Any]]
    last_error: str | None = None

    @property
    def current_nodes(self) -> list[PlannerNodePayload]:
        return self.nodes


class FlowPlannerSessionService:
    def __init__(
        self,
        *,
        realtime_hub: FlowPlannerRealtimeHub | None = None,
    ) -> None:
        self._realtime_hub = realtime_hub or get_flow_planner_realtime_hub()

    def create_session(
        self,
        *,
        user_id: UUID | str,
        board_id: str = _DEFAULT_BOARD_ID,
        instance_id: UUID | str | None = None,
        planner_agent_id: str = _DEFAULT_PLANNER_AGENT_ID,
        planner_session_key: str | None = None,
        planner_token: str | None = None,
        flow_name: str | None = None,
        current_nodes: list[PlannerNodePayload] | None = None,
        db_session: Session,
        publish_realtime: bool = True,
    ) -> FlowPlannerSessionRecord:
        normalized_user_id = _normalize_uuid(user_id, field_name="user_id")
        normalized_board_id = _normalize_board_id(board_id)
        normalized_instance_id = _normalize_uuid(instance_id, field_name="instance_id", required=False)
        normalized_agent_id = _normalize_planner_agent_id(planner_agent_id)
        normalized_session_key = _normalize_session_key(
            planner_session_key,
            board_id=normalized_board_id,
            planner_agent_id=normalized_agent_id,
        )
        normalized_token = _normalize_planner_token(planner_token)
        normalized_flow_name = _normalize_flow_name(flow_name)
        normalized_nodes = [_normalize_node_payload(node) for node in (current_nodes or [])]
        now = _utc_now()

        with self._session_scope(db_session) as managed_session:
            existing = managed_session.get(FlowPlannerSession, normalized_session_key)
            if existing is not None:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"planner session already exists: {normalized_session_key}",
                )

            planner_session = FlowPlannerSession(
                session_key=normalized_session_key,
                user_id=normalized_user_id,
                board_id=normalized_board_id,
                instance_id=normalized_instance_id,
                planner_agent_id=normalized_agent_id,
                planner_token=normalized_token,
                flow_name=normalized_flow_name,
                status="planning",
                revision=0,
                current_nodes=[_clone_node_payload(node) for node in normalized_nodes],
                last_error=None,
                created_at=now,
                updated_at=now,
                completed_at=None,
            )
            managed_session.add(planner_session)
            managed_session.commit()
            managed_session.refresh(planner_session)
            record = self._build_session_record(planner_session=planner_session, messages=[])

        if publish_realtime:
            self._publish_session_updated(record)
            if record.current_nodes:
                self._publish_snapshot_updated(record)
        return record

    def restore_session(
        self,
        *,
        session_key: str | None = None,
        planner_token: str | None = None,
        user_id: UUID | str | None = None,
        board_id: str | None = None,
        include_messages: bool = True,
        message_limit: int = _DEFAULT_MESSAGE_LIMIT,
        db_session: Session | None = None,
    ) -> FlowPlannerSessionRecord:
        with self._session_scope(db_session) as managed_session:
            planner_session = self._get_session_model(
                managed_session,
                session_key=session_key,
                planner_token=planner_token,
                user_id=user_id,
                board_id=board_id,
            )
            messages = self._load_message_records(
                managed_session,
                session_key=planner_session.session_key,
                limit=message_limit,
            ) if include_messages else []
            return self._build_session_record(planner_session=planner_session, messages=messages)

    def create_or_restore_session(
        self,
        *,
        user_id: UUID | str,
        board_id: str = _DEFAULT_BOARD_ID,
        instance_id: UUID | str | None = None,
        planner_agent_id: str = _DEFAULT_PLANNER_AGENT_ID,
        planner_session_key: str | None = None,
        planner_token: str | None = None,
        flow_name: str | None = None,
        current_nodes: list[PlannerNodePayload] | None = None,
        include_messages: bool = True,
        db_session: Session,
        publish_realtime: bool = True,
    ) -> FlowPlannerSessionRecord:
        normalized_user_id = _normalize_uuid(user_id, field_name="user_id")
        normalized_board_id = _normalize_board_id(board_id)
        normalized_instance_id = _normalize_uuid(instance_id, field_name="instance_id", required=False)
        normalized_agent_id = _normalize_planner_agent_id(planner_agent_id)
        normalized_session_key = _normalize_session_key(
            planner_session_key,
            board_id=normalized_board_id,
            planner_agent_id=normalized_agent_id,
        )
        normalized_flow_name = _normalize_flow_name(flow_name)
        normalized_nodes = [_normalize_node_payload(node) for node in (current_nodes or [])]

        with self._session_scope(db_session) as managed_session:
            planner_session = self._find_session_model(
                managed_session,
                session_key=normalized_session_key,
                user_id=normalized_user_id,
                board_id=normalized_board_id,
            )
            if planner_session is None:
                return self.create_session(
                    user_id=normalized_user_id,
                    board_id=normalized_board_id,
                    instance_id=normalized_instance_id,
                    planner_agent_id=normalized_agent_id,
                    planner_session_key=normalized_session_key,
                    planner_token=planner_token,
                    flow_name=normalized_flow_name,
                    current_nodes=normalized_nodes,
                    db_session=managed_session,
                    publish_realtime=publish_realtime,
                )

            if planner_token is not None and planner_token.strip() and planner_session.planner_token != planner_token.strip():
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="planner token does not match existing session",
                )

            dirty = False
            snapshot_changed = False
            if normalized_instance_id is not None and planner_session.instance_id != normalized_instance_id:
                planner_session.instance_id = normalized_instance_id
                dirty = True
            if planner_session.planner_agent_id != normalized_agent_id:
                planner_session.planner_agent_id = normalized_agent_id
                dirty = True
            if planner_session.flow_name != normalized_flow_name:
                planner_session.flow_name = normalized_flow_name
                dirty = True
            if planner_session.status == "planning" and planner_session.revision == 0:
                existing_nodes = [_normalize_node_payload(node) for node in planner_session.current_nodes]
                if normalized_nodes and existing_nodes != normalized_nodes:
                    planner_session.current_nodes = [_clone_node_payload(node) for node in normalized_nodes]
                    dirty = True
                    snapshot_changed = True
            if dirty:
                planner_session.updated_at = _utc_now()
                managed_session.commit()
                managed_session.refresh(planner_session)

            messages = self._load_message_records(
                managed_session,
                session_key=planner_session.session_key,
                limit=_DEFAULT_MESSAGE_LIMIT,
            ) if include_messages else []
            record = self._build_session_record(planner_session=planner_session, messages=messages)

        if publish_realtime and dirty:
            if snapshot_changed:
                self._publish_snapshot_updated(record)
            self._publish_session_updated(record)
        return record

    def ensure_session(
        self,
        db_session: Session,
        *,
        user_id: UUID,
        board_id: str,
        planner_session_key: str,
        planner_agent_id: str,
        instance_id: UUID | None,
        flow_name: str,
        current_nodes: list[PlannerNodePayload] | None,
    ) -> PlannerSessionSnapshot:
        record = self.create_or_restore_session(
            user_id=user_id,
            board_id=board_id,
            instance_id=instance_id,
            planner_agent_id=planner_agent_id,
            planner_session_key=planner_session_key,
            flow_name=flow_name,
            current_nodes=current_nodes,
            include_messages=True,
            db_session=db_session,
            publish_realtime=False,
        )
        return self._to_snapshot(record)

    def prompt_history(
        self,
        db_session: Session,
        *,
        session_key: str,
        limit: int = 20,
    ) -> list[dict[str, str]]:
        record = self.restore_session(
            session_key=session_key,
            include_messages=True,
            message_limit=max(1, limit),
            db_session=db_session,
        )
        history: list[dict[str, str]] = []
        for message in record.messages[-max(1, limit):]:
            content = message.content.strip()
            if content == "":
                continue
            history.append({"role": message.role, "content": content})
        return history

    def get_snapshot_for_user(
        self,
        db_session: Session,
        *,
        user_id: UUID,
        session_key: str,
    ) -> PlannerSessionSnapshot:
        record = self.restore_session(
            session_key=session_key,
            user_id=user_id,
            include_messages=True,
            db_session=db_session,
        )
        return self._to_snapshot(record)

    def get_snapshot_by_token(
        self,
        db_session: Session,
        *,
        session_key: str,
        planner_token: str,
    ) -> PlannerSessionSnapshot:
        record = self.restore_session(
            session_key=session_key,
            planner_token=planner_token,
            include_messages=True,
            db_session=db_session,
        )
        return self._to_snapshot(record)

    def append_message(
        self,
        *,
        session_key: str,
        role: PlannerMessageRole,
        content: str,
        kind: PlannerMessageKind = "message",
        payload: dict[str, Any] | None = None,
        db_session: Session,
        publish_realtime: bool = True,
    ) -> FlowPlannerSessionRecord:
        normalized_session_key = _require_non_empty(session_key, field_name="session_key")
        normalized_role = _normalize_message_role(role)
        normalized_kind = _normalize_message_kind(kind)
        normalized_content = content.strip()
        normalized_payload = dict(payload or {})
        now = _utc_now()

        with self._session_scope(db_session) as managed_session:
            planner_session = self._get_session_model(managed_session, session_key=normalized_session_key)
            planner_message = FlowPlannerMessage(
                session_key=planner_session.session_key,
                seq=self._next_message_seq(managed_session, planner_session.session_key),
                role=normalized_role,
                kind=normalized_kind,
                content=normalized_content,
                payload=normalized_payload,
                created_at=now,
            )
            managed_session.add(planner_message)
            planner_session.updated_at = now
            managed_session.commit()
            managed_session.refresh(planner_session)
            record = self._build_session_record(
                planner_session=planner_session,
                messages=self._load_message_records(
                    managed_session,
                    session_key=planner_session.session_key,
                    limit=_DEFAULT_MESSAGE_LIMIT,
                ),
            )

        if publish_realtime:
            self._publish_messages_updated(record)
            self._publish_session_updated(record)
        return record

    def list_messages(
        self,
        *,
        session_key: str,
        limit: int = _DEFAULT_MESSAGE_LIMIT,
        db_session: Session | None = None,
    ) -> list[FlowPlannerMessageRecord]:
        normalized_session_key = _require_non_empty(session_key, field_name="session_key")
        with self._session_scope(db_session) as managed_session:
            self._get_session_model(managed_session, session_key=normalized_session_key)
            return self._load_message_records(
                managed_session,
                session_key=normalized_session_key,
                limit=limit,
            )

    def publish_realtime_state(
        self,
        *,
        session_key: str,
        include_messages: bool = True,
        db_session: Session | None = None,
    ) -> FlowPlannerSessionRecord:
        record = self.restore_session(
            session_key=session_key,
            include_messages=include_messages,
            db_session=db_session,
        )
        self._realtime_hub.publish_snapshot_ready(
            user_id=record.user_id,
            board_id=record.board_id,
            session_key=record.session_key,
        )
        if include_messages:
            self._publish_messages_updated(record)
        self._publish_snapshot_updated(record)
        self._publish_session_updated(record)
        return record

    def upsert_node(
        self,
        *,
        session_key: str,
        node: PlannerNodePayload,
        db_session: Session,
        publish_realtime: bool = True,
    ) -> FlowPlannerSessionRecord:
        normalized_session_key = _require_non_empty(session_key, field_name="session_key")
        normalized_node = _normalize_node_payload(node)

        with self._session_scope(db_session) as managed_session:
            planner_session = self._get_session_model(
                managed_session,
                session_key=normalized_session_key,
                for_update=True,
            )
            _ensure_session_is_mutable(planner_session)
            current_nodes = [_normalize_node_payload(item) for item in planner_session.current_nodes]
            previous_node = next((item for item in current_nodes if item["id"] == normalized_node["id"]), None)
            if previous_node == normalized_node:
                return self._build_session_record(
                    planner_session=planner_session,
                    messages=self._load_message_records(
                        managed_session,
                        session_key=planner_session.session_key,
                        limit=_DEFAULT_MESSAGE_LIMIT,
                    ),
                )

            next_nodes: list[PlannerNodePayload] = []
            replaced = False
            for item in current_nodes:
                if item["id"] == normalized_node["id"]:
                    next_nodes.append(_clone_node_payload(normalized_node))
                    replaced = True
                else:
                    next_nodes.append(_clone_node_payload(item))
            if not replaced:
                next_nodes.append(_clone_node_payload(normalized_node))

            planner_session.current_nodes = next_nodes
            planner_session.revision = int(planner_session.revision) + 1
            planner_session.updated_at = _utc_now()
            planner_session.last_error = None
            managed_session.commit()
            managed_session.refresh(planner_session)
            record = self._build_session_record(
                planner_session=planner_session,
                messages=self._load_message_records(
                    managed_session,
                    session_key=planner_session.session_key,
                    limit=_DEFAULT_MESSAGE_LIMIT,
                ),
            )

        if publish_realtime:
            self._publish_node_operations(
                record,
                operations=[{"type": "upsert_node", "node": _clone_node_payload(normalized_node)}],
            )
        return record

    def upsert_node_by_token(
        self,
        db_session: Session,
        *,
        session_key: str,
        planner_token: str,
        node: PlannerNodePayload,
    ) -> PlannerSessionSnapshot:
        record = self.restore_session(
            session_key=session_key,
            planner_token=planner_token,
            include_messages=False,
            db_session=db_session,
        )
        _ensure_session_record_is_mutable(record)
        normalized_node = _normalize_node_payload(node)
        self.append_message(
            session_key=record.session_key,
            role="assistant",
            kind="planner_request",
            content=(
                "调用单节点编辑接口 `upsert_node`。\n"
                f"```json\n{_safe_json_dump({'node': normalized_node})}\n```"
            ),
            payload={"type": "upsert_node", "node": normalized_node},
            db_session=db_session,
            publish_realtime=True,
        )
        updated = self.upsert_node(
            session_key=record.session_key,
            node=normalized_node,
            db_session=db_session,
            publish_realtime=True,
        )
        return self._to_snapshot(updated)

    def delete_node(
        self,
        *,
        session_key: str,
        node_id: str,
        db_session: Session,
        publish_realtime: bool = True,
    ) -> FlowPlannerSessionRecord:
        normalized_session_key = _require_non_empty(session_key, field_name="session_key")
        normalized_node_id = _require_non_empty(node_id, field_name="node_id")

        with self._session_scope(db_session) as managed_session:
            planner_session = self._get_session_model(
                managed_session,
                session_key=normalized_session_key,
                for_update=True,
            )
            _ensure_session_is_mutable(planner_session)
            current_nodes = [_normalize_node_payload(item) for item in planner_session.current_nodes]
            next_nodes: list[PlannerNodePayload] = []
            removed = False
            for item in current_nodes:
                if item["id"] == normalized_node_id:
                    removed = True
                    continue
                next_item = _clone_node_payload(item)
                next_item["depends_on"] = [
                    dep for dep in next_item["depends_on"]
                    if dep != normalized_node_id
                ]
                next_nodes.append(next_item)
            if not removed:
                return self._build_session_record(
                    planner_session=planner_session,
                    messages=self._load_message_records(
                        managed_session,
                        session_key=planner_session.session_key,
                        limit=_DEFAULT_MESSAGE_LIMIT,
                    ),
                )

            planner_session.current_nodes = [_clone_node_payload(node) for node in next_nodes]
            planner_session.revision = int(planner_session.revision) + 1
            planner_session.updated_at = _utc_now()
            planner_session.last_error = None
            managed_session.commit()
            managed_session.refresh(planner_session)
            record = self._build_session_record(
                planner_session=planner_session,
                messages=self._load_message_records(
                    managed_session,
                    session_key=planner_session.session_key,
                    limit=_DEFAULT_MESSAGE_LIMIT,
                ),
            )

        if publish_realtime:
            self._publish_node_operations(
                record,
                operations=[{"type": "delete_node", "node_id": normalized_node_id}],
            )
        return record

    def replace_nodes(
        self,
        *,
        session_key: str,
        nodes: list[PlannerNodePayload],
        db_session: Session,
        publish_realtime: bool = True,
    ) -> FlowPlannerSessionRecord:
        normalized_session_key = _require_non_empty(session_key, field_name="session_key")
        normalized_nodes = [_normalize_node_payload(node) for node in nodes]

        with self._session_scope(db_session) as managed_session:
            planner_session = self._get_session_model(
                managed_session,
                session_key=normalized_session_key,
                for_update=True,
            )
            previous_nodes = [_normalize_node_payload(item) for item in planner_session.current_nodes]
            if previous_nodes == normalized_nodes:
                return self._build_session_record(
                    planner_session=planner_session,
                    messages=self._load_message_records(
                        managed_session,
                        session_key=planner_session.session_key,
                        limit=_DEFAULT_MESSAGE_LIMIT,
                    ),
                )

            planner_session.current_nodes = [_clone_node_payload(node) for node in normalized_nodes]
            planner_session.revision = int(planner_session.revision) + 1
            planner_session.updated_at = _utc_now()
            planner_session.last_error = None
            managed_session.commit()
            managed_session.refresh(planner_session)
            record = self._build_session_record(
                planner_session=planner_session,
                messages=self._load_message_records(
                    managed_session,
                    session_key=planner_session.session_key,
                    limit=_DEFAULT_MESSAGE_LIMIT,
                ),
            )

        if publish_realtime:
            operations = _build_node_operations(previous_nodes, normalized_nodes)
            if operations:
                self._publish_node_operations(record, operations=operations)
        return record

    def delete_node_by_token(
        self,
        db_session: Session,
        *,
        session_key: str,
        planner_token: str,
        node_id: str,
    ) -> PlannerSessionSnapshot:
        record = self.restore_session(
            session_key=session_key,
            planner_token=planner_token,
            include_messages=False,
            db_session=db_session,
        )
        _ensure_session_record_is_mutable(record)
        normalized_node_id = _require_non_empty(node_id, field_name="node_id")
        self.append_message(
            session_key=record.session_key,
            role="assistant",
            kind="planner_request",
            content=(
                "调用单节点编辑接口 `delete_node`。\n"
                f"```json\n{_safe_json_dump({'node_id': normalized_node_id})}\n```"
            ),
            payload={"type": "delete_node", "node_id": normalized_node_id},
            db_session=db_session,
            publish_realtime=True,
        )
        updated = self.delete_node(
            session_key=record.session_key,
            node_id=normalized_node_id,
            db_session=db_session,
            publish_realtime=True,
        )
        return self._to_snapshot(updated)

    def complete_session(
        self,
        *,
        session_key: str,
        content: str | None = None,
        payload: dict[str, Any] | None = None,
        db_session: Session,
        publish_realtime: bool = True,
    ) -> FlowPlannerSessionRecord:
        normalized_session_key = _require_non_empty(session_key, field_name="session_key")
        normalized_content = content.strip() if isinstance(content, str) else ""
        normalized_payload = dict(payload or {})
        now = _utc_now()

        with self._session_scope(db_session) as managed_session:
            planner_session = self._get_session_model(
                managed_session,
                session_key=normalized_session_key,
                for_update=True,
            )
            current_nodes = [_normalize_node_payload(item) for item in planner_session.current_nodes]
            validation_error = _validate_completion_nodes(current_nodes)
            if validation_error is not None:
                failed_message = FlowPlannerMessage(
                    session_key=planner_session.session_key,
                    seq=self._next_message_seq(managed_session, planner_session.session_key),
                    role="assistant",
                    kind="error",
                    content=validation_error,
                    payload={"status": "failed", **normalized_payload},
                    created_at=now,
                )
                managed_session.add(failed_message)
                planner_session.status = "failed"
                planner_session.updated_at = now
                planner_session.last_error = validation_error
                planner_session.completed_at = None
                managed_session.commit()
                managed_session.refresh(planner_session)
                record = self._build_session_record(
                    planner_session=planner_session,
                    messages=self._load_message_records(
                        managed_session,
                        session_key=planner_session.session_key,
                        limit=_DEFAULT_MESSAGE_LIMIT,
                    ),
                )
                if publish_realtime:
                    self._publish_messages_updated(record)
                    self._publish_session_updated(record)
                    self._realtime_hub.publish_error(
                        user_id=record.user_id,
                        board_id=record.board_id,
                        session_key=record.session_key,
                        detail=validation_error,
                    )
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=validation_error)

            if normalized_content:
                planner_message = FlowPlannerMessage(
                    session_key=planner_session.session_key,
                    seq=self._next_message_seq(managed_session, planner_session.session_key),
                    role="assistant",
                    kind="status",
                    content=normalized_content,
                    payload=normalized_payload,
                    created_at=now,
                )
                managed_session.add(planner_message)

            planner_session.status = "completed"
            planner_session.current_nodes = [_clone_node_payload(node) for node in current_nodes]
            planner_session.updated_at = now
            planner_session.last_error = None
            planner_session.completed_at = now
            managed_session.commit()
            managed_session.refresh(planner_session)
            record = self._build_session_record(
                planner_session=planner_session,
                messages=self._load_message_records(
                    managed_session,
                    session_key=planner_session.session_key,
                    limit=_DEFAULT_MESSAGE_LIMIT,
                ),
            )

        if publish_realtime:
            if normalized_content:
                self._publish_messages_updated(record)
            self._publish_session_updated(record)
        return record

    def complete_by_token(
        self,
        db_session: Session,
        *,
        session_key: str,
        planner_token: str,
        nodes: list[PlannerNodePayload] | None = None,
        summary: str | None = None,
    ) -> PlannerSessionSnapshot:
        record = self.restore_session(
            session_key=session_key,
            planner_token=planner_token,
            include_messages=False,
            db_session=db_session,
        )
        _ensure_session_record_is_mutable(record)
        self.append_message(
            session_key=record.session_key,
            role="assistant",
            kind="planner_request",
            content=(
                "调用规划完成接口 `complete`。\n"
                f"```json\n{_safe_json_dump({'summary': summary or '', 'node_count': len(nodes or [])})}\n```"
            ),
            payload={"type": "complete", "summary": summary or "", "node_count": len(nodes or [])},
            db_session=db_session,
            publish_realtime=True,
        )
        if nodes is not None:
            self.replace_nodes(
                session_key=record.session_key,
                nodes=nodes,
                db_session=db_session,
                publish_realtime=True,
            )
        completed = self.complete_session(
            session_key=record.session_key,
            content=(summary or "规划完成，已提交最终工作流并通过校验。").strip(),
            payload={"type": "complete"},
            db_session=db_session,
            publish_realtime=True,
        )
        return self._to_snapshot(completed)

    def fail_session(
        self,
        *,
        session_key: str,
        reason: str,
        payload: dict[str, Any] | None = None,
        db_session: Session,
        publish_realtime: bool = True,
    ) -> FlowPlannerSessionRecord:
        return self._set_terminal_state(
            session_key=session_key,
            status_value="failed",
            message_role="assistant",
            message_kind="error",
            message_content=reason,
            payload=payload,
            db_session=db_session,
            publish_realtime=publish_realtime,
        )

    def fail_by_token(
        self,
        db_session: Session,
        *,
        session_key: str,
        planner_token: str,
        reason: str,
    ) -> PlannerSessionSnapshot:
        record = self.restore_session(
            session_key=session_key,
            planner_token=planner_token,
            include_messages=False,
            db_session=db_session,
        )
        _ensure_session_record_is_mutable(record)
        self.append_message(
            session_key=record.session_key,
            role="assistant",
            kind="planner_request",
            content=(
                "调用规划失败接口 `fail`。\n"
                f"```json\n{_safe_json_dump({'reason': reason})}\n```"
            ),
            payload={"type": "fail", "reason": reason},
            db_session=db_session,
            publish_realtime=True,
        )
        failed = self.fail_session(
            session_key=record.session_key,
            reason=reason,
            payload={"type": "fail"},
            db_session=db_session,
            publish_realtime=True,
        )
        return self._to_snapshot(failed)

    def stop_session(
        self,
        *,
        session_key: str,
        reason: str | None = None,
        payload: dict[str, Any] | None = None,
        db_session: Session,
        publish_realtime: bool = True,
    ) -> FlowPlannerSessionRecord:
        return self._set_terminal_state(
            session_key=session_key,
            status_value="stopped",
            message_role="system",
            message_kind="status",
            message_content=(reason or "规划已停止"),
            payload=payload,
            db_session=db_session,
            publish_realtime=publish_realtime,
        )

    def stop_for_user(
        self,
        db_session: Session,
        *,
        user_id: UUID,
        session_key: str,
    ) -> PlannerSessionSnapshot:
        record = self.restore_session(
            session_key=session_key,
            user_id=user_id,
            include_messages=True,
            db_session=db_session,
        )
        _ensure_session_record_is_mutable(record)
        stopped = self.stop_session(
            session_key=record.session_key,
            reason="已停止当前规划会话。",
            payload={"type": "stop"},
            db_session=db_session,
            publish_realtime=True,
        )
        return self._to_snapshot(stopped)

    def _set_terminal_state(
        self,
        *,
        session_key: str,
        status_value: PlannerSessionStatus,
        message_role: PlannerMessageRole,
        message_kind: PlannerMessageKind,
        message_content: str,
        payload: dict[str, Any] | None,
        db_session: Session,
        publish_realtime: bool,
    ) -> FlowPlannerSessionRecord:
        normalized_session_key = _require_non_empty(session_key, field_name="session_key")
        normalized_status = _normalize_status(status_value)
        normalized_content = message_content.strip()
        normalized_payload = dict(payload or {})
        now = _utc_now()

        with self._session_scope(db_session) as managed_session:
            planner_session = self._get_session_model(
                managed_session,
                session_key=normalized_session_key,
                for_update=True,
            )
            _ensure_session_is_mutable(planner_session)
            if normalized_content:
                planner_message = FlowPlannerMessage(
                    session_key=planner_session.session_key,
                    seq=self._next_message_seq(managed_session, planner_session.session_key),
                    role=_normalize_message_role(message_role),
                    kind=_normalize_message_kind(message_kind),
                    content=normalized_content,
                    payload=normalized_payload,
                    created_at=now,
                )
                managed_session.add(planner_message)

            planner_session.status = normalized_status
            planner_session.updated_at = now
            planner_session.last_error = normalized_content if normalized_status == "failed" else None
            if normalized_status == "completed":
                planner_session.completed_at = now
            else:
                planner_session.completed_at = None
            managed_session.commit()
            managed_session.refresh(planner_session)
            record = self._build_session_record(
                planner_session=planner_session,
                messages=self._load_message_records(
                    managed_session,
                    session_key=planner_session.session_key,
                    limit=_DEFAULT_MESSAGE_LIMIT,
                ),
            )

        if publish_realtime:
            if normalized_content:
                self._publish_messages_updated(record)
            self._publish_session_updated(record)
        return record

    def _publish_messages_updated(self, record: FlowPlannerSessionRecord) -> None:
        self._realtime_hub.publish_messages_updated(
            user_id=record.user_id,
            board_id=record.board_id,
            session_key=record.session_key,
            messages=[message.to_payload() for message in record.messages],
        )

    def _publish_snapshot_updated(self, record: FlowPlannerSessionRecord) -> None:
        self._realtime_hub.publish_snapshot_updated(
            user_id=record.user_id,
            board_id=record.board_id,
            session_key=record.session_key,
            revision=record.revision,
            nodes=[_clone_node_payload(node) for node in record.current_nodes],
        )

    def _publish_session_updated(self, record: FlowPlannerSessionRecord) -> None:
        self._realtime_hub.publish_session_updated(
            user_id=record.user_id,
            board_id=record.board_id,
            session_key=record.session_key,
            status=record.status,
            revision=record.revision,
            updated_at=_serialize_datetime(record.updated_at),
            completed_at=_serialize_datetime(record.completed_at),
            last_error=record.last_error,
        )

    def _publish_node_operations(
        self,
        record: FlowPlannerSessionRecord,
        *,
        operations: list[dict[str, Any]],
    ) -> None:
        self._realtime_hub.publish_nodes_patched(
            user_id=record.user_id,
            board_id=record.board_id,
            session_key=record.session_key,
            revision=record.revision,
            operations=operations,
        )
        self._publish_snapshot_updated(record)
        self._publish_session_updated(record)

    def _find_session_model(
        self,
        db_session: Session,
        *,
        session_key: str,
        user_id: UUID | None = None,
        board_id: str | None = None,
    ) -> FlowPlannerSession | None:
        statement = select(FlowPlannerSession).where(FlowPlannerSession.session_key == session_key)
        if user_id is not None:
            statement = statement.where(FlowPlannerSession.user_id == user_id)
        if board_id is not None:
            statement = statement.where(FlowPlannerSession.board_id == board_id)
        return db_session.execute(statement.limit(1)).scalar_one_or_none()

    def _get_session_model(
        self,
        db_session: Session,
        *,
        session_key: str | None = None,
        planner_token: str | None = None,
        user_id: UUID | str | None = None,
        board_id: str | None = None,
        for_update: bool = False,
    ) -> FlowPlannerSession:
        normalized_session_key = session_key.strip() if isinstance(session_key, str) else ""
        normalized_planner_token = planner_token.strip() if isinstance(planner_token, str) else ""
        if normalized_session_key == "" and normalized_planner_token == "":
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="session_key or planner_token is required")

        statement = select(FlowPlannerSession)
        if normalized_session_key:
            statement = statement.where(FlowPlannerSession.session_key == normalized_session_key)
        if normalized_planner_token:
            statement = statement.where(FlowPlannerSession.planner_token == normalized_planner_token)
        if user_id is not None:
            statement = statement.where(FlowPlannerSession.user_id == _normalize_uuid(user_id, field_name="user_id"))
        if board_id is not None:
            statement = statement.where(FlowPlannerSession.board_id == _normalize_board_id(board_id))
        if for_update:
            statement = statement.with_for_update()
        planner_session = db_session.execute(statement.limit(1)).scalar_one_or_none()
        if planner_session is None:
            detail_key = normalized_session_key or normalized_planner_token
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"planner session not found: {detail_key}")
        return planner_session

    def _load_message_records(
        self,
        db_session: Session,
        *,
        session_key: str,
        limit: int,
    ) -> list[FlowPlannerMessageRecord]:
        normalized_limit = max(1, min(int(limit), 2000))
        statement = (
            select(FlowPlannerMessage)
            .where(FlowPlannerMessage.session_key == session_key)
            .order_by(FlowPlannerMessage.seq.asc())
            .limit(normalized_limit)
        )
        return [self._build_message_record(message) for message in db_session.execute(statement).scalars().all()]

    def _next_message_seq(self, db_session: Session, session_key: str) -> int:
        return (
            db_session.execute(
                select(func.max(FlowPlannerMessage.seq)).where(FlowPlannerMessage.session_key == session_key)
            ).scalar_one()
            or 0
        ) + 1

    @staticmethod
    def _build_message_record(message: FlowPlannerMessage) -> FlowPlannerMessageRecord:
        return FlowPlannerMessageRecord(
            id=str(message.id),
            session_key=message.session_key,
            seq=int(message.seq),
            role=message.role,
            kind=message.kind,
            content=message.content,
            payload=dict(message.payload or {}),
            created_at=message.created_at,
        )

    def _build_session_record(
        self,
        *,
        planner_session: FlowPlannerSession,
        messages: list[FlowPlannerMessageRecord],
    ) -> FlowPlannerSessionRecord:
        return FlowPlannerSessionRecord(
            session_key=planner_session.session_key,
            user_id=planner_session.user_id,
            board_id=planner_session.board_id,
            instance_id=planner_session.instance_id,
            planner_agent_id=planner_session.planner_agent_id,
            planner_token=planner_session.planner_token,
            flow_name=planner_session.flow_name,
            status=planner_session.status,
            revision=int(planner_session.revision),
            current_nodes=[_normalize_node_payload(item) for item in planner_session.current_nodes],
            last_error=planner_session.last_error,
            created_at=planner_session.created_at,
            updated_at=planner_session.updated_at,
            completed_at=planner_session.completed_at,
            messages=messages,
        )

    def _to_snapshot(self, record: FlowPlannerSessionRecord) -> PlannerSessionSnapshot:
        return PlannerSessionSnapshot(
            session_key=record.session_key,
            planner_token=record.planner_token,
            planner_agent_id=record.planner_agent_id,
            board_id=record.board_id,
            flow_name=record.flow_name,
            status=record.status,
            revision=record.revision,
            nodes=[_clone_node_payload(node) for node in record.current_nodes],
            updated_at=_serialize_datetime(record.updated_at),
            messages=[message.to_payload() for message in record.messages],
            last_error=record.last_error,
        )

    @contextmanager
    def _session_scope(self, db_session: Session | None) -> Iterator[Session]:
        if db_session is None:
            raise RuntimeError("db_session is required")
        yield db_session


_GLOBAL_FLOW_PLANNER_SESSION_SERVICE = FlowPlannerSessionService()


def get_flow_planner_session_service() -> FlowPlannerSessionService:
    return _GLOBAL_FLOW_PLANNER_SESSION_SERVICE


def _normalize_uuid(value: UUID | str | None, *, field_name: str, required: bool = True) -> UUID | None:
    if value is None:
        if required:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"{field_name} is required")
        return None
    if isinstance(value, UUID):
        return value
    text = value.strip()
    if text == "":
        if required:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"{field_name} is required")
        return None
    try:
        return UUID(text)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"{field_name} is invalid") from exc


def _normalize_board_id(board_id: str) -> str:
    normalized = board_id.strip() if isinstance(board_id, str) else ""
    return normalized or _DEFAULT_BOARD_ID


def _normalize_planner_agent_id(planner_agent_id: str | None) -> str:
    normalized = planner_agent_id.strip() if isinstance(planner_agent_id, str) else ""
    return normalized or _DEFAULT_PLANNER_AGENT_ID


def _normalize_session_key(session_key: str | None, *, board_id: str, planner_agent_id: str) -> str:
    normalized = session_key.strip() if isinstance(session_key, str) else ""
    if normalized:
        return normalized
    return f"linpo:flow:{board_id}:planner:{planner_agent_id}:{uuid4().hex}"


def _normalize_planner_token(planner_token: str | None) -> str:
    normalized = planner_token.strip() if isinstance(planner_token, str) else ""
    return normalized or token_urlsafe(24)


def _ensure_session_is_mutable(planner_session: FlowPlannerSession) -> None:
    status_value = str(planner_session.status).strip() or "planning"
    if status_value != "planning":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"planner session is already {status_value}",
        )


def _ensure_session_record_is_mutable(record: FlowPlannerSessionRecord) -> None:
    status_value = str(record.status).strip() or "planning"
    if status_value != "planning":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"planner session is already {status_value}",
        )


def _normalize_flow_name(flow_name: str | None) -> str:
    normalized = flow_name.strip() if isinstance(flow_name, str) else ""
    return normalized or _DEFAULT_FLOW_NAME


def _normalize_message_role(role: str) -> str:
    normalized = role.strip().lower() if isinstance(role, str) else ""
    if normalized not in {"user", "assistant", "system"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="invalid planner message role")
    return normalized


def _normalize_message_kind(kind: str) -> str:
    normalized = kind.strip().lower() if isinstance(kind, str) else ""
    return normalized or "message"


def _normalize_status(value: str) -> str:
    normalized = value.strip().lower() if isinstance(value, str) else ""
    if normalized not in _ALLOWED_STATUSES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="invalid planner session status")
    return normalized


def _normalize_node_payload(node: PlannerNodePayload) -> PlannerNodePayload:
    if not isinstance(node, dict):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="planner node payload must be an object")
    node_id = _require_non_empty(node.get("id"), field_name="node.id")
    title = _require_non_empty(node.get("title"), field_name="node.title")
    description_raw = node.get("description")
    description = description_raw.strip() if isinstance(description_raw, str) else ""
    sensitive = bool(node.get("sensitive", False))
    depends_on: list[str] = []
    seen: set[str] = set()
    for item in node.get("depends_on", []) if isinstance(node.get("depends_on", []), list) else []:
        if not isinstance(item, str):
            continue
        dependency = item.strip()
        if dependency == "" or dependency == node_id or dependency in seen:
            continue
        seen.add(dependency)
        depends_on.append(dependency)
    return {
        "id": node_id,
        "title": title,
        "description": description,
        "depends_on": depends_on,
        "sensitive": sensitive,
    }


def _clone_node_payload(node: PlannerNodePayload) -> PlannerNodePayload:
    return {
        "id": str(node["id"]),
        "title": str(node["title"]),
        "description": str(node.get("description", "")),
        "depends_on": [str(item) for item in node.get("depends_on", []) if isinstance(item, str)],
        "sensitive": bool(node.get("sensitive", False)),
    }


def _build_node_operations(
    previous_nodes: list[PlannerNodePayload],
    current_nodes: list[PlannerNodePayload],
) -> list[dict[str, Any]]:
    previous_by_id = {str(node["id"]): _clone_node_payload(node) for node in previous_nodes}
    current_by_id = {str(node["id"]): _clone_node_payload(node) for node in current_nodes}
    operations: list[dict[str, Any]] = []
    for node_id in previous_by_id:
        if node_id not in current_by_id:
            operations.append({"type": "delete_node", "node_id": node_id})
    for node in current_nodes:
        node_id = str(node["id"])
        if previous_by_id.get(node_id) != current_by_id[node_id]:
            operations.append({"type": "upsert_node", "node": current_by_id[node_id]})
    return operations


def _validate_completion_nodes(nodes: list[PlannerNodePayload]) -> str | None:
    if len(nodes) < 2 or len(nodes) > 12:
        return "planner session completion requires 2-12 nodes"

    seen_ids: set[str] = set()
    for node in nodes:
        node_id = str(node["id"])
        if node_id in seen_ids:
            return f"planner session completion found duplicate node id: {node_id}"
        seen_ids.add(node_id)

    sensitive_count = 0
    for node in nodes:
        if bool(node.get("sensitive", False)):
            sensitive_count += 1
        for dependency in node.get("depends_on", []):
            if dependency not in seen_ids:
                return f"planner session completion found unknown dependency: {dependency}"

    if sensitive_count == 0:
        return "planner session completion requires at least one sensitive node"
    if _detect_cycle(nodes):
        return "planner session completion found cyclic depends_on"
    return None


def _detect_cycle(nodes: list[PlannerNodePayload]) -> bool:
    indegree = {str(node["id"]): 0 for node in nodes}
    graph: dict[str, list[str]] = {str(node["id"]): [] for node in nodes}
    for node in nodes:
        node_id = str(node["id"])
        for dependency in node.get("depends_on", []):
            graph.setdefault(str(dependency), []).append(node_id)
            indegree[node_id] = indegree.get(node_id, 0) + 1
    queue = [node_id for node_id, degree in indegree.items() if degree == 0]
    visited = 0
    while queue:
        current = queue.pop(0)
        visited += 1
        for next_node in graph.get(current, []):
            indegree[next_node] -= 1
            if indegree[next_node] == 0:
                queue.append(next_node)
    return visited != len(indegree)


def _require_non_empty(value: object, *, field_name: str) -> str:
    if not isinstance(value, str):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"{field_name} is required")
    normalized = value.strip()
    if normalized == "":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"{field_name} is required")
    return normalized


def _utc_now() -> datetime:
    return datetime.now(tz=UTC)


def _serialize_datetime(value: datetime | None) -> str | None:
    if value is None:
        return None
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def _safe_json_dump(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True)
