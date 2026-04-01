from __future__ import annotations

from typing import Any, cast

from fastapi import HTTPException
import pytest

import app.services.flow_decomposition_service as flow_decomposition_service
from app.services.flow_decomposition_service import FlowDecompositionService


def test_decompose_returns_nodes_from_claw3_history_payload() -> None:
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

    assert result.planner_session_key.startswith("linpo:flow:default:planner:claw3:")
    assert len(result.nodes) == 2
    assert result.nodes[0].id == "a"
    assert result.nodes[1].depends_on == ["a"]
    assert result.nodes[1].sensitive is True
    assert len(fake.send_calls) == 1
    assert fake.send_calls[0]["agent_id"] == "claw3"
    assert "可委派 subagent 并行执行" in cast(str, fake.send_calls[0]["message"])
    assert "必须回写到指定输出路径" in cast(str, fake.send_calls[0]["message"])


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


def test_decompose_raises_when_claw3_never_returns_json(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(flow_decomposition_service, "_DEFAULT_POLL_TIMES", 2)
    monkeypatch.setattr(flow_decomposition_service, "_DEFAULT_POLL_INTERVAL_SECONDS", 0.0)

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
    monkeypatch.setattr(flow_decomposition_service, "_DEFAULT_POLL_TIMES", 3)
    monkeypatch.setattr(flow_decomposition_service, "_DEFAULT_POLL_INTERVAL_SECONDS", 0.0)

    class FakeProviderApplicationService:
        def __init__(self) -> None:
            self.send_calls: list[dict[str, Any]] = []
            self.history_calls = 0

        def send_chat_message(self, **kwargs: Any) -> dict[str, Any]:
            self.send_calls.append(kwargs)
            return {"request_id": f"req-{len(self.send_calls)}", "status": "accepted", "agent_id": "claw3"}

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
    assert "仅输出一个合法 JSON 对象" in cast(str, fake.send_calls[1]["message"])


def test_decompose_retries_retryable_history_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(flow_decomposition_service, "_DEFAULT_POLL_TIMES", 3)
    monkeypatch.setattr(flow_decomposition_service, "_DEFAULT_POLL_INTERVAL_SECONDS", 0.0)

    class FakeProviderApplicationService:
        def __init__(self) -> None:
            self.history_calls = 0

        def send_chat_message(self, **kwargs: Any) -> dict[str, Any]:
            del kwargs
            return {"request_id": "req-1", "status": "accepted", "agent_id": "claw3"}

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
    session_key = "linpo:flow:default:planner:claw3:reuse"

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
    assert "当前流程上下文" in cast(str, fake.send_calls[0]["message"])
    assert result.nodes[0].description == "旧描述应保留"


def test_decompose_rejects_non_claw3_planner_agent_id() -> None:
    class FakeProviderApplicationService:
        def send_chat_message(self, **kwargs: Any) -> dict[str, Any]:
            del kwargs
            return {"request_id": "req-1", "status": "accepted", "agent_id": "claw3"}

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

    with pytest.raises(HTTPException, match="planner_agent_id must be claw3"):
        service.decompose(
            requirement="拆解任务",
            board_id="default",
            planner_agent_id="main",
        )
