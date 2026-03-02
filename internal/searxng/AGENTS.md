# searxng

## OVERVIEW
SearXNG 搜索引擎服务，仅在生产前端 compose（`ops/deploy/prod/docker-compose.frontend.yml`）中启用，用作 `internal/mcp-server` 的搜索后端。

## STRUCTURE
```
internal/searxng/
├── AGENTS.md
├── .env.example
├── docker-compose.yml
├── compose
├── README.md
├── config/
│   ├── limiter.toml
│   └── settings.yml
└── .docker/
    └── cli-plugins/
        └── docker-compose
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Prod enablement | ops/deploy/prod/docker-compose.frontend.yml | `searxng` 服务与端口绑定 |
| Local compose | internal/searxng/docker-compose.yml | 本地调试/自测用 |
| Config | internal/searxng/config/settings.yml | 搜索引擎设置 |

## CONVENTIONS
- `.env` 不可提交（包含敏感信息），只维护 `.env.example` 作为模板。
- 生产前端 compose 通过 `SEARXNG_ENV_FILE` 指定 env 文件；默认使用 `${ROBOARD_ROOT:?set}/internal/searxng/.env.example` 作为兜底。
- `SEARXNG_SECRET_KEY` 必须在运行时提供（环境变量或 env 文件），并与 settings 保持一致。

## OWNERSHIP
- Owned paths: `internal/searxng/**`
- 禁止跨目录修改：默认不修改非 `internal/searxng/**` 的文件；跨服务契约/路由变更先落到 `docs/specs/`。
- 验证要求：
  - `ROBOARD_ROOT=/abs/path/to/roboard TAG=dev docker compose -f ops/deploy/prod/docker-compose.frontend.yml config -q`

## ANTI-PATTERNS
- 不要把 SearXNG 端口暴露到公网（生产文件默认绑定 127.0.0.1）。
- 不要提交 `.env` 或任何密钥。
- 不要在非生产前端 compose 中默认启用 `searxng`（除非明确需要）。

## NOTES
- `internal/mcp-server` 通过 `SEARXNG_URL` 访问 searxng（具体值由部署形态决定）。
