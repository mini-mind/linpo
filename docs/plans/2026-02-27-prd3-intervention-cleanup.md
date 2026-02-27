# PRD v3 介入流程清理 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 移除 CEO/A2A 旧流程，统一为 PRD v3 的自然语言干预 + 事件驱动流程，并同步更新前后端与文档。

**Architecture:** 后端仅保留 run/agent 树 + 事件流与 intervention 接口；前端通过 `/api/runs/{run_id}/interventions` 发送干预；配置与提示词只保留 lead/pm/engineer 角色。

**Tech Stack:** FastAPI, SQLAlchemy, pytest, vanilla JS frontend, Markdown docs

---

### Task 1: 介入与角色调整的测试（RED）

**Files:**
- Modify: `api-backend/tests/test_config_loader.py`
- Modify: `api-backend/tests/test_agent_hiring.py`
- Modify: `api-backend/tests/test_tree_api.py`
- Modify: `api-backend/tests/test_actions_sop_patch.py`
- Modify: `api-backend/tests/test_actions_sop_replace.py`
- Create: `api-backend/tests/test_agent_chat_removed.py`

**Step 1: Write the failing test**

```python
def test_agent_chat_endpoints_removed(tmp_path, monkeypatch) -> None:
    # expect /api/agents/*/chat and /chat/stream to return 404
    ...
```

**Step 2: Run test to verify it fails**

Run: `cd api-backend && .venv/bin/python -m pytest -q tests/test_agent_chat_removed.py::test_agent_chat_endpoints_removed`
Expected: FAIL (returns 200 before removal)

**Step 3: Update role/allowlist test expectations**

```python
rules = {"agent_type_allowlist": ["lead", "pm", "engineer"]}
assert result == ["lead", "pm", "engineer"]
```

**Step 4: Run updated tests to verify they fail**

Run: `cd api-backend && .venv/bin/python -m pytest -q tests/test_config_loader.py::test_get_allowed_agent_types_from_rules`
Expected: FAIL (still returns ceo)

**Step 5: Commit**

```bash
git add api-backend/tests/test_*.py
git commit -m "test: cover lead roles and remove agent chat endpoints"
```

### Task 2: 后端移除 CEO/A2A + 角色替换（GREEN）

**Files:**
- Modify: `api-backend/app/main.py`
- Modify: `api-backend/app/agent_hiring.py`
- Modify: `api-backend/app/config_loader.py`
- Modify: `config/decision_rules.json`
- Modify: `config/agents.yaml`
- Modify: `config/tools.yaml`
- Modify: `config/skills.yaml`
- Add: `prompts/agents/lead.md`
- Add: `sops/templates/lead.md`
- Delete: `prompts/agents/ceo.md`
- Delete: `prompts/skills/a2a_consult.md`
- Delete: `sops/templates/ceo.md`

**Step 1: Remove /api/agents/*/chat endpoints**

```python
# delete /api/agents/{agent_type}/chat and /chat/stream handlers
```

**Step 2: Switch root role to lead**

```python
role_label="lead"
sop_text=config_loader.load_sop_template("lead") or "# Lead SOP\n"
```

**Step 3: Update allowlist fallback to lead**

```python
_FALLBACK_ALLOWED_AGENT_TYPES = ["lead", "pm", "engineer"]
```

**Step 4: Run tests to verify they pass**

Run: `cd api-backend && .venv/bin/python -m pytest -q tests/test_agent_chat_removed.py tests/test_config_loader.py tests/test_agent_hiring.py tests/test_tree_api.py tests/test_actions_sop_patch.py tests/test_actions_sop_replace.py`
Expected: PASS

**Step 5: Commit**

```bash
git add api-backend/app/*.py config/*.yaml config/decision_rules.json prompts/agents/lead.md sops/templates/lead.md
git commit -m "feat: switch to lead roles and remove agent chat endpoints"
```

### Task 3: 前端改为介入提交（GREEN）

**Files:**
- Modify: `web-frontend/app.js`
- Modify: `web-frontend/README.md`

**Step 1: Update chat submission to interventions**

```javascript
await apiFetch(`/api/runs/${encodeURIComponent(state.runId)}/interventions`, {
  method: "POST",
  body: JSON.stringify({ agent_id: agentId, message })
})
```

**Step 2: Add UI feedback for intervention submission**

```javascript
setMessage(t("taskTree.msg.interventionSubmitted"), "ok");
```

**Step 3: Manual verification**

Run: `docker compose up -d web-frontend gateway edge`
Expected: UI can submit intervention without calling /api/agents/*/chat

**Step 4: Commit**

```bash
git add web-frontend/app.js web-frontend/README.md
git commit -m "feat: send interventions from task tree UI"
```

### Task 4: 清理 agent-manager A2A 与脚本（GREEN）

**Files:**
- Modify: `agent-manager/app/main.py`
- Modify: `agent-manager/README.md`
- Modify: `agent-manager/AGENTS.md`
- Modify: `docker-compose.yml`
- Delete: `scripts/verify_sse_streaming.py`

**Step 1: Remove A2A stream handling**

```python
# delete A2A_* env vars and A2A consumer loop
```

**Step 2: Update docs and compose**

```yaml
# remove A2A_* env vars from docker-compose
```

**Step 3: Run tests**

Run: `cd agent-manager && .venv/bin/python -m pytest -q`
Expected: PASS

**Step 4: Commit**

```bash
git add agent-manager/app/main.py agent-manager/README.md agent-manager/AGENTS.md docker-compose.yml
git commit -m "chore: remove A2A stream handling"
```

### Task 5: 文档与索引更新（GREEN）

**Files:**
- Modify: `README.md`
- Modify: `docs/README.md`
- Modify: `docs/agent-framework.md`
- Modify: `AGENTS.md`
- Modify: `docs/AGENTS.md`
- Modify: `scripts/AGENTS.md`

**Step 1: Replace A2A/CEO sections with intervention flow**

```markdown
## 自然语言干预（Intervention）
POST /api/runs/{run_id}/interventions
```

**Step 2: Update navigation links**

```markdown
- [自然语言干预](../README.md#intervention)
```

**Step 3: Commit**

```bash
git add README.md docs/README.md docs/agent-framework.md AGENTS.md docs/AGENTS.md scripts/AGENTS.md
git commit -m "docs: align guidance with intervention flow"
```

### Task 6: Final verification

**Step 1: LSP diagnostics**

Run: `python -m pytest -q` in `api-backend` and `agent-manager`
Expected: PASS

**Step 2: Summarize changes**

Provide a short report of removed A2A/CEO references and new intervention flow docs.

**Step 3: Commit**

```bash
git status
```
