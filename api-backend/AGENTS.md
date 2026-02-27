# api-backend

## OVERVIEW
FastAPI service providing external API, internal admin endpoints, and WebSocket event streams.

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
