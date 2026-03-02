# Skill Exec Queue Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a skill execution queue that enqueues from api and is consumed by dispatch, calling skill-gateway `/skills/execute` and posting `skill.execute.*` events.

**Architecture:** api exposes a new invoke endpoint to validate tenant/run/agent and enqueue a Redis stream message to `queue:skill-exec`. dispatch adds a consumer loop similar to `queue:skill-create`, calls skill-gateway with internal auth, and posts `skill.execute.succeeded` or `skill.execute.failed` task events back to api. The enqueue payload and event data remain minimal and mirror the existing skill-create pattern.

**Tech Stack:** FastAPI, Redis Streams, requests, pytest, SQLAlchemy.

---

### Task 1: API enqueue endpoint + failing test (TDD)

**Files:**
- Create: `api/tests/test_skill_invoke.py`
- Modify: `api/app/tree_api.py`

**Step 1: Write the failing test**

```python
def test_skill_invoke_enqueues(tmp_path, monkeypatch) -> None:
    # POST /api/skills/{skill_key}/invoke enqueues to queue:skill-exec
    assert True
```

Test expectations:
- Creates tenant + run + agent
- Calls `POST /api/skills/{skill_key}/invoke`
- Asserts Redis `xadd` called with stream `queue:skill-exec`
- Payload includes `tenant_id`, `run_id`, `agent_id`, `skill_key`, `input_json`, `enqueued_at`, `trace_id`

**Step 2: Run test to verify it fails**

Run: `cd api && .venv/bin/python -m pytest -q tests/test_skill_invoke.py::test_skill_invoke_enqueues`
Expected: FAIL (endpoint not found)

**Step 3: Write minimal implementation**

```python
@router.post("/api/skills/{skill_key}/invoke", response_model=SkillInvokeOut)
async def invoke_skill(...):
    # validate tenant, run_id, agent_id, skill_key
    # enqueue to queue:skill-exec
```

Design assumptions:
- Request body contains `run_id`, `agent_id`, and `input` dict
- `input_json` includes `{"skill_key": skill_key, "input": body.input}`

**Step 4: Run test to verify it passes**

Run: `cd api && .venv/bin/python -m pytest -q tests/test_skill_invoke.py::test_skill_invoke_enqueues`
Expected: PASS

**Step 5: Refactor (if needed)**

- Keep consistent validation helpers with existing skill bootstrap endpoint

---

### Task 2: Dispatch consumer + failing test (TDD)

**Files:**
- Create: `dispatch/tests/test_skill_exec_consumer.py`
- Modify: `dispatch/app/main.py`

**Step 1: Write the failing test**

```python
def test_skill_exec_posts_event(monkeypatch) -> None:
    # handle_skill_exec_message posts skill.execute.succeeded
    assert True
```

Test expectations:
- Build fields dict with tenant/run/agent/skill_key/input_json
- Monkeypatch `requests.post` to return payload
- Monkeypatch `post_event` to record events
- Call `handle_skill_exec_message` directly
- Asserts `skill.execute.succeeded` with data including `agent_id`, `skill_key`, `result`

**Step 2: Run test to verify it fails**

Run: `cd dispatch && .venv/bin/python -m pytest -q tests/test_skill_exec_consumer.py::test_skill_exec_posts_event`
Expected: FAIL (function missing)

**Step 3: Write minimal implementation**

```python
SKILL_EXEC_STREAM = os.getenv("SKILL_EXEC_STREAM", "queue:skill-exec")
SKILL_EXEC_GROUP = os.getenv("SKILL_EXEC_GROUP", "dispatch-skill-exec")
SKILL_EXEC_CONSUMER = os.getenv("SKILL_EXEC_CONSUMER", DISPATCH_CONSUMER)

async def handle_skill_exec_message(...):
    # parse fields, call skill-gateway /skills/execute
    # post skill.execute.succeeded / skill.execute.failed

async def skill_exec_consumer_loop(...):
    # xgroup_create + xreadgroup
```

**Step 4: Run test to verify it passes**

Run: `cd dispatch && .venv/bin/python -m pytest -q tests/test_skill_exec_consumer.py::test_skill_exec_posts_event`
Expected: PASS

**Step 5: Refactor (if needed)**

- Keep event posting consistent with skill create pattern

---

### Task 3: Service metadata + verification

**Files:**
- Modify: `api/AGENTS.md`
- Modify: `dispatch/AGENTS.md`

**Step 1: Update AGENTS.md**

- Add entry for skill invoke enqueue endpoint in api
- Add entry for skill exec consumer in dispatch

**Step 2: Run service tests**

Run:
- `cd api && .venv/bin/python -m pytest -q tests/test_skill_invoke.py`
- `cd dispatch && .venv/bin/python -m pytest -q tests/test_skill_exec_consumer.py`

Expected: PASS
