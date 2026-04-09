from __future__ import annotations

from types import SimpleNamespace
from uuid import UUID

import pytest
from fastapi import HTTPException

from app.services.instance_service import InstanceNotFoundError
from app.api.tasks_flow_planner import (
    _build_structured_fallback_canvas_nodes,
    _is_requesting_system_default_planner_agent,
    _is_retryable_provider_sync_error,
    _list_available_planner_agent_ids,
    _planner_snapshot_to_canvas_nodes,
    _resolve_requested_or_default_instance_id,
    _resolve_flow_planner_agent_id,
    _validate_planner_agent_membership_if_available,
)


def test_planner_snapshot_to_canvas_nodes_accepts_nodes_and_depends_on_contract() -> None:
    snapshot = SimpleNamespace(
        nodes=[
            {
                "id": "node_1",
                "title": "步骤1",
                "description": "说明1",
                "depends_on": [],
                "sensitive": False,
            },
            {
                "id": "node_2",
                "title": "步骤2",
                "description": "说明2",
                "depends_on": ["node_1"],
                "sensitive": True,
            },
        ],
        planner_agent_id="planner-default",
    )

    nodes = _planner_snapshot_to_canvas_nodes(snapshot)

    assert [node.id for node in nodes] == ["node_1", "node_2"]
    assert nodes[0].depends_on == []
    assert nodes[1].depends_on == ["node_1"]
    assert nodes[0].agent_id is None
    assert nodes[1].agent_id is None


def test_planner_snapshot_to_canvas_nodes_preserves_explicit_node_agent_id() -> None:
    snapshot = SimpleNamespace(
        nodes=[
            {
                "id": "node_1",
                "title": "步骤1",
                "description": "说明1",
                "depends_on": [],
                "sensitive": False,
                "agent_id": "agent-explicit",
                "x": 160,
                "y": 120,
                "layer": 1,
                "status": "queued",
            }
        ],
        planner_agent_id="planner-default",
    )

    nodes = _planner_snapshot_to_canvas_nodes(snapshot)

    assert len(nodes) == 1
    assert nodes[0].agent_id == "agent-explicit"


def test_planner_snapshot_to_canvas_nodes_rejects_missing_nodes_field() -> None:
    snapshot = SimpleNamespace(
        current_nodes=[
            {
                "id": "node_1",
                "title": "步骤1",
                "description": "说明1",
                "depends_on": [],
                "sensitive": False,
            }
        ]
    )

    with pytest.raises(HTTPException) as exc_info:
        _planner_snapshot_to_canvas_nodes(snapshot)

    assert exc_info.value.status_code == 500
    assert exc_info.value.detail == "planner snapshot missing required field: nodes"


def test_planner_snapshot_to_canvas_nodes_rejects_missing_depends_on_field() -> None:
    snapshot = SimpleNamespace(
        nodes=[
            {
                "id": "node_1",
                "title": "步骤1",
                "description": "说明1",
                "dependencies": [],
                "sensitive": False,
            }
        ]
    )

    with pytest.raises(HTTPException) as exc_info:
        _planner_snapshot_to_canvas_nodes(snapshot)

    assert exc_info.value.status_code == 500
    assert exc_info.value.detail == "planner snapshot nodes[0] missing required field: depends_on"


def test_planner_snapshot_to_canvas_nodes_rejects_non_list_depends_on_field() -> None:
    snapshot = SimpleNamespace(
        nodes=[
            {
                "id": "node_1",
                "title": "步骤1",
                "description": "说明1",
                "depends_on": "node_x",
                "sensitive": False,
            }
        ]
    )

    with pytest.raises(HTTPException) as exc_info:
        _planner_snapshot_to_canvas_nodes(snapshot)

    assert exc_info.value.status_code == 500
    assert exc_info.value.detail == "planner snapshot nodes[0] field depends_on must be a list"


def test_resolve_flow_planner_agent_id_prefers_request_value() -> None:
    resolved = _resolve_flow_planner_agent_id(" planner-x ", default_agent_id="planner-default")
    assert resolved == "planner-x"


def test_resolve_flow_planner_agent_id_falls_back_to_default_for_blank_input() -> None:
    resolved = _resolve_flow_planner_agent_id("   ", default_agent_id="planner-default")
    assert resolved == "planner-default"


def test_is_requesting_system_default_planner_agent_matches_same_agent_id() -> None:
    assert _is_requesting_system_default_planner_agent(
        request_planner_agent_id="planner-default",
        system_default_planner_agent_id="planner-default",
    )


def test_is_requesting_system_default_planner_agent_rejects_blank_or_custom_agent_id() -> None:
    assert not _is_requesting_system_default_planner_agent(
        request_planner_agent_id="",
        system_default_planner_agent_id="planner-default",
    )
    assert not _is_requesting_system_default_planner_agent(
        request_planner_agent_id="planner-custom",
        system_default_planner_agent_id="planner-default",
    )


def test_validate_planner_agent_membership_rejects_missing_agent() -> None:
    class _FakeDataSource:
        def list_agents(self) -> list[SimpleNamespace]:
            return [SimpleNamespace(id="agent-a")]

    class _FakeProviderApplicationService:
        def resolve_observer_data_source(self, data_source: str, execution_context: object) -> _FakeDataSource:
            del data_source, execution_context
            return _FakeDataSource()

    with pytest.raises(HTTPException) as exc_info:
        _validate_planner_agent_membership_if_available(
            provider_application_service=_FakeProviderApplicationService(),  # type: ignore[arg-type]
            execution_context=object(),  # type: ignore[arg-type]
            planner_agent_id="agent-b",
        )

    assert exc_info.value.status_code == 400
    assert exc_info.value.detail == "planner_agent_id is not available in current instance"


def test_validate_planner_agent_membership_rejects_unreadable_agents() -> None:
    class _FakeProviderApplicationService:
        def resolve_observer_data_source(self, data_source: str, execution_context: object) -> object:
            del data_source, execution_context
            raise HTTPException(status_code=503, detail="upstream failed")

    with pytest.raises(HTTPException) as exc_info:
        _validate_planner_agent_membership_if_available(
            provider_application_service=_FakeProviderApplicationService(),  # type: ignore[arg-type]
            execution_context=object(),  # type: ignore[arg-type]
            planner_agent_id="agent-a",
        )

    assert exc_info.value.status_code == 503
    assert exc_info.value.detail == "planner_agent_id validation failed: cannot read instance agents"


def test_validate_planner_agent_membership_uses_custom_data_source_name() -> None:
    class _FakeDataSource:
        def list_agents(self) -> list[SimpleNamespace]:
            return [SimpleNamespace(id="agent-a")]

    class _FakeProviderApplicationService:
        def __init__(self) -> None:
            self.last_data_source_name: str | None = None

        def resolve_observer_data_source(self, data_source: str, execution_context: object) -> _FakeDataSource:
            del execution_context
            self.last_data_source_name = data_source
            return _FakeDataSource()

    service = _FakeProviderApplicationService()
    _validate_planner_agent_membership_if_available(
        provider_application_service=service,  # type: ignore[arg-type]
        execution_context=object(),  # type: ignore[arg-type]
        planner_agent_id="agent-a",
        data_source_name="mock-provider",
    )
    assert service.last_data_source_name == "mock-provider"


def test_list_available_planner_agent_ids_preserves_provider_order_and_deduplicates() -> None:
    class _FakeDataSource:
        def list_agents(self) -> list[SimpleNamespace]:
            return [
                SimpleNamespace(id="agent-b"),
                SimpleNamespace(id="agent-a"),
                SimpleNamespace(id="agent-b"),
                SimpleNamespace(id=""),
                SimpleNamespace(id="  "),
            ]

    class _FakeProviderApplicationService:
        def resolve_observer_data_source(self, data_source: str, execution_context: object) -> _FakeDataSource:
            del data_source, execution_context
            return _FakeDataSource()

    available_agent_ids = _list_available_planner_agent_ids(
        provider_application_service=_FakeProviderApplicationService(),  # type: ignore[arg-type]
        execution_context=object(),  # type: ignore[arg-type]
    )

    assert available_agent_ids == ["agent-b", "agent-a"]


def test_list_available_planner_agent_ids_uses_custom_data_source_name() -> None:
    class _FakeDataSource:
        def list_agents(self) -> list[SimpleNamespace]:
            return [SimpleNamespace(id="agent-a")]

    class _FakeProviderApplicationService:
        def __init__(self) -> None:
            self.last_data_source_name: str | None = None

        def resolve_observer_data_source(self, data_source: str, execution_context: object) -> _FakeDataSource:
            del execution_context
            self.last_data_source_name = data_source
            return _FakeDataSource()

    service = _FakeProviderApplicationService()
    available_agent_ids = _list_available_planner_agent_ids(
        provider_application_service=service,  # type: ignore[arg-type]
        execution_context=object(),  # type: ignore[arg-type]
        data_source_name="mock-provider",
    )
    assert available_agent_ids == ["agent-a"]
    assert service.last_data_source_name == "mock-provider"


def test_is_retryable_provider_sync_error_returns_true_for_retryable_http_exception() -> None:
    exc = HTTPException(status_code=404, detail="history not found")
    assert _is_retryable_provider_sync_error(exc)


def test_is_retryable_provider_sync_error_returns_false_for_non_retryable_http_exception() -> None:
    exc = HTTPException(status_code=400, detail="planner response malformed")
    assert not _is_retryable_provider_sync_error(exc)


def test_build_structured_fallback_canvas_nodes_provides_executable_description_template() -> None:
    nodes = _build_structured_fallback_canvas_nodes(
        requirement="生成发布说明并附带变更摘要",
        executor_agent_id="agent-main",
    )

    assert len(nodes) == 2
    execute_node = nodes[1]
    assert execute_node.depends_on == [nodes[0].id]
    assert "输入：" in execute_node.description
    assert "输出：" in execute_node.description
    assert "验收：" in execute_node.description
    assert "失败条件：" in execute_node.description


def test_resolve_requested_or_default_instance_id_falls_back_to_first_owned_instance() -> None:
    user_id = "user-1"
    instance_id = "11111111-1111-1111-1111-111111111111"

    class _FakeInstanceService:
        def get_openclaw_context(self, db_session: object, *, user_id: object, instance_id: object) -> object:
            del db_session, user_id, instance_id
            raise InstanceNotFoundError("missing")

        def list_instances(self, db_session: object, *, user_id: object) -> list[SimpleNamespace]:
            del db_session
            assert user_id == "user-1"
            return [SimpleNamespace(id=UUID(instance_id))]

    resolved = _resolve_requested_or_default_instance_id(
        raw_instance_id="not-a-uuid",
        db_session=object(),  # type: ignore[arg-type]
        current_user=SimpleNamespace(id=user_id),  # type: ignore[arg-type]
        instance_service=_FakeInstanceService(),  # type: ignore[arg-type]
    )

    assert resolved == UUID(instance_id)
