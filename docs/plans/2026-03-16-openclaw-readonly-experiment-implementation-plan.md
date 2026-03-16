# OpenClaw Read-Only Experiment Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在不突破 observer-only 边界的前提下，把 Linpo 接到本机 Docker 中的 OpenClaw 单实例，完成一次真实只读接入实验，并对任何握手/鉴权/读取失败做显式报错。

**Architecture:** Linpo 后端继续保留现有 3 个 observer 只读接口，不扩张 API 面。`OpenClawObserverDataSource` 改为通过 WebSocket 网关连接本机 `ws://127.0.0.1:28789`，完成最小只读握手，读取 hello/snapshot 与 health 信息，再映射到现有 `Agent` / `TopologyNode` / `EventRecord` read model。若握手、鉴权、协议版本或读取失败，直接返回明确错误，不静默回退到 stub。

**Tech Stack:** FastAPI, Python 3.12, websockets, pytest

---

### Task 1: 冻结实验边界到文档

**Files:**
- Modify: `docs/plans/2026-03-16-public-access-and-openclaw-readonly-plan.md`
- Modify: `docs/plans/2026-03-16-observer-demo-runbook.md`

**Step 1: 写入文档变更**
- 在接入计划中补充本轮已确认事实：
  - 单实例实验目标使用 `claw2-openclaw-gateway-1`
  - 网关地址 `ws://127.0.0.1:28789`
  - 鉴权模式 `token`
  - 协议版本 `3`
  - 只允许 observer-only 读取，不发送写操作
- 在 runbook 中补充本地实验环境变量示例。

**Step 2: 校验文档一致性**
- 确认文档没有引入控制面措辞。

### Task 2: 先写 OpenClaw 失败测试

**Files:**
- Modify: `tests/integration/test_agents_api.py`

**Step 1: 写 failing tests**
添加最小测试覆盖：
- 选择 `data_source=openclaw` 且缺少配置时返回 `503`
- 选择 `data_source=openclaw` 且握手失败时返回 `503`，错误信息显式透出 OpenClaw 失败原因
- 使用 mock / patch 接缝隔离真实 WebSocket 握手，确保测试可重复且不依赖真实网关
- 覆盖 3 个现有只读接口的 OpenClaw 路径：
  - `GET /agents?data_source=openclaw`
  - `GET /agents/{agent_id}?data_source=openclaw`
  - `GET /agents/{agent_id}/nodes/{node_id}?data_source=openclaw`
- 在最小成功读取场景下，以上 3 个接口都能返回从 OpenClaw 映射出的真实 read model

**Step 2: 先运行单测确认失败**
Run: `./.venv/bin/python -m pytest -q tests/integration/test_agents_api.py`
Expected: 新增 openclaw 成功场景失败

### Task 3: 实现最小 OpenClaw 客户端与映射

**Files:**
- Modify: `pyproject.toml`
- Modify: `app/services/observer_data.py`
- Optionally create: `app/services/openclaw_client.py`

**Step 1: 添加最小依赖**
- 增加 `websockets` 依赖，避免手写 WS 协议。

**Step 2: 实现最小握手客户端**
- 读取环境变量：
  - `OPENCLAW_BASE_URL`（例如 `ws://127.0.0.1:28789`）
  - `OPENCLAW_GATEWAY_TOKEN`
  - `OPENCLAW_ORIGIN`（默认 `http://127.0.0.1:28789`）
- 先接收服务端发来的 `connect.challenge`
- 再发送 `connect`：
```json
{
  "type": "req",
  "id": "connect-1",
  "method": "connect",
  "params": {
    "minProtocol": 3,
    "maxProtocol": 3,
    "client": {
      "id": "webchat-ui",
      "displayName": "linpo-observer",
      "version": "0.1.0",
      "mode": "webchat",
      "platform": "linux"
    },
    "auth": {"token": "..."}
  }
}
```
- 读取 `hello-ok` 与 `snapshot`
- 若 challenge 缺失、类型错误、响应不是 `hello-ok`，直接按 OpenClaw 握手失败处理
。

**Step 3: 做最小 read-model 映射**
- 先只映射 hello/snapshot 里稳定可得的信息：
  - `snapshot.health.agents`
  - `snapshot.presence`
  - `snapshot.health.defaultAgentId`
- 先把每个 OpenClaw agent 映射成一个 root node agent；若暂无 subagent 树，则 `child_count=0`。
- 事件列表先使用 health / presence 生成最小事件历史；不够时返回空列表而不是伪造复杂事件。

**Step 4: 错误显式化**
- 缺 token / base URL / 握手失败 / 非 hello-ok / 映射失败，都返回 `503`，并带上明确 detail。
- 不允许回退到 stub。

### Task 4: 跑测试并验证真实接入实验

**Files:**
- Modify: `tests/integration/test_health.py`（如需）
- Modify: `tests/integration/test_agents_api.py`

**Step 1: 跑后端测试**
Run: `./.venv/bin/python -m pytest -q`
Expected: 全绿，或只出现与你改动无关的既有失败。

**Step 2: 跑类型检查**
Run: `./.venv/bin/python -m basedpyright`
Expected: 0 errors

**Step 3: 做真实实验**
用环境变量启动后端：
```bash
OPENCLAW_BASE_URL=ws://127.0.0.1:28789 \
OPENCLAW_GATEWAY_TOKEN=<token> \
LINPO_OBSERVER_DATA_SOURCE=openclaw \
./.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```
然后验证：
- `curl http://127.0.0.1:8000/agents?data_source=openclaw`
- `curl http://127.0.0.1:8000/agents/<id>?data_source=openclaw`
- `curl http://127.0.0.1:8000/agents/<id>/nodes/<node>?data_source=openclaw`

**Step 4: 显式记录失败**
- 若 OpenClaw 返回鉴权/握手/读取错误，直接原样记录到最终汇报，不做兜底美化。
