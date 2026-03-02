# worker-playwright

## OVERVIEW
Internal worker API that routes browser jobs to the Playwright gateway or forwards search queries to MCP.
Built on FastAPI + Playwright; worker protocol and routing are RoBoard-specific.

## STRUCTURE
```
browser/worker-playwright/
├── app/              # FastAPI app
├── tests/            # pytest tests
├── requirements.txt
└── requirements-dev.txt
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| API handlers | browser/worker-playwright/app/main.py | `/run` + `/health` |
| Health tests | browser/worker-playwright/tests/test_health.py | Minimal smoke test |

## CONVENTIONS
- Internal auth uses `X-Internal-Key` (`INTERNAL_API_KEY` required, comma-separated allowed).
- Env vars: `MCP_URL`, `PLAYWRIGHT_GATEWAY_URL`, `SERVICE_NAME`.
- Request context uses `X-Request-ID` + contextvars for trace/tenant/task.
- 每改完一个服务就立即更新相关的 `AGENTS.md` 并完成该服务测试。

## OWNERSHIP
- Owned paths: `browser/worker-playwright/**`
- 禁止跨目录修改：默认不修改非 `browser/worker-playwright/**` 的文件；跨服务契约变更先落到 `docs/specs/`。
- 放弃向后兼容：内部调用以当前 service 名与路径为准。
- 验证要求：至少运行一次 `python -m pytest -q`（见 COMMANDS）。

## ANTI-PATTERNS
- Do not allow unauthenticated `/run` calls.
- Do not log raw secrets or internal keys.

## COMMANDS
```bash
cd browser/worker-playwright
. .venv/bin/activate
python -m pytest -q
```

## NOTES
- `/run` accepts either browser jobs or search queries; validate input shape.
