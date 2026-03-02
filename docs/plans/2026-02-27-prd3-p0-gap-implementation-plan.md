# PRD v3 P0 Gap Closure Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 补齐 PRD v3 P0 缺失项（可信来源绑定与干预控制按钮），确保后端有明确 API、前端有可用 UI，并通过对应测试。

**Architecture:** 后端通过 run/agent 级 API 管理可信来源清单（基于 agent FS 中的 `context/sources`），并新增干预控制 action 类型以产生标准事件。前端在任务详情面板展示/编辑来源，并提供暂停/继续/重试按钮，统一走后端 action 入口并依赖事件流刷新状态。

**Tech Stack:** FastAPI, SQLAlchemy, pytest, vanilla JS frontend, Markdown docs

## PRD v3 P0 对比

| PRD v3 P0 条目 | PRD 位置 | 计划覆盖 | 状态 |
| --- | --- | --- | --- |
| 自然语言干预（基础） | 3.3 / 5.P0 | Task 3（干预控制按钮） | 覆盖 |
| 可信来源机制 | 3.4 / 5.P0 | Task 1 + Task 2 | 覆盖 |
| 树状可视化 + WS 实时状态 | 3.2 / 5.P0 | 不在本计划范围 | 已有基础实现 |
| 自然语言创建团队（基础版） | 3.1 / 5.P0 | 不在本计划范围 | 已有基础实现 |
| Agent 基础执行引擎 | 5.P0 | 不在本计划范围 | 已有基础实现 |
| 前端基础界面（指挥舱） | 5.P0 | Task 2 + Task 3（补齐来源与控制） | 覆盖 |

说明：本计划聚焦“缺口补齐”，对 P0 中已具备基础实现的条目仅做对齐说明，不重复拆解。

---

### Task 1: 可信来源 API（后端）

**Files:**
- Modify: `session-b-api/app/tree_api.py`
- Modify: `session-b-api/app/agent_fs.py`
- Create: `session-b-api/tests/test_agent_sources.py`

**Step 1: Write the failing test**

```python
def test_agent_sources_roundtrip(tmp_path, monkeypatch):
    # 1) create run
    # 2) PUT sources -> expect 200 and echo list
    # 3) GET sources -> expect same list
    # 4) verify dirs created under context/sources
    assert True
```

**Step 2: Run test to verify it fails**

Run: `cd api-backend && .venv/bin/python -m pytest -q tests/test_agent_sources.py::test_agent_sources_roundtrip`

Expected: FAIL (endpoint not found)

**Step 3: Write minimal implementation**

```python
# session-b-api/app/tree_api.py
@router.get("/api/runs/{run_id}/agents/{agent_id}/sources")
async def get_agent_sources(...):
    # return manifest list, default []

@router.put("/api/runs/{run_id}/agents/{agent_id}/sources")
async def put_agent_sources(...):
    # validate relative paths, write manifest, create dirs
```

```python
# session-b-api/app/agent_fs.py
def read_sources_manifest(agent_root: Path) -> list[dict[str, str]]: ...
def write_sources_manifest(agent_root: Path, sources: list[dict[str, str]]) -> None: ...
```

**Step 4: Run test to verify it passes**

Run: `cd api-backend && .venv/bin/python -m pytest -q tests/test_agent_sources.py::test_agent_sources_roundtrip`

Expected: PASS

**Step 5: Commit**

```bash
git add session-b-api/app/tree_api.py session-b-api/app/agent_fs.py session-b-api/tests/test_agent_sources.py
git commit -m "feat: add agent source bindings API"
```

---

### Task 2: 可信来源 UI（前端）

**Files:**
- Modify: `session-f-edge-ui/web-frontend/index.html`
- Modify: `session-f-edge-ui/web-frontend/app.js`
- Modify: `session-f-edge-ui/web-frontend/style.css`
- Modify: `session-f-edge-ui/web-frontend/README.md`

**Step 1: Write the failing test (manual check)**

Add a minimal manual checklist in README to ensure a reviewer can validate the UI.

```markdown
- [ ] 选择 agent 后可见 “Sources” 面板
- [ ] 可添加来源路径并保存
- [ ] 刷新后来源列表保持一致
```

**Step 2: Run manual check to verify it fails**

Run: `docker compose up -d web-frontend gateway edge`

Expected: UI 无 “Sources” 面板

**Step 3: Write minimal implementation**

```html
<!-- session-f-edge-ui/web-frontend/index.html -->
<section class="panel sources">
  <h3>Sources</h3>
  <div class="sources-list" id="sourcesList"></div>
  <form id="sourcesForm">...</form>
</section>
```

```javascript
// session-f-edge-ui/web-frontend/app.js
async function loadSources(runId, agentId) { ... }
async function saveSources(runId, agentId, sources) { ... }
```

**Step 4: Run manual check to verify it passes**

Run: `docker compose up -d web-frontend gateway edge`

Expected: Sources 面板可编辑并保存

**Step 5: Commit**

```bash
git add session-f-edge-ui/web-frontend/index.html session-f-edge-ui/web-frontend/app.js session-f-edge-ui/web-frontend/style.css session-f-edge-ui/web-frontend/README.md
git commit -m "feat: add trusted sources panel"
```

---

### Task 3: 干预控制按钮（暂停/继续/重试）

**Files:**
- Modify: `session-b-api/app/actions.py`
- Modify: `session-b-api/app/main.py`
- Modify: `session-b-api/tests/test_actions_sop_patch.py`
- Create: `session-b-api/tests/test_run_controls.py`
- Modify: `session-f-edge-ui/web-frontend/index.html`
- Modify: `session-f-edge-ui/web-frontend/app.js`
- Modify: `session-f-edge-ui/web-frontend/style.css`

**Step 1: Write the failing test**

```python
def test_run_control_action_emits_events(tmp_path, monkeypatch):
    # POST /api/runs/{run_id}/actions with action_type="run.pause"
    # expect action.requested event and ActionOut status
    assert True
```

**Step 2: Run test to verify it fails**

Run: `cd api-backend && .venv/bin/python -m pytest -q tests/test_run_controls.py::test_run_control_action_emits_events`

Expected: FAIL (unsupported action_type)

**Step 3: Write minimal implementation**

```python
# session-b-api/app/actions.py
if body.action_type in {"run.pause", "run.resume", "run.retry"}:
    # create action + action.requested event, update agent/task state where needed
```

```javascript
// session-f-edge-ui/web-frontend/app.js
await apiFetch(`/api/runs/${runId}/actions`, { action_type: "run.pause", ... })
```

**Step 4: Run test to verify it passes**

Run: `cd api-backend && .venv/bin/python -m pytest -q tests/test_run_controls.py::test_run_control_action_emits_events`

Expected: PASS

**Step 5: Commit**

```bash
git add session-b-api/app/actions.py session-b-api/app/main.py session-b-api/tests/test_run_controls.py session-f-edge-ui/web-frontend/index.html session-f-edge-ui/web-frontend/app.js session-f-edge-ui/web-frontend/style.css
git commit -m "feat: add run control actions and UI buttons"
```

---

### Task 4: Service verification + docs note

**Files:**
- Modify: `session-b-api/AGENTS.md`
- Modify: `session-f-edge-ui/web-frontend/AGENTS.md`
- Modify: `session-a-docs/agent-framework.md`

**Step 1: Run service tests**

Run: `cd api-backend && .venv/bin/python -m pytest -q`

Expected: PASS

Run: `cd web-frontend && echo "manual check"`

Expected: No errors

**Step 2: Update AGENTS notes**

```markdown
- YYYY-MM-DD: Added trusted sources API and UI; added run control actions.
```

**Step 3: Commit**

```bash
git add session-b-api/AGENTS.md session-f-edge-ui/web-frontend/AGENTS.md session-a-docs/agent-framework.md
git commit -m "docs: note trusted sources and controls"
```
