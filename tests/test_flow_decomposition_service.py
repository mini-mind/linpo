from __future__ import annotations

from typing import Any, cast

from fastapi import HTTPException
import pytest

import app.services.flow_decomposition_service as flow_decomposition_service
from app.services.flow_decomposition_service import FlowDecompositionService


def _assert_contains_keywords(text: str, keywords: tuple[str, ...]) -> None:
    for keyword in keywords:
        assert keyword in text


def _install_fast_clock(
    monkeypatch: pytest.MonkeyPatch,
    *,
    monotonic_step: float,
) -> None:
    tick = {"value": -monotonic_step}

    def _fake_monotonic() -> float:
        tick["value"] += monotonic_step
        return tick["value"]

    monkeypatch.setattr(flow_decomposition_service.time, "monotonic", _fake_monotonic)
    monkeypatch.setattr(flow_decomposition_service.time, "sleep", lambda _: None)


@pytest.fixture(autouse=True)
def _set_required_flow_decomposition_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("FLOW_DECOMPOSITION_AGENT_ID", "planner-default")
    monkeypatch.setenv("OPENCLAW_BASE_URL", "ws://test-openclaw:38789")
    monkeypatch.setenv("OPENCLAW_ORIGIN", "http://test-openclaw:38789")
    monkeypatch.setenv("OPENCLAW_GATEWAY_TOKEN", "test-token")


def test_decompose_returns_nodes_from_provider_history_payload() -> None:
    class FakeProviderApplicationService:
        def __init__(self) -> None:
            self.send_calls: list[dict[str, Any]] = []

        def send_chat_message(self, **kwargs: Any) -> dict[str, Any]:
            self.send_calls.append(kwargs)
            return {"request_id": "req-1", "status": "accepted", "agent_id": kwargs["agent_id"]}

        def chat_history(self, **kwargs: Any) -> dict[str, Any]:
            return {
                "messages": [
                    {"role": "user", "text": "input"},
                    {
                        "role": "assistant",
                        "content": [
                            {
                                "type": "text",
                                "text": '```json\n{"nodes":[{"id":"a","title":"需求分析","depends_on":[],"sensitive":false},{"id":"b","title":"方案落地","depends_on":["a"],"sensitive":true}]}\n```',
                            }
                        ],
                    },
                ]
            }

    fake = FakeProviderApplicationService()
    service = FlowDecompositionService(provider_application_service=cast(Any, fake))

    result = service.decompose(requirement="做一个发布流程", board_id="default")

    assert result.planner_session_key.startswith("linpo:flow:default:planner:planner-default:")
    assert len(result.nodes) == 2
    assert result.nodes[0].id == "a"
    assert result.nodes[1].depends_on == ["a"]
    assert result.nodes[1].sensitive is True
    assert len(fake.send_calls) == 1
    assert fake.send_calls[0]["agent_id"] == "planner-default"
    _assert_contains_keywords(
        cast(str, fake.send_calls[0]["message"]),
        ("subagent", "depends_on", "输出路径"),
    )


def test_decompose_marks_last_node_sensitive_when_missing_flag() -> None:
    class FakeProviderApplicationService:
        def send_chat_message(self, **kwargs: Any) -> dict[str, Any]:
            del kwargs
            return {"request_id": "req-1", "status": "accepted", "agent_id": "main"}

        def chat_history(self, **kwargs: Any) -> dict[str, Any]:
            del kwargs
            return {
                "messages": [
                    {
                        "role": "assistant",
                        "text": '{"nodes":[{"id":"n1","title":"步骤1","depends_on":[]},{"id":"n2","title":"步骤2","depends_on":["n1"]}]}',
                    }
                ]
            }

    service = FlowDecompositionService(
        provider_application_service=cast(Any, FakeProviderApplicationService())
    )
    result = service.decompose(requirement="拆解任务", board_id="default")

    assert len(result.nodes) == 2
    assert result.nodes[0].sensitive is False
    assert result.nodes[1].sensitive is True


def test_decompose_raises_when_planner_never_returns_json(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_fast_clock(monkeypatch, monotonic_step=61.0)

    class FakeProviderApplicationService:
        def send_chat_message(self, **kwargs: Any) -> dict[str, Any]:
            del kwargs
            return {"request_id": "req-1", "status": "accepted", "agent_id": "main"}

        def chat_history(self, **kwargs: Any) -> dict[str, Any]:
            del kwargs
            return {"messages": [{"role": "assistant", "text": "处理中，请稍后"}]}

    service = FlowDecompositionService(
        provider_application_service=cast(Any, FakeProviderApplicationService())
    )

    with pytest.raises(HTTPException, match="did not return structured JSON"):
        service.decompose(requirement="拆解任务", board_id="default")


def test_decompose_repairs_non_json_reply_in_same_session(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_fast_clock(monkeypatch, monotonic_step=1.0)

    class FakeProviderApplicationService:
        def __init__(self) -> None:
            self.send_calls: list[dict[str, Any]] = []
            self.history_calls = 0

        def send_chat_message(self, **kwargs: Any) -> dict[str, Any]:
            self.send_calls.append(kwargs)
            return {"request_id": f"req-{len(self.send_calls)}", "status": "accepted", "agent_id": "planner-default"}

        def chat_history(self, **kwargs: Any) -> dict[str, Any]:
            del kwargs
            self.history_calls += 1
            if self.history_calls == 1:
                return {
                    "messages": [
                        {
                            "role": "assistant",
                            "content": [{"type": "text", "text": "你需要我拆解什么流程？请补充描述。"}],
                            "timestamp": 1001,
                        }
                    ]
                }
            return {
                "messages": [
                    {
                        "role": "assistant",
                        "content": [
                            {
                                "type": "text",
                                "text": '{"nodes":[{"id":"a","title":"需求分析","description":"梳理输入并可委派 subagent 并行执行","depends_on":[],"sensitive":false},{"id":"b","title":"发布执行","description":"写出发布步骤并回写到指定输出路径","depends_on":["a"],"sensitive":true}]}',
                            }
                        ],
                        "timestamp": 1002,
                    }
                ]
            }

    fake = FakeProviderApplicationService()
    service = FlowDecompositionService(provider_application_service=cast(Any, fake))

    result = service.decompose(requirement="拆解发布流程", board_id="default")

    assert len(result.nodes) == 2
    assert result.nodes[1].depends_on == ["a"]
    assert len(fake.send_calls) == 2
    assert fake.send_calls[0]["session_key"] == fake.send_calls[1]["session_key"]
    _assert_contains_keywords(
        cast(str, fake.send_calls[1]["message"]),
        ("合法 JSON", '"nodes"', "id/title/description/depends_on/sensitive"),
    )


def test_decompose_retries_retryable_history_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_fast_clock(monkeypatch, monotonic_step=1.0)

    class FakeProviderApplicationService:
        def __init__(self) -> None:
            self.history_calls = 0

        def send_chat_message(self, **kwargs: Any) -> dict[str, Any]:
            del kwargs
            return {"request_id": "req-1", "status": "accepted", "agent_id": "planner-default"}

        def chat_history(self, **kwargs: Any) -> dict[str, Any]:
            del kwargs
            self.history_calls += 1
            if self.history_calls == 1:
                raise HTTPException(status_code=503, detail="OpenClaw control response timed out")
            return {
                "messages": [
                    {
                        "role": "assistant",
                        "text": '{"nodes":[{"id":"n1","title":"步骤1","description":"说明","depends_on":[],"sensitive":true}]}',
                    }
                ]
            }

    service = FlowDecompositionService(
        provider_application_service=cast(Any, FakeProviderApplicationService())
    )

    result = service.decompose(requirement="拆解任务", board_id="default")

    assert len(result.nodes) == 1
    assert result.nodes[0].id == "n1"


def test_decompose_waits_for_delayed_but_valid_json_reply(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_fast_clock(monkeypatch, monotonic_step=1.0)

    class FakeProviderApplicationService:
        def __init__(self) -> None:
            self.history_calls = 0

        def send_chat_message(self, **kwargs: Any) -> dict[str, Any]:
            del kwargs
            return {"request_id": "req-1", "status": "accepted", "agent_id": "planner-default"}

        def chat_history(self, **kwargs: Any) -> dict[str, Any]:
            del kwargs
            self.history_calls += 1
            if self.history_calls <= 45:
                return {
                    "messages": [
                        {
                            "role": "assistant",
                            "text": "处理中，请继续等待",
                        }
                    ]
                }
            return {
                "messages": [
                    {
                        "role": "assistant",
                        "text": '{"nodes":[{"id":"n1","title":"抓取数据","description":"输出 github_trending_today.json","depends_on":[],"sensitive":false},{"id":"n2","title":"审批确认","description":"读取 github_trending_today.json 并输出 business_canvas.md","depends_on":["n1"],"sensitive":true}]}',
                    }
                ]
            }

    fake = FakeProviderApplicationService()
    service = FlowDecompositionService(provider_application_service=cast(Any, fake))

    result = service.decompose(requirement="拆解任务", board_id="default")

    assert fake.history_calls > 40
    assert len(result.nodes) == 2
    assert result.nodes[1].depends_on == ["n1"]


def test_decompose_supports_incremental_prompt_context_and_reuses_planner_session() -> None:
    class FakeProviderApplicationService:
        def __init__(self) -> None:
            self.send_calls: list[dict[str, Any]] = []

        def send_chat_message(self, **kwargs: Any) -> dict[str, Any]:
            self.send_calls.append(kwargs)
            return {"request_id": "req-1", "status": "accepted", "agent_id": "main"}

        def chat_history(self, **kwargs: Any) -> dict[str, Any]:
            del kwargs
            return {
                "messages": [
                    {
                        "role": "assistant",
                        "text": '{"nodes":[{"id":"n1","title":"步骤1","depends_on":[],"sensitive":true}]}',
                    }
                ]
            }

    fake = FakeProviderApplicationService()
    service = FlowDecompositionService(provider_application_service=cast(Any, fake))
    session_key = "linpo:flow:default:planner:planner-default:reuse"

    result = service.decompose(
        requirement="把验收前置并补并行分支",
        board_id="default",
        planner_session_key=session_key,
        flow_name="测试流程",
        current_nodes=[
            {
                "id": "n1",
                "title": "步骤1",
                "description": "旧描述应保留",
                "sensitive": False,
            }
        ],
        current_edges=[],
    )

    assert result.planner_session_key == session_key
    assert len(fake.send_calls) == 1
    assert fake.send_calls[0]["session_key"] == session_key
    _assert_contains_keywords(
        cast(str, fake.send_calls[0]["message"]),
        ("flow_name", "测试流程", '"id": "n1"', "新增指令"),
    )
    assert result.nodes[0].description == "旧描述应保留"


def test_decompose_supports_steps_alias_payload_and_normalizes_fields() -> None:
    class FakeProviderApplicationService:
        def send_chat_message(self, **kwargs: Any) -> dict[str, Any]:
            del kwargs
            return {"request_id": "req-1", "status": "accepted", "agent_id": "planner-default"}

        def chat_history(self, **kwargs: Any) -> dict[str, Any]:
            del kwargs
            return {
                "messages": [
                    {
                        "role": "assistant",
                        "text": (
                            '{"steps":['
                            '{"name":"需求澄清","details":"确认输入输出","dependencies":[],"approval_required":false},'
                            '{"task":"执行交付","summary":"产出结果并审批","dependencies":["node_1"],"approval_required":true}'
                            ']}'
                        ),
                    }
                ]
            }

    service = FlowDecompositionService(
        provider_application_service=cast(Any, FakeProviderApplicationService())
    )
    result = service.decompose(requirement="拆解任务", board_id="default")

    assert len(result.nodes) == 2
    assert result.nodes[0].id == "node_1"
    assert result.nodes[0].title == "需求澄清"
    assert result.nodes[0].description == "确认输入输出"
    assert result.nodes[1].id == "node_2"
    assert result.nodes[1].title == "执行交付"
    assert result.nodes[1].depends_on == ["node_1"]
    assert result.nodes[1].sensitive is True


def test_decompose_supports_add_nodes_alias_payload() -> None:
    class FakeProviderApplicationService:
        def send_chat_message(self, **kwargs: Any) -> dict[str, Any]:
            del kwargs
            return {"request_id": "req-1", "status": "accepted", "agent_id": "planner-default"}

        def chat_history(self, **kwargs: Any) -> dict[str, Any]:
            del kwargs
            return {
                "messages": [
                    {
                        "role": "assistant",
                        "text": (
                            '{"result":{"add_nodes":['
                            '{"node_id":"n_init","name":"初始化","details":"准备输入","dependencies":[]},'
                            '{"id":"n_exec","title":"执行","description":"输出结果","dependsOn":["n_init"],"sensitive":true}'
                            ']}}'
                        ),
                    }
                ]
            }

    service = FlowDecompositionService(
        provider_application_service=cast(Any, FakeProviderApplicationService())
    )
    result = service.decompose(requirement="拆解任务", board_id="default")

    assert len(result.nodes) == 2
    assert result.nodes[0].id == "n_init"
    assert result.nodes[0].title == "初始化"
    assert result.nodes[1].id == "n_exec"
    assert result.nodes[1].depends_on == ["n_init"]
    assert result.nodes[1].sensitive is True


def test_decompose_supports_python_like_nodes_payload_with_single_quotes() -> None:
    class FakeProviderApplicationService:
        def send_chat_message(self, **kwargs: Any) -> dict[str, Any]:
            del kwargs
            return {"request_id": "req-1", "status": "accepted", "agent_id": "planner-default"}

        def chat_history(self, **kwargs: Any) -> dict[str, Any]:
            del kwargs
            return {
                "messages": [
                    {
                        "role": "assistant",
                        "text": (
                            "flow draft: {'add_nodes':["
                            "{'id':'n1','title':'准备输入','depends_on':[],'sensitive':false},"
                            "{'id':'n2','title':'执行输出','depends_on':['n1'],'sensitive':true}"
                            "]}"
                        ),
                    }
                ]
            }

    service = FlowDecompositionService(
        provider_application_service=cast(Any, FakeProviderApplicationService())
    )
    result = service.decompose(requirement="拆解任务", board_id="default")

    assert len(result.nodes) == 2
    assert result.nodes[0].id == "n1"
    assert result.nodes[1].id == "n2"
    assert result.nodes[1].depends_on == ["n1"]
    assert result.nodes[1].sensitive is True


def test_decompose_supports_loose_keyed_array_payload_without_outer_object() -> None:
    class FakeProviderApplicationService:
        def send_chat_message(self, **kwargs: Any) -> dict[str, Any]:
            del kwargs
            return {"request_id": "req-1", "status": "accepted", "agent_id": "planner-default"}

        def chat_history(self, **kwargs: Any) -> dict[str, Any]:
            del kwargs
            return {
                "messages": [
                    {
                        "role": "assistant",
                        "text": (
                            "add_nodes:["
                            "{'id':'x1','name':'拆解输入','dependencies':[]},"
                            "{'id':'x2','task':'执行交付','dependencies':['x1'],'approval_required':true}"
                            "]"
                        ),
                    }
                ]
            }

    service = FlowDecompositionService(
        provider_application_service=cast(Any, FakeProviderApplicationService())
    )
    result = service.decompose(requirement="拆解任务", board_id="default")

    assert len(result.nodes) == 2
    assert result.nodes[0].id == "x1"
    assert result.nodes[1].id == "x2"
    assert result.nodes[1].depends_on == ["x1"]
    assert result.nodes[1].sensitive is True


def test_decompose_supports_fragmented_node_objects_without_wrapping_json() -> None:
    class FakeProviderApplicationService:
        def send_chat_message(self, **kwargs: Any) -> dict[str, Any]:
            del kwargs
            return {"request_id": "req-1", "status": "accepted", "agent_id": "planner-default"}

        def chat_history(self, **kwargs: Any) -> dict[str, Any]:
            del kwargs
            return {
                "messages": [
                    {
                        "role": "assistant",
                        "text": (
                            "拆解建议如下："
                            "{'id':'m1','title':'梳理输入','depends_on':[],'sensitive':false}"
                            "{'id':'m2','name':'执行产出','dependencies':['m1'],'approval_required':true}"
                        ),
                    }
                ]
            }

    service = FlowDecompositionService(
        provider_application_service=cast(Any, FakeProviderApplicationService())
    )
    result = service.decompose(requirement="拆解任务", board_id="default")

    assert len(result.nodes) == 2
    assert result.nodes[0].id == "m1"
    assert result.nodes[1].id == "m2"
    assert result.nodes[1].depends_on == ["m1"]
    assert result.nodes[1].sensitive is True


def test_decompose_reports_payload_keys_when_nodes_missing() -> None:
    class FakeProviderApplicationService:
        def send_chat_message(self, **kwargs: Any) -> dict[str, Any]:
            del kwargs
            return {"request_id": "req-1", "status": "accepted", "agent_id": "planner-default"}

        def chat_history(self, **kwargs: Any) -> dict[str, Any]:
            del kwargs
            return {
                "messages": [
                    {
                        "role": "assistant",
                        "text": '{"result":{"summary":"ok"},"meta":{"source":"planner"}}',
                    }
                ]
            }

    service = FlowDecompositionService(
        provider_application_service=cast(Any, FakeProviderApplicationService())
    )
    with pytest.raises(HTTPException) as exc_info:
        service.decompose(requirement="拆解任务", board_id="default")

    assert "missing nodes" in str(exc_info.value.detail)
    assert "payload keys" in str(exc_info.value.detail)


def test_decompose_accepts_custom_planner_agent_id() -> None:
    class FakeProviderApplicationService:
        def send_chat_message(self, **kwargs: Any) -> dict[str, Any]:
            del kwargs
            return {"request_id": "req-1", "status": "accepted", "agent_id": "planner-x"}

        def chat_history(self, **kwargs: Any) -> dict[str, Any]:
            del kwargs
            return {
                "messages": [
                    {
                        "role": "assistant",
                        "text": '{"nodes":[{"id":"n1","title":"步骤1","depends_on":[],"sensitive":true}]}',
                    }
                ]
            }

    service = FlowDecompositionService(
        provider_application_service=cast(Any, FakeProviderApplicationService())
    )

    result = service.decompose(
        requirement="拆解任务",
        board_id="default",
        planner_agent_id="planner-x",
    )
    assert result.planner_session_key.startswith("linpo:flow:default:planner:planner-x:")


def test_dispatch_planner_returns_session_key_without_waiting() -> None:
    class FakeProviderApplicationService:
        def __init__(self) -> None:
            self.send_calls: list[dict[str, Any]] = []

        def send_chat_message(self, **kwargs: Any) -> dict[str, Any]:
            self.send_calls.append(kwargs)
            return {"request_id": "req-dispatch", "status": "accepted", "agent_id": kwargs["agent_id"]}

    fake = FakeProviderApplicationService()
    service = FlowDecompositionService(provider_application_service=cast(Any, fake))
    session_key = "linpo:flow:default:planner:planner-default:fast"

    dispatch = service.dispatch_planner(
        requirement="快速生成当前草图",
        board_id="default",
        planner_session_key=session_key,
        current_nodes=[],
        current_edges=[],
    )

    assert dispatch.planner_session_key == session_key
    assert dispatch.planner_agent_id == "planner-default"
    assert len(fake.send_calls) == 1
    assert fake.send_calls[0]["session_key"] == session_key


def test_dispatch_planner_uses_injected_execution_context_without_building_default() -> None:
    class FakeProviderApplicationService:
        def __init__(self) -> None:
            self.send_calls: list[dict[str, Any]] = []

        def send_chat_message(self, **kwargs: Any) -> dict[str, Any]:
            self.send_calls.append(kwargs)
            return {"request_id": "req-dispatch", "status": "accepted", "agent_id": kwargs["agent_id"]}

    fake = FakeProviderApplicationService()
    service = FlowDecompositionService(provider_application_service=cast(Any, fake))
    sentinel_context = object()

    with pytest.MonkeyPatch.context() as monkeypatch:
        monkeypatch.setattr(
            service,
            "build_realtime_execution_context",
            lambda: (_ for _ in ()).throw(AssertionError("should not build default context")),
        )
        dispatch = service.dispatch_planner(
            requirement="使用注入实例上下文发送",
            board_id="default",
            planner_agent_id="planner-injected",
            planner_session_key="linpo:flow:default:planner:planner-injected:test",
            current_nodes=[],
            current_edges=[],
            execution_context=cast(Any, sentinel_context),
            provider_name="openclaw",
        )

    assert dispatch.planner_agent_id == "planner-injected"
    assert len(fake.send_calls) == 1
    assert fake.send_calls[0]["execution_context"] is sentinel_context


def test_snapshot_from_history_messages_returns_latest_valid_snapshot() -> None:
    service = FlowDecompositionService(provider_application_service=cast(Any, object()))

    snapshot = service.snapshot_from_history_messages(
        messages_raw=[
            {"role": "assistant", "text": "处理中，请稍后"},
            {
                "role": "assistant",
                "text": '{"nodes":[{"id":"n1","title":"步骤1","description":"说明","depends_on":[],"sensitive":false},{"id":"n2","title":"步骤2","description":"依赖步骤1","depends_on":["n1"],"sensitive":true}]}',
            },
        ],
        planner_session_key="linpo:flow:default:planner:planner-default:test",
    )

    assert snapshot is not None
    assert snapshot.planner_session_key == "linpo:flow:default:planner:planner-default:test"
    assert [node.id for node in snapshot.nodes] == ["n1", "n2"]
    assert snapshot.nodes[1].depends_on == ["n1"]


@pytest.mark.parametrize("missing_env", ["OPENCLAW_BASE_URL", "OPENCLAW_GATEWAY_TOKEN"])
def test_build_execution_context_fails_when_required_env_missing(
    monkeypatch: pytest.MonkeyPatch,
    missing_env: str,
) -> None:
    monkeypatch.delenv(missing_env, raising=False)
    service = FlowDecompositionService(provider_application_service=cast(Any, object()))

    with pytest.raises(HTTPException) as exc_info:
        service.build_realtime_execution_context()

    assert exc_info.value.status_code == 503
    assert missing_env in str(exc_info.value.detail)


def test_build_execution_context_succeeds_with_required_envs() -> None:
    service = FlowDecompositionService(provider_application_service=cast(Any, object()))

    context = service.build_realtime_execution_context()

    assert context.adapter is not None
    assert context.cache_key == (
        "flow-decomposer-openclaw",
        "ws://test-openclaw:38789",
        "http://test-openclaw:38789",
        "planner-default",
    )
