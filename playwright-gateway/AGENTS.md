# playwright-gateway

## OVERVIEW
Gateway that runs Playwright jobs by spawning runner containers via Docker API.
Built on FastAPI + Playwright runner images; orchestration logic is RoBoard-specific.

## STRUCTURE
```
playwright-gateway/
├── app/              # FastAPI app
├── tests/            # pytest tests
├── requirements.txt
└── requirements-dev.txt
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Runner orchestration | playwright-gateway/app/main.py | `/run` handler and Docker logic |
| Health tests | playwright-gateway/tests/test_health.py | Minimal smoke test |

## CONVENTIONS
- Internal auth via `X-Internal-Key` against `INTERNAL_API_KEY` (comma-separated allowed).
- Runner image from `PW_RUNNER_IMAGE` env var.
- Per-tenant volumes named `pw_ws_t_{tenant_id}`.
- 每改完一个服务就立即更新相关的 `AGENTS.md` 并完成该服务测试。

## ANTI-PATTERNS
- Do not pull runner images on worker host at runtime; pre-pull in deploy script.
- Do not swallow Docker errors; surface 502 with context.

## COMMANDS
```bash
cd playwright-gateway
. .venv/bin/activate
python -m pytest -q
```

## NOTES
- Parses runner output as JSON lines; last JSON object is the response contract.
