# 子项目: api

## Scope
对外 FastAPI HTTP API + WebSocket, 负责租户/会话/任务(run)/事件(event)持久化与对外查询。

## Owned Paths (默认只改这里)
- `api/**`

## Provides
- 外部 API: `/api/**`
- WebSocket: `/ws/**`

## Consumes
- Redis (rate limit + dispatch fallback)
- (可选) dispatch: `POST /internal/dispatch` (当配置 `DISPATCH_URL`)

## Local Verification
- `cd api && . .venv/bin/activate && python -m pytest -q`

## Cross-project Contract
- 接口契约以 `docs/specs/*-api-contract.md` 为准 (由文档总控子项目维护)
