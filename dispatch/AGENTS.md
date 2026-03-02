# dispatch

## OVERVIEW
Orchestrates agent dispatch using Redis streams.
Built on FastAPI + Redis; orchestration logic is custom to RoBoard.

## STRUCTURE
```
dispatch/
├── app/              # FastAPI app, Redis consumers
├── tests/            # pytest tests
├── requirements.txt
└── requirements-dev.txt
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Dispatch | dispatch/app/main.py | Stream consumers + internal endpoints |
| Agent FS helper | dispatch/app/agent_fs.py | Identity/state files under data/ |

## CONVENTIONS
- Internal auth uses `X-Internal-Key` (`INTERNAL_API_KEY` supports comma-separated keys).
- Redis streams: `DISPATCH_*` env vars define stream/group behavior.
- 每改完一个服务就立即更新相关的 `AGENTS.md` 并完成该服务测试。

## OWNERSHIP
- Owned paths: `dispatch/**`
- 禁止跨目录修改：默认不修改非 `dispatch/**` 的文件；跨服务契约变更先落到 `docs/specs/`，再由各 owner 分别实现。
- 放弃向后兼容：consumer group/日志 service 字段使用语义名（例如 `dispatch`）。
- 验证要求：至少运行一次 `python -m pytest -q`（见 COMMANDS）。

## ANTI-PATTERNS
- Do not call external APIs without `X-Request-ID` propagation.
- Do not bypass stream retry/dead-letter handling.

## COMMANDS
```bash
cd dispatch
. .venv/bin/activate
python -m pytest -q
```

## NOTES
- Uses JSON logging with trace/tenant/task contextvars.
- Agent identity files live under `data/projects/.../agents/.../identity.json`.
- 2026-02-27: Added skill create consumer for `queue:skill-create`, posts skill.create.* events.
- 2026-02-27: Added skill exec consumer for `queue:skill-exec`, posts skill.execute.* events.
