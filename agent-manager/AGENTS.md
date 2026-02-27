# agent-manager

## OVERVIEW
Orchestrates agent dispatch and A2A messaging using Redis streams.

## STRUCTURE
```
agent-manager/
├── app/              # FastAPI app, Redis consumers
├── tests/            # pytest tests
├── requirements.txt
└── requirements-dev.txt
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Dispatch + A2A | agent-manager/app/main.py | Stream consumers + internal endpoints |
| Agent FS helper | agent-manager/app/agent_fs.py | Identity/state files under data/ |

## CONVENTIONS
- Internal auth uses `X-Internal-Key` (`INTERNAL_API_KEY` supports comma-separated keys).
- Redis streams: `DISPATCH_*` and `A2A_*` env vars define stream/group behavior.

## ANTI-PATTERNS
- Do not call external APIs without `X-Request-ID` propagation.
- Do not bypass stream retry/dead-letter handling.

## COMMANDS
```bash
cd agent-manager
. .venv/bin/activate
python -m pytest -q
```

## NOTES
- Uses JSON logging with trace/tenant/task contextvars.
- Agent identity files live under `data/projects/.../agents/.../identity.json`.
