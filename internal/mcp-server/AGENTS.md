# mcp-server

## OVERVIEW
Simple proxy that forwards search queries to SearXNG; not a full MCP implementation.

## STRUCTURE
```
internal/mcp-server/
├── app/              # FastAPI app
├── tests/            # pytest tests
├── requirements.txt
└── requirements-dev.txt
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Proxy endpoint | internal/mcp-server/app/main.py | `/search` + `/health` |
| Health tests | internal/mcp-server/tests/test_health.py | Minimal smoke test |

## CONVENTIONS
- Internal auth via `X-Internal-Key` (`INTERNAL_API_KEY` required, comma-separated allowed).
- SearXNG base URL via `SEARXNG_URL`.
- JSON logging with `X-Request-ID` middleware.
- 默认通过生产前端 compose 的 `searxng` 服务提供搜索后端（若部署了 searxng）；运行时通过 `SEARXNG_URL` 配置。
- 每改完一个服务就立即更新相关的 `AGENTS.md` 并完成该服务测试。

## OWNERSHIP
- Owned paths: `internal/mcp-server/**`
- 禁止跨目录修改：默认不修改非 `internal/mcp-server/**` 的文件；跨服务契约变更先落到 `docs/specs/`。
- 放弃向后兼容：只维护当前 proxy 形态与 env 约定。
- 验证要求：至少运行一次 `python -m pytest -q`（见 COMMANDS）。

## ANTI-PATTERNS
- Do not expose `/search` without internal auth.
- Do not hardcode SearXNG URL in code.

## COMMANDS
```bash
cd internal/mcp-server
. .venv/bin/activate
python -m pytest -q
```

## NOTES
- Keep interface stable; other services assume `/search` contract.
