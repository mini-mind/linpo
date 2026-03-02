# llm-gateway

## OVERVIEW
Internal LLM proxy built on LiteLLM that loads provider configs and forwards OpenAI-compatible chat calls.

## STRUCTURE
```
internal/llm-gateway/
├── app/              # FastAPI app
├── tests/            # pytest tests
├── requirements.txt
└── requirements-dev.txt
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Proxy logic | internal/llm-gateway/app/main.py | `/internal/llm/chat`, SSE streaming |
| Provider config | shared/config/llm-providers.example.json | Template only |
| Health tests | internal/llm-gateway/tests/test_health.py | Minimal smoke test |

## CONVENTIONS
- Auth uses `X-Internal-Key`; `INTERNAL_API_KEY` supports comma-separated keys.
- Provider config path via `LLM_PROVIDERS_PATH` (default `/run/secrets/llm-providers.json`).
- Accepts any model name present in providers map.
- 每改完一个服务就立即更新相关的 `AGENTS.md` 并完成该服务测试。

## OWNERSHIP
- Owned paths: `internal/llm-gateway/**`
- 禁止跨目录修改：默认不修改非 `internal/llm-gateway/**` 的文件；跨服务契约变更先落到 `docs/specs/`。
- 放弃向后兼容：只维护当前内部接口路径与认证边界。
- 验证要求：至少运行一次 `python -m pytest -q`（见 COMMANDS）。

## ANTI-PATTERNS
- Never commit real provider keys; use `config/llm-providers.example.json` only.
- Do not read API keys from tenant config or runtime JSON.

## COMMANDS
```bash
cd internal/llm-gateway
. .venv/bin/activate
python -m pytest -q
```

## NOTES
- Streaming responses use SSE; ensure clients handle chunked events.
