# agent-manager

## OVERVIEW
Orchestrates agent dispatch using Redis streams.
Built on FastAPI + Redis; orchestration logic is custom to RoBoard.

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
| Dispatch | agent-manager/app/main.py | Stream consumers + internal endpoints |
| Agent FS helper | agent-manager/app/agent_fs.py | Identity/state files under data/ |

## CONVENTIONS
- Internal auth uses `X-Internal-Key` (`INTERNAL_API_KEY` supports comma-separated keys).
- Redis streams: `DISPATCH_*` env vars define stream/group behavior.
- 每改完一个服务就立即更新相关的 `AGENTS.md` 并完成该服务测试。

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
- 2026-02-27: Added skill create consumer for `queue:skill-create`, posts skill.create.* events.
- 2026-02-27: Added skill exec consumer for `queue:skill-exec`, posts skill.execute.* events.
