from __future__ import annotations

import json
import os
import re
import time
from dataclasses import dataclass
from typing import Any, cast
from uuid import uuid4

from fastapi import HTTPException

from app.adapters.provider_adapter import ProviderAdapter
from app.adapters.openclaw_adapter import OpenClawAdapter
from app.services.openclaw_client import OpenClawClient
from app.services.provider_application_service import (
    ProviderApplicationService,
    ProviderExecutionContext,
)


_DEFAULT_DECOMPOSITION_AGENT_ID = "claw3"
_DEFAULT_HISTORY_LIMIT = 60
_DEFAULT_MAX_NODES = 12
_DEFAULT_POLL_INTERVAL_SECONDS = 0.6
_DEFAULT_POLL_TIMEOUT_SECONDS = 60.0
_DEFAULT_JSON_REPAIR_ATTEMPTS = 2


@dataclass(frozen=True)
class FlowNodeDraft:
    id: str
    title: str
    depends_on: list[str]
    sensitive: bool
    description: str = ""


@dataclass(frozen=True)
class FlowDecompositionResult:
    nodes: list[FlowNodeDraft]
    planner_session_key: str


@dataclass(frozen=True)
class FlowPlannerDispatch:
    planner_agent_id: str
    planner_session_key: str


class FlowDecompositionService:
    def __init__(
        self,
        *,
        provider_application_service: ProviderApplicationService | None = None,
    ) -> None:
        self._provider_application_service = provider_application_service or ProviderApplicationService()

    def decompose(
        self,
        *,
        requirement: str,
        board_id: str,
        planner_agent_id: str | None = None,
        planner_session_key: str | None = None,
        flow_name: str | None = None,
        current_nodes: list[dict[str, Any]] | None = None,
        current_edges: list[dict[str, Any]] | None = None,
        prompt_history: list[dict[str, str]] | None = None,
        planner_api_base_url: str | None = None,
        planner_api_token: str | None = None,
    ) -> FlowDecompositionResult:
        normalized_requirement = requirement.strip()
        if normalized_requirement == "":
            raise HTTPException(status_code=400, detail="requirement is required")

        normalized_nodes = current_nodes or []
        dispatch = self.dispatch_planner(
            requirement=normalized_requirement,
            board_id=board_id,
            planner_agent_id=planner_agent_id,
            planner_session_key=planner_session_key,
            flow_name=flow_name,
            current_nodes=normalized_nodes,
            current_edges=current_edges or [],
            prompt_history=prompt_history,
            planner_api_base_url=planner_api_base_url,
            planner_api_token=planner_api_token,
        )
        assistant_message = self._wait_for_assistant_json(
            context=self._build_claw3_execution_context(),
            session_key=dispatch.planner_session_key,
            planner_agent_id=dispatch.planner_agent_id,
        )
        nodes = self._parse_nodes_from_message(assistant_message, current_nodes=normalized_nodes)
        return FlowDecompositionResult(
            nodes=nodes,
            planner_session_key=dispatch.planner_session_key,
        )

    def build_realtime_execution_context(self) -> ProviderExecutionContext:
        return self._build_claw3_execution_context()

    def dispatch_planner(
        self,
        *,
        requirement: str,
        board_id: str,
        planner_agent_id: str | None = None,
        planner_session_key: str | None = None,
        flow_name: str | None = None,
        current_nodes: list[dict[str, Any]] | None = None,
        current_edges: list[dict[str, Any]] | None = None,
        prompt_history: list[dict[str, str]] | None = None,
        planner_api_base_url: str | None = None,
        planner_api_token: str | None = None,
    ) -> FlowPlannerDispatch:
        normalized_requirement = requirement.strip()
        if normalized_requirement == "":
            raise HTTPException(status_code=400, detail="requirement is required")

        normalized_planner_agent_id = self._resolve_planner_agent_id(planner_agent_id)
        normalized_planner_session_key = self._normalize_planner_session_key(
            board_id=board_id,
            planner_session_key=planner_session_key,
        )
        prompt = self._build_decomposition_prompt(
            normalized_requirement,
            flow_name=flow_name,
            current_nodes=current_nodes or [],
            current_edges=current_edges or [],
            prompt_history=prompt_history or [],
            planner_api_base_url=planner_api_base_url,
            planner_api_token=planner_api_token,
            planner_session_key=normalized_planner_session_key,
            board_id=board_id,
        )

        try:
            self._provider_application_service.send_chat_message(
                data_source="openclaw",
                execution_context=self._build_claw3_execution_context(),
                agent_id=normalized_planner_agent_id,
                message=prompt,
                session_key=normalized_planner_session_key,
            )
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=503, detail=f"Flow decomposition dispatch failed: {exc}") from exc

        return FlowPlannerDispatch(
            planner_agent_id=normalized_planner_agent_id,
            planner_session_key=normalized_planner_session_key,
        )

    def read_latest_snapshot(
        self,
        *,
        planner_session_key: str,
        current_nodes: list[dict[str, Any]] | None = None,
        limit: int = _DEFAULT_HISTORY_LIMIT,
    ) -> FlowDecompositionResult | None:
        context = self._build_claw3_execution_context()
        try:
            history_payload = self._provider_application_service.chat_history(
                data_source="openclaw",
                execution_context=context,
                session_key=planner_session_key,
                limit=limit,
            )
        except HTTPException as exc:
            if self._is_retryable_history_error(exc):
                return None
            raise
        return self.snapshot_from_history_messages(
            messages_raw=history_payload.get("messages", []),
            planner_session_key=planner_session_key,
            current_nodes=current_nodes,
        )

    def snapshot_from_history_messages(
        self,
        *,
        messages_raw: object,
        planner_session_key: str,
        current_nodes: list[dict[str, Any]] | None = None,
    ) -> FlowDecompositionResult | None:
        if not isinstance(messages_raw, list):
            return None

        for item in reversed(messages_raw):
            if not isinstance(item, dict):
                continue
            role = item.get("role")
            if not isinstance(role, str) or role != "assistant":
                continue
            text = self._extract_history_item_text(item).strip()
            if text == "" or not self._extract_json_candidates(text):
                continue
            try:
                nodes = self._parse_nodes_from_message(text, current_nodes=current_nodes)
            except HTTPException:
                continue
            return FlowDecompositionResult(
                nodes=nodes,
                planner_session_key=planner_session_key,
            )
        return None

    def _build_claw3_execution_context(self) -> ProviderExecutionContext:
        base_url = self._decomposition_base_url()
        token = self._decomposition_gateway_token()
        origin = self._decomposition_origin()

        client = OpenClawClient(
            base_url=base_url,
            gateway_token=token,
            origin=origin,
        )
        adapter = OpenClawAdapter(
            client=client,
            instance_id="flow-decomposer-claw3",
            instance_name="claw3",
        )
        return ProviderExecutionContext(
            adapter=cast(ProviderAdapter, adapter),
            cache_key=("flow-decomposer-claw3", base_url, origin, self._decomposition_agent_id()),
        )

    def _wait_for_assistant_json(
        self,
        *,
        context: ProviderExecutionContext,
        session_key: str,
        planner_agent_id: str,
    ) -> str:
        repaired_signatures: set[str] = set()
        repair_attempts = 0
        deadline = time.monotonic() + max(_DEFAULT_POLL_TIMEOUT_SECONDS, 0.0)
        while True:
            try:
                payload = self._provider_application_service.chat_history(
                    data_source="openclaw",
                    execution_context=context,
                    session_key=session_key,
                    limit=_DEFAULT_HISTORY_LIMIT,
                )
            except HTTPException as exc:
                if self._is_retryable_history_error(exc):
                    time.sleep(_DEFAULT_POLL_INTERVAL_SECONDS)
                    continue
                raise
            messages = payload.get("messages", [])
            if isinstance(messages, list):
                for message in reversed(messages):
                    if not isinstance(message, dict):
                        continue
                    role = message.get("role")
                    if not isinstance(role, str) or role != "assistant":
                        continue
                    text = self._extract_history_item_text(message).strip()
                    if text == "":
                        continue
                    if self._extract_json_candidates(text):
                        return text
                    signature = self._assistant_message_signature(message, text=text)
                    if (
                        signature not in repaired_signatures
                        and repair_attempts < _DEFAULT_JSON_REPAIR_ATTEMPTS
                    ):
                        self._provider_application_service.send_chat_message(
                            data_source="openclaw",
                            execution_context=context,
                            agent_id=planner_agent_id,
                            message=self._build_json_repair_prompt(text),
                            session_key=session_key,
                        )
                        repaired_signatures.add(signature)
                        repair_attempts += 1
                        break
            if time.monotonic() >= deadline:
                break
            time.sleep(_DEFAULT_POLL_INTERVAL_SECONDS)

        raise HTTPException(
            status_code=503,
            detail="Flow decomposition failed: claw3 did not return structured JSON",
        )

    def _normalize_planner_session_key(
        self,
        *,
        board_id: str,
        planner_session_key: str | None,
    ) -> str:
        return (
            planner_session_key.strip()
            if isinstance(planner_session_key, str) and planner_session_key.strip()
            else f"linpo:flow:{board_id}:planner:claw3:{uuid4().hex[:8]}"
        )

    def _parse_nodes_from_message(
        self,
        assistant_message: str,
        *,
        current_nodes: list[dict[str, Any]] | None = None,
    ) -> list[FlowNodeDraft]:
        payload = self._parse_json_payload(assistant_message)
        nodes_payload = payload.get("nodes")
        if not isinstance(nodes_payload, list) or len(nodes_payload) == 0:
            raise HTTPException(status_code=503, detail="Flow decomposition failed: missing nodes")

        normalized_nodes: list[FlowNodeDraft] = []
        seen_ids: set[str] = set()
        for index, item in enumerate(nodes_payload[:_DEFAULT_MAX_NODES]):
            if not isinstance(item, dict):
                continue

            node_id_raw = item.get("id")
            title_raw = item.get("title")
            description_raw = item.get("description")
            depends_raw = item.get("depends_on", [])
            sensitive_raw = item.get("sensitive")

            title = str(title_raw).strip() if isinstance(title_raw, str) else ""
            if title == "":
                continue
            description = str(description_raw).strip() if isinstance(description_raw, str) else ""

            normalized_id = self._normalize_node_id(node_id_raw, fallback_index=index + 1, seen_ids=seen_ids)
            seen_ids.add(normalized_id)

            depends_on: list[str] = []
            if isinstance(depends_raw, list):
                for dep in depends_raw:
                    if isinstance(dep, str):
                        dep_id = dep.strip()
                        if dep_id:
                            depends_on.append(dep_id)

            normalized_nodes.append(
                FlowNodeDraft(
                    id=normalized_id,
                    title=title,
                    depends_on=depends_on,
                    sensitive=bool(sensitive_raw) if isinstance(sensitive_raw, bool) else False,
                    description=description,
                )
            )

        if len(normalized_nodes) == 0:
            raise HTTPException(status_code=503, detail="Flow decomposition failed: empty nodes")

        known_ids = {node.id for node in normalized_nodes}
        sanitized_nodes: list[FlowNodeDraft] = []
        description_by_node_id = self._build_existing_description_map(current_nodes)
        for node in normalized_nodes:
            depends_on = [dep for dep in node.depends_on if dep in known_ids and dep != node.id]
            description = node.description
            if description == "":
                description = description_by_node_id.get(node.id, "")
            sanitized_nodes.append(
                FlowNodeDraft(
                    id=node.id,
                    title=node.title,
                    depends_on=depends_on,
                    sensitive=node.sensitive,
                    description=description,
                )
            )

        if not any(node.sensitive for node in sanitized_nodes):
            last = sanitized_nodes[-1]
            sanitized_nodes[-1] = FlowNodeDraft(
                id=last.id,
                title=last.title,
                depends_on=last.depends_on,
                sensitive=True,
                description=last.description,
            )
        return sanitized_nodes

    def _parse_json_payload(self, content: str) -> dict[str, Any]:
        for candidate in self._extract_json_candidates(content):
            try:
                parsed = json.loads(candidate)
            except json.JSONDecodeError:
                continue
            if isinstance(parsed, dict):
                return parsed
        raise HTTPException(status_code=503, detail="Flow decomposition failed: invalid JSON payload")

    def _extract_json_candidates(self, content: str) -> list[str]:
        candidates: list[str] = []
        seen: set[str] = set()

        def add_candidate(value: str) -> None:
            normalized = value.strip()
            if normalized != "" and normalized not in seen:
                seen.add(normalized)
                candidates.append(normalized)

        for fenced in re.findall(r"```(?:json)?\s*(\{[\s\S]*?\})\s*```", content, flags=re.IGNORECASE):
            add_candidate(fenced)

        stripped = content.strip()
        if stripped.startswith("{") and stripped.endswith("}"):
            add_candidate(stripped)

        start = content.find("{")
        end = content.rfind("}")
        if start != -1 and end != -1 and end > start:
            add_candidate(content[start : end + 1])

        return candidates

    def _extract_history_item_text(self, item: dict[str, Any]) -> str:
        text = item.get("text")
        if isinstance(text, str):
            return text

        content = item.get("content")
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            text_parts: list[str] = []
            for block in content:
                if not isinstance(block, dict):
                    continue
                block_text = block.get("text")
                if isinstance(block_text, str):
                    text_parts.append(block_text)
            return "\n".join(text_parts)
        return ""

    def _assistant_message_signature(self, item: dict[str, Any], *, text: str) -> str:
        timestamp = item.get("timestamp")
        if isinstance(timestamp, (int, float)):
            return f"{timestamp}:{text}"
        return text

    def _build_json_repair_prompt(self, invalid_reply: str) -> str:
        preview = invalid_reply.strip()
        if len(preview) > 400:
            preview = f"{preview[:400]}..."
        return (
            "你上一条回复不符合流程拆解协议。"
            "不要解释，不要提问，不要 markdown，不要代码块。"
            '现在仅输出一个合法 JSON 对象，顶层必须是 {"nodes":[...]}。'
            "每个节点必须包含 id/title/description/depends_on/sensitive。"
            "若上一条回复内容与需求冲突，以当前会话中的用户需求为准，直接给出完整 nodes。"
            f"上一条无效回复参考：{preview}"
        )

    def _is_retryable_history_error(self, exc: HTTPException) -> bool:
        if exc.status_code != 503:
            return False
        detail = str(exc.detail).lower()
        return (
            "too many non-target control messages" in detail
            or "control response timed out" in detail
        )

    def _normalize_node_id(self, raw: Any, *, fallback_index: int, seen_ids: set[str]) -> str:
        value = str(raw).strip() if isinstance(raw, str) else ""
        if value == "":
            value = f"node_{fallback_index}"
        value = re.sub(r"[^a-zA-Z0-9_-]+", "_", value).strip("_")
        if value == "":
            value = f"node_{fallback_index}"
        if value in seen_ids:
            suffix = 2
            while f"{value}_{suffix}" in seen_ids:
                suffix += 1
            value = f"{value}_{suffix}"
        return value

    def _build_decomposition_prompt(
        self,
        requirement: str,
        *,
        flow_name: str | None,
        current_nodes: list[dict[str, Any]],
        current_edges: list[dict[str, Any]],
        prompt_history: list[dict[str, str]],
        planner_api_base_url: str | None,
        planner_api_token: str | None,
        planner_session_key: str,
        board_id: str,
    ) -> str:
        base_prompt = (
            "你是 Linpo 的流程拆解服务。"
            "请把用户需求拆解为可执行流程图节点。"
            "约束："
            "1) id 全局唯一；"
            "2) depends_on 只能引用已存在节点 id；"
            "3) 节点数 2-12；"
            "4) 优先识别可独立子任务，拆成可并行分支，不要线性化所有步骤；"
            "5) 每个节点 description 要写清执行要点；若节点可再拆分，请明确写出“可委派 subagent 并行执行”的建议；"
            "6) 最终至少一个敏感节点 sensitive=true 用于审批；"
            "7) 每个节点 description 需包含文件交接要求：明确输入/输出文件语义，并提醒执行阶段“若运行环境无法直接访问默认路径，可先在可访问工作目录处理中间文件，但 completed 前必须回写到指定输出路径；否则应 failed 并说明原因”。"
            "8) 不要等待全量思考完再一次性输出；需要边规划边实时改图。"
        )
        if not current_nodes and not current_edges:
            history_prompt = self._render_prompt_history(prompt_history)
            return f"{base_prompt}{history_prompt}用户需求：{requirement}"

        compact_nodes: list[dict[str, Any]] = []
        for node in current_nodes[:24]:
            if not isinstance(node, dict):
                continue
            compact_nodes.append(
                {
                    "id": str(node.get("id", "")).strip(),
                    "title": str(node.get("title", "")).strip(),
                    "description": str(node.get("description", "")).strip(),
                    "sensitive": bool(node.get("sensitive", False)),
                }
            )
        compact_edges: list[dict[str, Any]] = []
        for edge in current_edges[:48]:
            if not isinstance(edge, dict):
                continue
            compact_edges.append(
                {
                    "source": str(edge.get("source", "")).strip(),
                    "target": str(edge.get("target", "")).strip(),
                }
            )

        context_payload = {
            "flow_name": (flow_name or "").strip() or "未命名流程",
            "nodes": compact_nodes,
            "edges": compact_edges,
        }
        context_json = json.dumps(context_payload, ensure_ascii=False)
        return (
            f"{base_prompt}"
            f"{self._render_prompt_history(prompt_history)}"
            "你会收到“当前流程上下文”和“新增指令”，请基于当前流程做增量修改并输出完整最新 nodes。"
            "若指令仅修改局部，未提及的有效节点可保留。"
            f"当前流程上下文：{context_json}"
            f"新增指令：{requirement}"
        )

    def _render_prompt_history(self, prompt_history: list[dict[str, str]]) -> str:
        if not prompt_history:
            return ""
        compact_history: list[dict[str, str]] = []
        for item in prompt_history[-20:]:
            role = str(item.get("role", "")).strip() if isinstance(item, dict) else ""
            content = str(item.get("content", "")).strip() if isinstance(item, dict) else ""
            if role == "" or content == "":
                continue
            compact_history.append(
                {
                    "role": role,
                    "content": content[:1200],
                }
            )
        if not compact_history:
            return ""
        return f"历史会话摘要：{json.dumps(compact_history, ensure_ascii=False)}"

    def _build_existing_description_map(
        self,
        current_nodes: list[dict[str, Any]] | None,
    ) -> dict[str, str]:
        if not current_nodes:
            return {}
        result: dict[str, str] = {}
        for node in current_nodes:
            if not isinstance(node, dict):
                continue
            node_id = str(node.get("id", "")).strip()
            if node_id == "":
                continue
            description = str(node.get("description", "")).strip()
            if description != "":
                result[node_id] = description
        return result

    def _required_flow_decomposition_env(self, env_name: str) -> str:
        value = os.getenv(env_name, "").strip()
        if value == "":
            raise HTTPException(
                status_code=503,
                detail=f"Flow decomposition service is not configured: missing {env_name}",
            )
        return value

    def _decomposition_base_url(self) -> str:
        return self._required_flow_decomposition_env("FLOW_DECOMPOSITION_OPENCLAW_BASE_URL")

    def _decomposition_origin(self) -> str:
        return self._required_flow_decomposition_env("FLOW_DECOMPOSITION_OPENCLAW_ORIGIN")

    def _decomposition_gateway_token(self) -> str:
        return self._required_flow_decomposition_env("FLOW_DECOMPOSITION_OPENCLAW_GATEWAY_TOKEN")

    def _decomposition_agent_id(self) -> str:
        return _DEFAULT_DECOMPOSITION_AGENT_ID

    def _resolve_planner_agent_id(self, planner_agent_id: str | None) -> str:
        expected = self._decomposition_agent_id()
        candidate = (planner_agent_id or "").strip()
        if candidate == "":
            return expected
        if candidate != expected:
            raise HTTPException(status_code=400, detail=f"planner_agent_id must be {expected}")
        return expected
