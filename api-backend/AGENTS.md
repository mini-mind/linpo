# api-backend

## OVERVIEW
FastAPI service providing external API, internal admin endpoints, and WebSocket event streams.
Built on FastAPI + PostgreSQL + Redis; Agent execution logic remains custom.

## STRUCTURE
```
api-backend/
├── app/              # FastAPI app, models, WS handlers
├── alembic/          # DB migrations
├── tests/            # pytest tests
├── requirements.txt
└── requirements-dev.txt
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| HTTP + WS handlers | api-backend/app/main.py | Large entrypoint, auth + WS snapshots |
| Agent tree API | api-backend/app/tree_api.py | Tree endpoints + FS integration |
| SOP storage | api-backend/app/sop_store.py | SOP reads/writes in agent FS |
| Migrations | api-backend/alembic/versions/ | Schema history |
| Tests | api-backend/tests/ | pytest `test_*.py` |

## CONVENTIONS
- External auth uses `X-API-Key`; internal auth uses `X-Internal-Key` + `X-Tenant-ID`; admin uses `X-Admin-Key`.
- WS connects send a `snapshot` first, then stream incremental events.
- Task event types are mapped to status (`queued|running|needs_human|completed|failed`).
- 每改完一个服务就立即更新相关的 `AGENTS.md` 并完成该服务测试。

## ANTI-PATTERNS
- Do not expose `/internal/*` via gateway.
- Do not log or store secrets in task events or notifications.

## COMMANDS
```bash
cd api-backend
. .venv/bin/activate
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
python -m pytest -q
```

## NOTES
- Local compose binds `127.0.0.1:8005->8000` for host access.
- Migrations are Alembic-driven; keep schema changes in `alembic/versions`.
- 2026-02-27: Removed legacy agent chat/A2A; switched root role to lead; keep intervention endpoint `/api/runs/{run_id}/interventions`.
- 2026-02-27: Added agent sources API (`/api/runs/{run_id}/agents/{agent_id}/sources`) and run control actions (`/api/runs/{run_id}/actions`); pytest `47 passed`.
- 2026-02-27: run 控制动作补全：`run.pause` 触发 `task.requires_input` 并标记 `action.applied`；`run.resume`/`run.retry` 触发重新入队派发；新增 `tests/test_run_controls.py` 覆盖。
- 2026-02-27: Added agent skills manifest API + FS layout for skills, with tests for roundtrip and layout.
- 2026-02-27: Added community skills registry + install API, plus team export/import YAML endpoints.
