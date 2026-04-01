from __future__ import annotations

import json
import os
import re
import time
from dataclasses import dataclass
from typing import Any
from uuid import uuid4

from fastapi import HTTPException

from app.adapters.openclaw_adapter import OpenClawAdapter
from app.services.openclaw_client import OpenClawClient
from app.services.provider_application_service import (
    ProviderApplicationService,
    ProviderExecutionContext,
)


_DEFAULT_DECOMPOSITION_BASE_URL = "ws://175.178.213.10:38789"
_DEFAULT_DECOMPOSITION_ORIGIN = "http://127.0.0.1:38789"
_DEFAULT_DECOMPOSITION_GATEWAY_TOKEN = "OuWJnOh9wo_8wLkIQv262NPc0tgnjo1G4yCMh9v-RAg"
_DEFAULT_DECOMPOSITION_AGENT_ID = "main"
_DEFAULT_HISTORY_LIMIT = 60
_DEFAULT_MAX_NODES = 12
_DEFAULT_POLL_TIMES = 40
_DEFAULT_POLL_INTERVAL_SECONDS = 0.6


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
        planner_session_key: str | None = None,
        flow_name: str | None = None,
        current_nodes: list[dict[str, Any]] | None = None,
        current_edges: list[dict[str, Any]] | None = None,
    ) -> FlowDecompositionResult:
        normalized_requirement = requirement.strip()
        if normalized_requirement == "":
            raise HTTPException(status_code=400, detail="requirement is required")

        context = self._build_claw3_execution_context()
        normalized_planner_session_key = (
            planner_session_key.strip()
            if isinstance(planner_session_key, str) and planner_session_key.strip()
            else f"linpo:flow:{board_id}:planner:claw3:{uuid4().hex[:8]}"
        )
        normalized_nodes = current_nodes or []
        normalized_edges = current_edges or []
        prompt = self._build_decomposition_prompt(
            normalized_requirement,
            flow_name=flow_name,
            current_nodes=normalized_nodes,
            current_edges=normalized_edges,
        )

        try:
            self._provider_application_service.send_chat_message(
                data_source="openclaw",
                execution_context=context,
                agent_id=self._decomposition_agent_id(),
                message=prompt,
                session_key=normalized_planner_session_key,
            )
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=503, detail=f"Flow decomposition dispatch failed: {exc}") from exc

        assistant_message = self._wait_for_assistant_json(
            context=context,
            session_key=normalized_planner_session_key,
        )
        nodes = self._parse_nodes_from_message(assistant_message, current_nodes=normalized_nodes)
        return FlowDecompositionResult(
            nodes=nodes,
            planner_session_key=normalized_planner_session_key,
        )

    def _build_claw3_execution_context(self) -> ProviderExecutionContext:
        base_url = self._decomposition_base_url()
        token = self._decomposition_gateway_token()
        origin = self._decomposition_origin()
        if token == "":
            raise HTTPException(
                status_code=503,
                detail="Flow decomposition service is not configured: missing claw3 token",
            )

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
            adapter=adapter,
            cache_key=("flow-decomposer-claw3", base_url, origin, self._decomposition_agent_id()),
        )

    def _wait_for_assistant_json(
        self,
        *,
        context: ProviderExecutionContext,
        session_key: str,
    ) -> str:
        for _ in range(_DEFAULT_POLL_TIMES):
            payload = self._provider_application_service.chat_history(
                data_source="openclaw",
                execution_context=context,
                session_key=session_key,
                limit=_DEFAULT_HISTORY_LIMIT,
            )
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
            time.sleep(_DEFAULT_POLL_INTERVAL_SECONDS)

        raise HTTPException(
            status_code=503,
            detail="Flow decomposition failed: claw3 did not return structured JSON",
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
            depends_raw = item.get("depends_on", item.get("dependencies", []))
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
    ) -> str:
        base_prompt = (
            "你是 Linpo 的流程拆解服务。"
            "请把用户需求拆解为可执行流程图节点，并仅输出 JSON。"
            "输出格式必须严格为："
            '{"nodes":[{"id":"node_1","title":"任务标题","description":"任务详细描述","depends_on":[],"sensitive":false}]}'
            "约束："
            "1) id 全局唯一；"
            "2) depends_on 只能引用已存在节点 id；"
            "3) 节点数 2-12；"
            "4) 优先识别可独立子任务，拆成可并行分支，不要线性化所有步骤；"
            "5) 每个节点 description 要写清执行要点；若节点可再拆分，请明确写出“可委派 subagent 并行执行”的建议；"
            "6) 最终至少一个敏感节点 sensitive=true 用于审批；"
            "7) 每个节点 description 需包含文件交接要求：明确输入/输出文件语义，并提醒执行阶段“若运行环境无法直接访问默认路径，可先在可访问工作目录处理中间文件，但 completed 前必须回写到指定输出路径；否则应 failed 并说明原因”。"
        )
        if not current_nodes and not current_edges:
            return f"{base_prompt}用户需求：{requirement}"

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
            "你会收到“当前流程上下文”和“新增指令”，请基于当前流程做增量修改并输出完整最新 nodes。"
            "若指令仅修改局部，未提及的有效节点可保留。"
            f"当前流程上下文：{context_json}"
            f"新增指令：{requirement}"
        )

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

    def _decomposition_base_url(self) -> str:
        return (
            os.getenv("FLOW_DECOMPOSITION_OPENCLAW_BASE_URL", "").strip()
            or _DEFAULT_DECOMPOSITION_BASE_URL
        )

    def _decomposition_origin(self) -> str:
        return (
            os.getenv("FLOW_DECOMPOSITION_OPENCLAW_ORIGIN", "").strip()
            or _DEFAULT_DECOMPOSITION_ORIGIN
        )

    def _decomposition_gateway_token(self) -> str:
        return (
            os.getenv("FLOW_DECOMPOSITION_OPENCLAW_GATEWAY_TOKEN", "").strip()
            or _DEFAULT_DECOMPOSITION_GATEWAY_TOKEN
        )

    def _decomposition_agent_id(self) -> str:
        return (
            os.getenv("FLOW_DECOMPOSITION_AGENT_ID", "").strip()
            or _DEFAULT_DECOMPOSITION_AGENT_ID
        )
