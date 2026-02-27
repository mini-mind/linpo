# worker-playwright

## OVERVIEW
Internal worker API that routes browser jobs to the Playwright gateway or forwards search queries to MCP.
Built on FastAPI + Playwright; worker protocol and routing are RoBoard-specific.

## STRUCTURE
```
worker-playwright/
├── app/              # FastAPI app
├── tests/            # pytest tests
├── requirements.txt
└── requirements-dev.txt
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| API handlers | worker-playwright/app/main.py | `/run` + `/health` |
| Health tests | worker-playwright/tests/test_health.py | Minimal smoke test |

## CONVENTIONS
- Internal auth uses `X-Internal-Key` (`INTERNAL_API_KEY` required, comma-separated allowed).
- Env vars: `MCP_URL`, `PLAYWRIGHT_GATEWAY_URL`, `SERVICE_NAME`.
- Request context uses `X-Request-ID` + contextvars for trace/tenant/task.
- 每改完一个服务就立即更新相关的 `AGENTS.md` 并完成该服务测试。

## ANTI-PATTERNS
- Do not allow unauthenticated `/run` calls.
- Do not log raw secrets or internal keys.

## COMMANDS
```bash
cd worker-playwright
. .venv/bin/activate
python -m pytest -q
```

## NOTES
- `/run` accepts either browser jobs or search queries; validate input shape.
