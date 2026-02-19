# RoBoard MVP(2) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement MVP(2): scenario templates + scheduling + deterministic reporting on top of MVP(1) runs + WS cockpit.

**Architecture:** Reuse the existing `runs/tasks + events` spine. Add a minimal persisted schedule entity and a small template compiler surface. Implement a deterministic report derived from events (no LLM dependency). Use agent-manager as the periodic scheduler runner.

**Tech Stack:** FastAPI + SQLAlchemy + Alembic + Postgres + Redis; existing docker compose deployment.

---

## Pre-Flight (Read This First)

Inputs:
- Design: `docs/plans/2026-02-19-roboard-mvp2-design.md`
- Product/P0 constraints: `docs/decisions/positioning-2026-02-13.md`, `docs/plans/p0-development-plan-2026-02-13.md`
- Existing MVP(1): `docs/plans/2026-02-16-roboard-mvp1-design.md`

Verification philosophy:
- Per-service pytest (each service runs its own `pytest`).

---

### Task 1: Add schedule models + Alembic migration (RED -> GREEN)

**Files:**
- Modify: `api-backend/app/models.py`
- Create: `api-backend/alembic/versions/20260219_0001_schedules.py`
- Create: `api-backend/tests/test_schedules_models_smoke.py`

**Step 1: Write the failing test**

Create a smoke test that imports the Schedule model and can `Base.metadata.create_all()` in SQLite.

**Step 2: Run test to verify it fails**

Run:

```bash
cd api-backend
.venv/bin/python -m pytest -q tests/test_schedules_models_smoke.py
```

Expected: FAIL (model/migration missing).

**Step 3: Minimal implementation**

Add a `Schedule` model with these minimum fields:
- tenant_id
- template_key
- params_json
- interval_sec
- next_run_at
- enabled

Add an Alembic migration creating the schedules table.

**Step 4: Run test to verify it passes**

```bash
cd api-backend
.venv/bin/python -m pytest -q tests/test_schedules_models_smoke.py
```

---

### Task 2: Implement schedule API endpoints (RED -> GREEN)

**Files:**
- Create: `api-backend/app/schedules_api.py`
- Modify: `api-backend/app/main.py`
- Create: `api-backend/tests/test_schedules_api.py`

**Step 1: Write the failing tests**

Test:
- `POST /api/schedules` creates schedule.
- `GET /api/schedules` lists schedules for tenant.
- enable/disable endpoints flip enabled.

**Step 2: Run tests (fail)**

```bash
cd api-backend
.venv/bin/python -m pytest -q tests/test_schedules_api.py
```

**Step 3: Minimal implementation**

Implement:
- `POST /api/schedules`
- `GET /api/schedules`
- `POST /api/schedules/{schedule_id}/enable`
- `POST /api/schedules/{schedule_id}/disable`

Auth: reuse existing tenant auth (`require_tenant`).

**Step 4: Run tests (pass)**

```bash
cd api-backend
.venv/bin/python -m pytest -q tests/test_schedules_api.py
```

---

### Task 3: Implement template registry + compile endpoint (RED -> GREEN)

**Files:**
- Create: `api-backend/app/templates_api.py`
- Create: `api-backend/app/templates/supplier_monitoring.py`
- Modify: `api-backend/app/main.py`
- Create: `api-backend/tests/test_templates_compile.py`

**Step 1: Write failing test**

Test:
- `GET /api/templates` returns at least `supplier.monitoring`.
- `POST /api/templates/supplier.monitoring/compile` returns `{input_nl, input}`.

**Step 2: Run test (fail)**

```bash
cd api-backend
.venv/bin/python -m pytest -q tests/test_templates_compile.py
```

**Step 3: Minimal implementation**

Implement one server-side template with minimal params:
- suppliers: list[str]
- keywords: list[str]

Compile output should be deterministic (no LLM) and suitable for `POST /api/runs`.

**Step 4: Run test (pass)**

```bash
cd api-backend
.venv/bin/python -m pytest -q tests/test_templates_compile.py
```

---

### Task 4: Agent-manager scheduler loop (RED -> GREEN)

**Files:**
- Modify: `agent-manager/app/main.py`
- Create: `agent-manager/tests/test_scheduler_tick.py`

**Step 1: Write failing test**

Test a pure function `compute_due_schedules(now, schedules)` or a `tick()` helper to avoid time-based flakiness.

**Step 2: Run test (fail)**

```bash
cd agent-manager
.venv/bin/python -m pytest -q tests/test_scheduler_tick.py
```

**Step 3: Minimal implementation**

Add a small periodic coroutine that:
- Calls api-backend `GET /internal/schedules/due` (or `GET /api/schedules?due=1` if internal endpoint is not desired).
- For each schedule, calls `POST /api/runs` with compiled template input.
- Emits a run event tying back to schedule id.

Note: keep it minimal; correctness over throughput.

**Step 4: Run tests (pass)**

```bash
cd agent-manager
.venv/bin/python -m pytest -q
```

---

### Task 5: Deterministic run report endpoint (RED -> GREEN)

**Files:**
- Create: `api-backend/app/reporting.py`
- Modify: `api-backend/app/main.py`
- Create: `api-backend/tests/test_runs_report.py`

**Step 1: Write failing test**

Test:
- `GET /api/runs/{run_id}/report` returns summary fields derived from events.

**Step 2: Run test (fail)**

```bash
cd api-backend
.venv/bin/python -m pytest -q tests/test_runs_report.py
```

**Step 3: Minimal implementation**

Report fields (minimum viable):
- run: `{run_id, status, created_at, updated_at}`
- counts: number of events by type prefix
- last_event: last event id + type + timestamp

**Step 4: Run test (pass)**

```bash
cd api-backend
.venv/bin/python -m pytest -q tests/test_runs_report.py
```

---

### Task 6: Documentation updates (ops + API)

**Files:**
- Modify: `docs/prod-deployment.md`
- Modify: `docs/deployment/local.md`

**Content:**
- Document MVP2 endpoints: schedules/templates/reporting.
- Document where the scheduler loop runs (agent-manager).

**Verification:**
- N/A (docs), but do not include secrets.
