# RoBoard Cockpit Auth (Email+Password + Cookie Sessions) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the cockpit usable by non-technical users via registration/login, replacing the need to paste `X-API-Key` in the browser UI.

**Architecture:** Keep `X-API-Key` for power-user/API and service-to-service; add a browser-friendly auth path using a server-side session table (`sessions`) and an httpOnly cookie. Authenticate HTTP and WebSocket requests via either header API key or cookie session.

**Tech Stack:** FastAPI + SQLAlchemy + Alembic (existing tables: `users`, `sessions`, `tenants`) + static web frontend.

---

## Pre-Flight (Read This First)

Assumptions locked for MVP:

- Registration mode: **open** (register creates a tenant + owner user).
- Browser auth: **httpOnly cookie session** (not JWT in localStorage).
- Same-origin: cockpit + API + WS served under `https://roboard.duckdns.org`.

Verification philosophy:

- TDD: write failing tests first; watch them fail; implement minimal code; re-run tests.
- Run `cd api-backend && .venv/bin/python -m pytest -q` before calling any backend work "done".

---

### Task 1: Add auth API tests (RED)

**Files:**
- Create: `session-b-api/tests/test_auth_sessions.py`

**Step 1: Write the failing tests**

Add tests for:

1) `POST /api/auth/register` returns 200, sets session cookie.
2) Cookie-authenticated client can call `POST /api/runs` without `X-API-Key`.
3) WebSocket connect to `/ws/runs/{run_id}` works with cookie auth (no `api_key` query param).

**Step 2: Run test to verify it fails**

Run:

```bash
cd api-backend
.venv/bin/python -m pytest -q tests/test_auth_sessions.py
```

Expected: FAIL (endpoints missing / auth not wired).

---

### Task 2: Implement auth endpoints (GREEN)

**Files:**
- Create: `session-b-api/app/auth_api.py`
- Modify: `session-b-api/app/main.py`
- Modify (if needed): `session-b-api/app/auth.py`

**Implementation requirements:**

- Endpoints:
  - `POST /api/auth/register` (email, password, tenant_name?) -> creates tenant + user + session, sets cookie.
  - `POST /api/auth/login` -> creates session, sets cookie.
  - `POST /api/auth/logout` -> revokes session, clears cookie.
  - `GET /api/auth/me` -> returns user + tenant summary.

- Cookie behavior:
  - Cookie name: `roboard_session`
  - httpOnly, SameSite=Lax, Path=/
  - Secure controlled by env (e.g. `ROBOARD_COOKIE_SECURE=1` in prod; default off for tests)

**Step 1: Minimal implementation**

Implement session token creation:
- raw token: `secrets.token_urlsafe(32)`
- DB stores hash: `auth.hash_session_token(raw)`

Implement password hashing:
- Use existing PBKDF2 helper in `session-b-api/app/auth.py` (`hash_password`, `verify_password`).

**Step 2: Run tests**

```bash
cd api-backend
.venv/bin/python -m pytest -q tests/test_auth_sessions.py
```

Expected: PASS.

---

### Task 3: Accept cookie session in tenant auth dependency (HTTP)

**Files:**
- Modify: `session-b-api/app/main.py`

**Behavior:**
- Existing behavior preserved: if `X-API-Key` header is present, authenticate by API key.
- Otherwise, if `roboard_session` cookie is present and valid (not revoked/expired), resolve `tenant` via `sessions.user_id -> users.tenant_id`.

**Verification:**
- `tests/test_auth_sessions.py` should now pass end-to-end.
- Run full suite:

```bash
cd api-backend
.venv/bin/python -m pytest -q
```

---

### Task 4: Accept cookie session in websocket auth (WS)

**Files:**
- Modify: `session-b-api/app/main.py`

**Behavior:**
- `/ws/runs/{run_id}` (and optionally `/ws/events`) should accept either:
  - `api_key` query param, OR
  - cookie session (`roboard_session`) when same-origin.

**Verification:**
- `tests/test_auth_sessions.py` websocket test passes.

---

### Task 5: Update cockpit frontend to use login and cookies (no key pasting)

**Files:**
- Modify: `session-f-edge-ui/web-frontend/index.html`
- Modify: `session-f-edge-ui/web-frontend/style.css`
- Modify: `session-f-edge-ui/web-frontend/app.js`

**Behavior:**
- Add a simple auth screen (email+password): Register / Login.
- After login, show cockpit.
- All fetch calls use `credentials: "include"`.
- WS connect uses `/ws/runs/{run_id}` without `api_key` in URL.
- Keep an Advanced section to show `X-API-Key` only for power-users (optional; hidden by default).

**Verification:**
- Manual: register, login, create run, connect WS, view tree + events.

---

### Task 6: Update ops/docs

**Files:**
- Modify: `.sisyphus/notepads/prod-ops/ops.md`
- Modify: `session-a-docs/deployment/local.md`

**Behavior:**
- Document auth endpoints and required env vars.
- Document cookie secure flag for prod.
