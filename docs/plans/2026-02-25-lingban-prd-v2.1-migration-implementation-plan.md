# Lingban PRD v2.1 Migration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将系统从 DB 中心迁移为 FS 可信源，完成 PRD v2.1 的 Agent 树和看板需求，并明确所有破坏性变更。

**Architecture:** 以文件系统为唯一权威，DB 仅作为可选缓存或历史记录。每个 run 会映射到 project_id，并在 `data/projects/` 下生成标准 Agent 目录结构，API 与前端仅读取 FS 状态构建 Agent 树与看板。

**Tech Stack:** FastAPI, SQLAlchemy (legacy), Redis, Python 3.12, vanilla JS, WebSocket.

---

## 前置约束和定义

- 执行时使用专用 worktree，并通过 @superpowers/executing-plans 按任务逐步推进
- 不新增依赖
- 不做 repo 结构重组，所有修改基于现有路径
- FS 是唯一可信来源，Agents 不依赖 DB
- project_id 映射: `project_id := "t{tenant_id}-r{run_id}"`

### FS 目录规范

```
data/projects/{project_id}/
  agents/{agent_id}/
    identity.json
    mission.md
    plan.md
    context/
      sources/
      workspace/
    children/
    memory/
      preferences.md
    logs/
```

### DeepSeek 4 Workstreams 对齐到现有 repo

1) Workstream A: FS 数据模型和存储工具
- 主要落地到 `api-backend/app/` 和 `agent-manager/app/`
2) Workstream B: API 行为与 WebSocket 事件
- 主要落地到 `api-backend/app/main.py`, `api-backend/app/tree_api.py`
3) Workstream C: 编排与运行时 Agent 管理
- 主要落地到 `agent-manager/app/main.py`
4) Workstream D: 前端 Agent 树与看板
- 主要落地到 `web-frontend/app.js`

---

### Task 1: FS 路径与 project_id 工具

**Files:**
- Create: `api-backend/app/project_fs.py`
- Test: `api-backend/tests/test_project_fs.py`

**Step 1: Write the failing test**

```python
def test_project_id_and_paths(tmp_path):
    from app.project_fs import project_id_for, project_root_for, agent_root_for

    pid = project_id_for(tenant_id=12, run_id=34)
    assert pid == "t12-r34"

    root = project_root_for(tmp_path, tenant_id=12, run_id=34)
    assert root.as_posix().endswith("data/projects/t12-r34")

    agent = agent_root_for(tmp_path, tenant_id=12, run_id=34, agent_id="ceo")
    assert agent.as_posix().endswith("data/projects/t12-r34/agents/ceo")
```

**Step 2: Run test to verify it fails**

Run: `pytest api-backend/tests/test_project_fs.py::test_project_id_and_paths -v`
Expected: FAIL with "No module named 'app.project_fs'"

**Step 3: Write minimal implementation**

```python
from pathlib import Path

def project_id_for(tenant_id: int | str, run_id: int | str) -> str:
    return f"t{tenant_id}-r{run_id}"

def project_root_for(base: Path, tenant_id: int | str, run_id: int | str) -> Path:
    return base / "data" / "projects" / project_id_for(tenant_id, run_id)

def agent_root_for(base: Path, tenant_id: int | str, run_id: int | str, agent_id: str) -> Path:
    return project_root_for(base, tenant_id, run_id) / "agents" / agent_id
```

**Step 4: Run test to verify it passes**

Run: `pytest api-backend/tests/test_project_fs.py::test_project_id_and_paths -v`
Expected: PASS

**Step 5: Commit**

```bash
git add api-backend/app/project_fs.py api-backend/tests/test_project_fs.py
git commit -m "test: add project fs helpers"
```

---

### Task 2: Agent FS 读写模型

**Files:**
- Create: `api-backend/app/agent_fs.py`
- Test: `api-backend/tests/test_agent_fs.py`

**Step 1: Write the failing test**

```python
def test_agent_fs_roundtrip(tmp_path):
    from app.agent_fs import write_agent_identity, read_agent_identity, ensure_agent_layout

    root = tmp_path / "data" / "projects" / "t1-r2" / "agents" / "ceo"
    ensure_agent_layout(root)
    write_agent_identity(root, {"name": "CEO", "status": "running", "current_step": "plan"})
    data = read_agent_identity(root)
    assert data["name"] == "CEO"
    assert data["status"] == "running"
    assert data["current_step"] == "plan"
```

**Step 2: Run test to verify it fails**

Run: `pytest api-backend/tests/test_agent_fs.py::test_agent_fs_roundtrip -v`
Expected: FAIL with "No module named 'app.agent_fs'"

**Step 3: Write minimal implementation**

```python
import json
from pathlib import Path

def ensure_agent_layout(agent_root: Path) -> None:
    (agent_root / "context" / "sources").mkdir(parents=True, exist_ok=True)
    (agent_root / "context" / "workspace").mkdir(parents=True, exist_ok=True)
    (agent_root / "children").mkdir(parents=True, exist_ok=True)
    (agent_root / "memory").mkdir(parents=True, exist_ok=True)
    (agent_root / "logs").mkdir(parents=True, exist_ok=True)

def identity_path(agent_root: Path) -> Path:
    return agent_root / "identity.json"

def write_agent_identity(agent_root: Path, payload: dict[str, object]) -> None:
    ensure_agent_layout(agent_root)
    identity_path(agent_root).write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

def read_agent_identity(agent_root: Path) -> dict[str, object]:
    raw = identity_path(agent_root).read_text(encoding="utf-8")
    data = json.loads(raw) if raw.strip() else {}
    return data if isinstance(data, dict) else {}
```

**Step 4: Run test to verify it passes**

Run: `pytest api-backend/tests/test_agent_fs.py::test_agent_fs_roundtrip -v`
Expected: PASS

**Step 5: Commit**

```bash
git add api-backend/app/agent_fs.py api-backend/tests/test_agent_fs.py
git commit -m "test: add agent fs helpers"
```

---

### Task 3: Run 创建时生成 FS Agent 结构

**Files:**
- Modify: `api-backend/app/main.py`
- Test: `api-backend/tests/test_runs_api_smoke.py`

**Step 1: Write the failing test**

```python
def test_run_create_writes_fs(tmp_path, monkeypatch):
    monkeypatch.setenv("ROBOARD_ROOT", str(tmp_path))
    # 调用 /api/runs 后断言 FS 已创建 identity.json, mission.md, plan.md
```

**Step 2: Run test to verify it fails**

Run: `pytest api-backend/tests/test_runs_api_smoke.py::test_run_create_writes_fs -v`
Expected: FAIL with "missing identity.json" or assertion error

**Step 3: Write minimal implementation**

```python
from app.project_fs import agent_root_for
from app.agent_fs import ensure_agent_layout, write_agent_identity

# 在创建 run 后
agent_root = agent_root_for(Path(os.getenv("ROBOARD_ROOT", ".")), tenant_id, run_id, root_agent_id)
ensure_agent_layout(agent_root)
write_agent_identity(agent_root, {
    "id": str(root_agent_id),
    "name": "CEO",
    "status": "queued",
    "current_step": "init"
})
```

**Step 4: Run test to verify it passes**

Run: `pytest api-backend/tests/test_runs_api_smoke.py::test_run_create_writes_fs -v`
Expected: PASS

**Step 5: Commit**

```bash
git add api-backend/app/main.py api-backend/tests/test_runs_api_smoke.py
git commit -m "feat: create fs agent layout on run create"
```

---

### Task 4: Tree API 读取 FS Agent 树

**Files:**
- Modify: `api-backend/app/tree_api.py`
- Test: `api-backend/tests/test_tree_api.py`

**Step 1: Write the failing test**

```python
def test_run_tree_reads_fs_agent_data(tmp_path, monkeypatch):
    # 创建 FS 目录与 identity.json, plan.md
    # /api/runs/{run_id}/tree 应返回 name, status, current_step, plan_subtasks
```

**Step 2: Run test to verify it fails**

Run: `pytest api-backend/tests/test_tree_api.py::test_run_tree_reads_fs_agent_data -v`
Expected: FAIL with missing keys

**Step 3: Write minimal implementation**

```python
class AgentInstanceOut(BaseModel):
    id: str
    parent_agent_id: str | None = None
    role_label: str | None = None
    state: str
    name: str | None = None
    current_step: str | None = None
    plan_subtasks: list[dict[str, object]] = Field(default_factory=list)
```

**Step 4: Run test to verify it passes**

Run: `pytest api-backend/tests/test_tree_api.py::test_run_tree_reads_fs_agent_data -v`
Expected: PASS

**Step 5: Commit**

```bash
git add api-backend/app/tree_api.py api-backend/tests/test_tree_api.py
git commit -m "feat: read agent tree from fs"
```

---

### Task 5: SOP 读取与干预映射到 mission.md

**Files:**
- Modify: `api-backend/app/tree_api.py`
- Modify: `api-backend/app/sop_store.py`
- Test: `api-backend/tests/test_actions_sop_replace.py`

**Step 1: Write the failing test**

```python
def test_sop_reads_mission_md(tmp_path, monkeypatch):
    # 创建 mission.md 后调用 /api/agents/{agent_id}/sop
    # 断言返回 md_text 等于 mission.md 内容
```

**Step 2: Run test to verify it fails**

Run: `pytest api-backend/tests/test_actions_sop_replace.py::test_sop_reads_mission_md -v`
Expected: FAIL with "SOP not found"

**Step 3: Write minimal implementation**

```python
# /api/agents/{agent_id}/sop 读取 mission.md
# sop.replace 写回 mission.md 并更新 identity.json 的 current_step
```

**Step 4: Run test to verify it passes**

Run: `pytest api-backend/tests/test_actions_sop_replace.py::test_sop_reads_mission_md -v`
Expected: PASS

**Step 5: Commit**

```bash
git add api-backend/app/tree_api.py api-backend/app/sop_store.py api-backend/tests/test_actions_sop_replace.py
git commit -m "feat: map sop to mission.md in fs"
```

---

### Task 6: WebSocket 快照与 delta 使用 FS

**Files:**
- Modify: `api-backend/app/main.py`
- Test: `api-backend/tests/test_ws_runs_snapshot.py`

**Step 1: Write the failing test**

```python
def test_ws_snapshot_includes_fs_agents(tmp_path, monkeypatch):
    # 连接 ws 后 snapshot.data.agents 来自 FS
```

**Step 2: Run test to verify it fails**

Run: `pytest api-backend/tests/test_ws_runs_snapshot.py::test_ws_snapshot_includes_fs_agents -v`
Expected: FAIL with agent list empty

**Step 3: Write minimal implementation**

```python
# snapshot builder 调用新的 fs 读取函数
# delta 中 recent_events 仍保留，但 agent 状态以 FS 为准
```

**Step 4: Run test to verify it passes**

Run: `pytest api-backend/tests/test_ws_runs_snapshot.py::test_ws_snapshot_includes_fs_agents -v`
Expected: PASS

**Step 5: Commit**

```bash
git add api-backend/app/main.py api-backend/tests/test_ws_runs_snapshot.py
git commit -m "feat: fs-backed websocket snapshot"
```

---

### Task 7: Agent Manager 使用 FS 作为运行状态

**Files:**
- Modify: `agent-manager/app/main.py`
- Create: `agent-manager/app/agent_fs.py`
- Test: `agent-manager/tests/test_dispatch_input_mapping.py`

**Step 1: Write the failing test**

```python
def test_dispatch_updates_fs_status(tmp_path, monkeypatch):
    # 触发 dispatch 后 identity.json status 从 queued 变为 running 或 completed
```

**Step 2: Run test to verify it fails**

Run: `pytest agent-manager/tests/test_dispatch_input_mapping.py::test_dispatch_updates_fs_status -v`
Expected: FAIL with status unchanged

**Step 3: Write minimal implementation**

```python
# dispatch 开始时写 status=running
# 完成后写 status=completed, current_step 更新
```

**Step 4: Run test to verify it passes**

Run: `pytest agent-manager/tests/test_dispatch_input_mapping.py::test_dispatch_updates_fs_status -v`
Expected: PASS

**Step 5: Commit**

```bash
git add agent-manager/app/main.py agent-manager/app/agent_fs.py agent-manager/tests/test_dispatch_input_mapping.py
git commit -m "feat: agent-manager writes fs status"
```

---

### Task 8: 前端 Agent 树和看板 UI

**Files:**
- Modify: `web-frontend/app.js`
- Modify: `web-frontend/index.html`
- Modify: `web-frontend/style.css`

**Step 1: Write the failing test**

```js
// 前端没有现成测试框架，增加最小手动验证清单
```

**Step 2: Run test to verify it fails**

Run: `manual`
Expected: Agent 节点不显示状态颜色和 current_step

**Step 3: Write minimal implementation**

```js
// renderTree 使用 agent.name, agent.status, agent.current_step
// 右侧面板显示 plan.md 子任务和状态
// kanban 列显示 task assignment 和进度
```

**Step 4: Run test to verify it passes**

Run: `manual`
Expected: 节点显示 name + status color + current_step, 详情显示 plan 任务

**Step 5: Commit**

```bash
git add web-frontend/app.js web-frontend/index.html web-frontend/style.css
git commit -m "feat: agent tree and kanban for fs agents"
```

---

### Task 9: 可选的默认模型修复

**Files:**
- Modify: `api-backend/app/main.py`
- Modify: `agent-manager/app/main.py`

**Step 1: Write the failing test**

```python
def test_default_llm_model_is_gpt(monkeypatch):
    monkeypatch.delenv("LLM_DEFAULT_MODEL", raising=False)
    from app.main import _resolve_default_llm_model
    assert _resolve_default_llm_model() == "gpt-4o-mini"
```

**Step 2: Run test to verify it fails**

Run: `pytest api-backend/tests/test_config_loader.py::test_default_llm_model_is_gpt -v`
Expected: FAIL with "ark-code-latest"

**Step 3: Write minimal implementation**

```python
# 将 default model 调整为 gpt-4o-mini
```

**Step 4: Run test to verify it passes**

Run: `pytest api-backend/tests/test_config_loader.py::test_default_llm_model_is_gpt -v`
Expected: PASS

**Step 5: Commit**

```bash
git add api-backend/app/main.py agent-manager/app/main.py api-backend/tests/test_config_loader.py
git commit -m "fix: default llm model for expired ark"
```

---

## 破坏性变更清单

- `/api/runs/{run_id}/tree` 由 DB 查询改为 FS 读取，返回字段新增 `name`, `current_step`, `plan_subtasks`
- `/api/agents/{agent_id}/sop` 由 SOP 版本改为读取 `mission.md`
- Agent 状态以 FS `identity.json` 为准，DB 中 `agent_instances` 不再作为权威
- WebSocket snapshot 使用 FS 数据，旧的 task tree 结构将被 Agent tree 替代

---

## PRD v2.1 更新点落地

- 树状可视化展示 Agent 树，不再展示任务树
- Agent 节点展示 name + status 颜色 + current_step，hover 或右侧面板展示详情
- 节点详情展示 `plan.md` 子任务列表与状态
- Kanban 展示任务分配和执行进度

---

## 部署流程

1) 创建 TAG

```bash
git tag YYYYMMDD-<git-short-sha>
```

2) 按拆分部署规则在 ravin 部署轻量服务

```bash
# ravin 上执行
docker compose up -d edge gateway web-frontend searxng
```

3) 本机部署重服务

```bash
docker compose up -d api-backend agent-manager worker-playwright
```

4) 健康检查

```bash
curl -s https://roboard.duckdns.org/api/health
curl -s http://localhost:8000/health
curl -s http://localhost:7000/health
```

---

## 验证清单

- `pytest api-backend/tests/test_tree_api.py -v`
- `pytest api-backend/tests/test_ws_runs_snapshot.py -v`
- `pytest agent-manager/tests/test_dispatch_input_mapping.py -v`
- 手动检查前端 Agent 树与看板
