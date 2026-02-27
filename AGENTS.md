# PROJECT KNOWLEDGE BASE

**Generated:** 2026-02-26 12:12:23Z
**Commit:** 661b5cc
**Branch:** main

## OVERVIEW
RoBoard is a multi-service FastAPI backend + static frontend system orchestrated via Docker Compose.
Each service owns its own `app/main.py` entrypoint and `requirements*.txt` dependencies.

## STRUCTURE
```
./
├── api-backend/         # FastAPI API + DB + WS
├── agent-manager/       # Orchestrator, Redis streams, scheduler
├── llm-gateway/          # LLM proxy with internal auth
├── mcp-server/           # SearXNG proxy
├── worker-playwright/    # Worker API (calls MCP/Playwright)
├── playwright-gateway/   # Playwright runner orchestration
├── web-frontend/         # Static HTML/CSS/JS UI
├── gateway/              # Nginx reverse proxy rules
├── edge/                 # Caddy/Nginx edge proxy
├── deploy/               # Compose variants (prod/worker/legacy)
├── scripts/              # Deploy, push, backup, verify helpers
└── docs/                 # Human docs and plans
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| API/WS behavior | api-backend/app/main.py | FastAPI app, auth, WS events/snapshots |
| Dispatch + A2A | agent-manager/app/main.py | Redis streams, scheduler, dispatch |
| LLM proxy | llm-gateway/app/main.py | `/internal/llm/chat` only |
| SearXNG proxy | mcp-server/app/main.py | `/search` only |
| Worker API | worker-playwright/app/main.py | `/run` internal-only |
| Playwright runner | playwright-gateway/app/main.py | Docker runner orchestration |
| UI | web-frontend/index.html + app.js | No build step |
| Routing | gateway/nginx.conf + edge/Caddyfile | `/api`, `/ws`, `/` routing |
| Deployment | deploy/* | prod/worker/legacy compose |
| Ops scripts | scripts/* | deploy/push/backup/verify |

## CODE MAP
| Symbol | Type | Location | Refs | Role |
|--------|------|----------|------|------|
| app | FastAPI | api-backend/app/main.py | high | Core API + WS entrypoint |
| app | FastAPI | agent-manager/app/main.py | high | Dispatch + scheduler entrypoint |
| app | FastAPI | worker-playwright/app/main.py | high | Worker API entrypoint |
| app | FastAPI | playwright-gateway/app/main.py | high | Runner orchestration entry |
| app | FastAPI | llm-gateway/app/main.py | high | LLM proxy entrypoint |
| app | FastAPI | mcp-server/app/main.py | high | SearXNG proxy entry |

## CONVENTIONS
- Services use `app/main.py` + `tests/` with pytest-style `test_*.py`.
- Auth headers are split by boundary: `X-API-Key`, `X-Internal-Key`, `X-Admin-Key`.
- Local compose binds `api-backend` to `127.0.0.1:8005->8000` by default.
- No CI config files; builds are via Docker Compose + scripts.
- 每改完一个服务就立即更新相关的 `AGENTS.md` 并完成该服务测试。

## ANTI-PATTERNS (THIS PROJECT)
- Never commit secrets (see `docs/agent-framework.md`).
- Do not log secrets; keep provider keys out of repo.
- Worker images must not pull from Docker Hub on the worker host.
- Do not assume `npx playwright test` is configured.

## UNIQUE STYLES
- JSON logging with context IDs (trace/tenant/task) in backend services.
- Internal endpoints under `/internal/*` bypass gateway; require internal/admin auth.
- `agent_fs` helpers are duplicated across services; no shared utils package.

## COMMANDS
```bash
# Local compose (core stack)
docker compose up -d

# Deploy helpers
bash scripts/deploy_local.sh
bash scripts/deploy_worker_host.sh

# Worker deployment
INTERNAL_API_KEY=... TAG=YYYYMMDD-<sha> ./scripts/deploy_worker.sh

# Tests (per service)
cd api-backend && .venv/bin/python -m pytest -q
```

## NOTES
- `docs/CONSTITUTION.md` defines governance and communication rules; treat as authoritative.
- AGENTS.md follows directory precedence: the closest file to the working area applies.
- `.env` is required for secrets; `.env` and `.env.*` are gitignored.
- `.gitignore` also ignores `backups/`, `data/`, `screenshots/`, and `sops/*` (except templates).
- Root `package.json` exists for Playwright tooling; it is ignored by `.gitignore` so changes may not show.
- `docs/` uses dated filenames (`YYYY-MM-DD-*`) for plans/specs/decisions.
