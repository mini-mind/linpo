# searxng

## OVERVIEW

SearXNG 搜索引擎服务，部署在 ravin (68.64.179.125)，为 `internal/mcp-server` 提供搜索后端。

**部署位置**: ravin (美国) - 可直接访问所有国际搜索引擎

## STRUCTURE

```
internal/searxng/
├── AGENTS.md
├── .env.example
├── config/
│   ├── limiter.toml
│   └── settings.yml
└── README.md
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Prod deployment | `ops/deploy/prod/docker-compose.frontend.yml` | searxng 服务配置 |
| Config | `internal/searxng/config/settings.yml` | 搜索引擎设置 |

## CONVENTIONS

- `.env` 不可提交，只维护 `.env.example`
- 生产部署通过 `SEARXNG_ENV_FILE` 指定 env 文件
- `SEARXNG_SECRET_KEY` 必须在运行时提供

## ANTI-PATTERNS

- ❌ 不要把 SearXNG 端口暴露到公网
- ❌ 不要提交 `.env` 或密钥
- ❌ 不要在本地环境默认启用 searxng

## NOTES

- `internal/mcp-server` 通过 `SEARXNG_URL` 访问 searxng
- ravin 位于美国，可直接访问 google、duckduckgo、bing 等所有引擎
- 本地开发如需测试，设置 `SEARXNG_URL=http://68.64.179.125:8081`
