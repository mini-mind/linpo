# RoBoard MVP(1) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement MVP(1): run-scoped agent team tree + realtime cockpit (snapshot+delta) + natural-language interventions that update per-agent SOP (effective next step), with machine-level admission control and per-tenant resource caps.

**Architecture:** Add new run-scoped entities (agent_instances, sop_versions, actions, tool registry/permissions, membership/resource profiles) while reusing/extending the existing `tasks` and `events` spine. Store SOP bodies as host-mounted Markdown; store operational metadata in Postgres/Redis; push status via WS snapshot+delta.

**Tech Stack:** FastAPI + SQLAlchemy + Alembic + Postgres + Redis Streams; Nginx gateway; Web frontend (existing) migrated incrementally.

---

## Pre-Flight (Read This First)

Decisions locked in design:
- External API naming uses `runs`.
- Internal run record reuses/extents existing `tasks` table (`task_id == run_id`).
- SOP inheritance: copy full Markdown file (no overlay).
- SOP updates affect next step only.
- Topology: strict parent-child tree (no DAG).
- SOP Markdown contains human-readable steps only; operational fields live in Postgres/Redis.
- Resource caps (MVP default): cpu=0.25 core, mem=2 GiB, disk=5 GiB.
- Machine admission: max_active_users=5; fuses: swap_used > 4 GiB OR mem_available < 500 MiB.
- Admission UX: allow run creation but queue when blocked.

Source of truth:
- Design: `docs/plans/2026-02-16-roboard-mvp1-design.md`
- Resource decisions: `.sisyphus/notepads/project-revamp-foundation/decisions.md`

Verification philosophy:
- User chose per-service pytest (each service runs its own `pytest`).

---

### Task 1: Establish per-service pytest baseline (minimal)

**Files:**
- Create: `api-backend/requirements-dev.txt`
- Create: `agent-manager/requirements-dev.txt`
- Create: `worker-playwright/requirements-dev.txt`
- Create: `mcp-server/requirements-dev.txt`
- Create: `llm-gateway/requirements-dev.txt`
- Create: `playwright-gateway/requirements-dev.txt`
- Create: `api-backend/tests/test_health.py`
- Create: `agent-manager/tests/test_health.py`
- Create: `worker-playwright/tests/test_health.py`
- Create: `mcp-server/tests/test_health.py`
- Create: `llm-gateway/tests/test_health.py`
- Create: `playwright-gateway/tests/test_health.py`

**Step 1: Write the failing test**
- Add a FastAPI TestClient health check test per service (imports app and calls `/health`).

**Step 2: Run test to verify it fails**
- Run (per service):
  - `python -m pip install -r requirements.txt -r requirements-dev.txt`
  - `pytest -q`
- Expected: FAIL (pytest missing / tests missing).

**Step 3: Write minimal implementation**
- Add `pytest` (and `httpx`/`starlette` if needed) to each `requirements-dev.txt`.
- Ensure each service exposes `GET /health` (many already do).

**Step 4: Run test to verify it passes**
- `pytest -q`
- Expected: PASS.

**Step 5: Commit (optional)**
- `git add ... && git commit -m "test: add per-service health pytest baseline"`

---

### Task 2: Define SOP host-mounted root and safe IO utilities

**Files:**
- Modify: `api-backend/app/main.py`
- Create: `api-backend/app/sop_store.py`
- Test: `api-backend/tests/test_sop_store.py`

**Step 1: Write the failing test**
- Tests for SOP path building:
  - Normal case: `{tenant}/{run}/{agent}/v1.md` is accepted.
  - Traversal attempts (`..`, absolute paths) are rejected.

**Step 2: Run test (fail)**
- `cd api-backend && pytest -q`
- Expected: FAIL (module missing).

**Step 3: Minimal implementation**
- Implement `sop_store.py`:
  - `get_sop_root()` from env `ROBOARD_ROOT` (or `ROBOARD_SOP_ROOT`).
  - `build_sop_relpath(tenant_id, run_id, agent_id, version)`.
  - `read_sop_text(relpath)` / `write_sop_text(relpath, text)`.
  - Enforce: relative paths only, normalized, no escape.

**Step 4: Run test (pass)**
- `pytest -q`

**Step 5: Commit (optional)**

---

### Task 3: Add run-scoped tables via Alembic migration

**Files:**
- Create: `api-backend/alembic/versions/20260216_0005_runs_agents_sop_actions_tools_tiers.py`
- Modify: `api-backend/app/models.py`
- Test: `api-backend/tests/test_models_smoke.py`

**Step 1: Write failing test**
- A smoke test that imports models and can create tables in an in-memory DB (or a temp SQLite file) for non-Postgres-specific parts.

**Step 2: Run test (fail)**
- `cd api-backend && pytest -q`

**Step 3: Minimal implementation**
- Add new SQLAlchemy models:
  - `AgentInstance`, `SopVersion`, `Action`, `Tool`, `ToolPermission`, `MembershipTier`, `ResourceProfile`.
- Extend existing `Task` and `Event` models with new nullable columns needed for MVP.
- Add Alembic migration creating new tables and columns.

**Step 4: Run test (pass)**
- `pytest -q`

**Step 5: Commit (optional)**

---

### Task 4: Expand event type validation to include run/agent/sop/action

**Files:**
- Modify: `api-backend/app/main.py`
- Test: `api-backend/tests/test_event_validation.py`

**Step 1: Write failing test**
- Posting a new event type like `agent.hired` should be accepted.
- Unknown type should still be rejected.

**Step 2: Run test (fail)**
- `cd api-backend && pytest -q`

**Step 3: Minimal implementation**
- Extend `ALLOWED_EVENT_TYPES` to include MVP(1) types.
- Ensure event-to-status mapping remains consistent (task status remains task-level).

**Step 4: Run test (pass)**
- `pytest -q`

---

### Task 5: Introduce `/api/runs` endpoints as the unified external surface

**Files:**
- Modify: `api-backend/app/main.py`
- Create: `api-backend/app/runs_api.py`
- Test: `api-backend/tests/test_runs_api_smoke.py`

**Step 1: Write failing test**
- `POST /api/runs` returns a run_id.
- `GET /api/runs/{run_id}` returns run.

**Step 2: Run test (fail)**
- `cd api-backend && pytest -q`

**Step 3: Minimal implementation**
- Add `/api/runs` routes.
- Internally call existing task creation or share logic.
- Keep `/api/tasks` as compatibility alias for now.

**Step 4: Run test (pass)**
- `pytest -q`

---

### Task 6: Implement agent tree creation (hire employees) for a run

**Files:**
- Modify: `api-backend/app/main.py`
- Create: `api-backend/app/agent_hiring.py`
- Test: `api-backend/tests/test_agent_hiring.py`

**Step 1: Write failing test**
- Given a minimal parsed spec, create:
  - root agent_instance
  - 1-2 child agent_instances
  - SOP v1 files for each

**Step 2: Run test (fail)**

**Step 3: Minimal implementation**
- Start with deterministic fake hiring (no LLM): create CEO + 2 children for a run.
- Persist rows and SOP files.
- Emit `agent.hired` + `sop.created` events.

**Step 4: Run test (pass)**

---

### Task 7: Implement `/api/runs/{run_id}/tree` and SOP read endpoints

**Files:**
- Modify: `api-backend/app/main.py`
- Create: `api-backend/app/tree_api.py`
- Test: `api-backend/tests/test_tree_api.py`

**Step 1: Write failing test**
- `GET /api/runs/{run_id}/tree` returns agents + edges.
- `GET /api/agents/{agent_id}/sop` returns md_text.

**Step 2: Run test (fail)**

**Step 3: Minimal implementation**
- Build edges from parent_agent_id.
- Read SOP from host-mounted path via sop_store.

**Step 4: Run test (pass)**

---

### Task 8: Add WS channel for run snapshot + delta

**Files:**
- Modify: `api-backend/app/main.py`
- Test: `api-backend/tests/test_ws_runs_snapshot.py`

**Step 1: Write failing test**
- Connect WS and expect first frame is `snapshot` including agents + edges.

**Step 2: Run test (fail)**

**Step 3: Minimal implementation**
- Add `/ws/runs/{run_id}`.
- Reuse existing connection manager.
- Snapshot contains: run, agents, edges, recent events, cursor.

**Step 4: Run test (pass)**

---

### Task 9: Actions (interventions) that produce new SOP versions

**Files:**
- Modify: `api-backend/app/main.py`
- Create: `api-backend/app/actions.py`
- Test: `api-backend/tests/test_actions_sop_patch.py`

**Step 1: Write failing test**
- `POST /api/runs/{run_id}/actions` with `action_type=sop.replace` creates a new sop_version and updates agent current_sop_version.

**Step 2: Run test (fail)**

**Step 3: Minimal implementation**
- Implement `sop.replace` first (simpler than patch).
- Enforce optimistic concurrency with expected head.
- Emit `action.requested` then `sop.updated` and `action.applied`.

**Step 4: Run test (pass)**

---

### Task 10: Admission control + fuses (queue runs instead of rejecting)

**Files:**
- Modify: `api-backend/app/main.py`
- Create: `api-backend/app/admission.py`
- Test: `api-backend/tests/test_admission_queueing.py`

**Step 1: Write failing test**
- When active_users >= 5, `POST /api/runs` still creates run but state is queued and emits `run.admission.queued`.

**Step 2: Run test (fail)**

**Step 3: Minimal implementation**
- Use Redis counters/sets with TTL heartbeats per tenant.
- Implement fuses by parsing `/proc/meminfo` (no extra deps).

**Step 4: Run test (pass)**

---

### Task 11: Wire tool registry + permissions (minimal enforcement)

**Files:**
- Modify: `api-backend/app/main.py`
- Create: `api-backend/app/tools_registry.py`
- Test: `api-backend/tests/test_tool_permissions.py`

**Step 1: Write failing test**
- Denied tool call returns permission error and emits an event.

**Step 2: Run test (fail)**

**Step 3: Minimal implementation**
- Register minimal tools: a2a.send, a2a.fetch_thread, mcp.search, browser.run.
- Enforce allowlist per agent_instance.

**Step 4: Run test (pass)**

---

### Task 12: Identify and remove unused legacy services/code (verified)

**Files:**
- Modify: `docker-compose.yml` (only after evidence)
- Modify: `deploy/` and `docs/` as needed
- Test: per-service `pytest -q` still passes

**Step 1: Write the failing test**
- N/A (this is a safe-deletion task). Instead define a verification checklist.

**Step 2: Verify current state**
- `cd api-backend && pytest -q`
- `cd agent-manager && pytest -q`
- (repeat for other services)

**Step 3: Minimal implementation**
- Remove one candidate at a time.
- After each removal, rerun tests and basic health endpoints.

**Step 4: Verify**
- All service tests pass.
- `docker-compose config` remains valid.

---

## Later (MVP(2)/MVP(3) only)
- MVP(2): scheduling, vertical scenario templates, richer notifications/reports.
- MVP(3): template reuse, contract normalization, billing/usage accounting.
