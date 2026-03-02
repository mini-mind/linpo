# skill-gateway

## OVERVIEW
Docker sandbox executor gateway for skill creation and execution.
Currently a minimal placeholder that validates internal auth and echoes input.

## STRUCTURE
```
session-e-internal/skill-gateway/
├── app/              # FastAPI app
├── tests/            # pytest tests
├── requirements.txt
└── requirements-dev.txt
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| API handlers | session-e-internal/skill-gateway/app/main.py | `/skills/create` + `/skills/execute` + `/health` |
| Health tests | session-e-internal/skill-gateway/tests/test_health.py | Minimal smoke test |

## CONVENTIONS
- Internal auth uses `X-Internal-Key` (`INTERNAL_API_KEY` required, comma-separated allowed).
- Env vars: `SERVICE_NAME`, `SKILL_RUNNER_IMAGE` (optional, placeholder), `INTERNAL_API_KEY`.
- Request context uses `X-Request-ID` + contextvars for trace/tenant/task.
- 每改完一个服务就立即更新相关的 `AGENTS.md` 并完成该服务测试。

## ANTI-PATTERNS
- Do not allow unauthenticated `/skills/*` calls.
- Do not log raw secrets or internal keys.

## COMMANDS
```bash
cd session-e-internal/skill-gateway
. .venv/bin/activate
python -m pytest -q
```
