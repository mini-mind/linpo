# mcp-server

## OVERVIEW
Simple proxy that forwards search queries to SearXNG; not a full MCP implementation.

## STRUCTURE
```
session-e-internal/mcp-server/
├── app/              # FastAPI app
├── tests/            # pytest tests
├── requirements.txt
└── requirements-dev.txt
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Proxy endpoint | session-e-internal/mcp-server/app/main.py | `/search` + `/health` |
| Health tests | session-e-internal/mcp-server/tests/test_health.py | Minimal smoke test |

## CONVENTIONS
- Internal auth via `X-Internal-Key` (`INTERNAL_API_KEY` required, comma-separated allowed).
- SearXNG base URL via `SEARXNG_URL`.
- JSON logging with `X-Request-ID` middleware.
- 默认通过 `docker-compose.yml` 的 `searxng` 服务提供搜索后端。
- 每改完一个服务就立即更新相关的 `AGENTS.md` 并完成该服务测试。

## ANTI-PATTERNS
- Do not expose `/search` without internal auth.
- Do not hardcode SearXNG URL in code.

## COMMANDS
```bash
cd session-e-internal/mcp-server
. .venv/bin/activate
python -m pytest -q
```

## NOTES
- Keep interface stable; other services assume `/search` contract.
