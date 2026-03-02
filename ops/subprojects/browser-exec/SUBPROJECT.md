# 子项目: browser-exec

## Scope
浏览器执行链: 对 worker 的执行入口与 Playwright runner 编排。

## Owned Paths
- `worker-playwright/**`
- `playwright-gateway/**`
- `playwright-runner/**`

## Provides
- worker-playwright: `POST /run`
- playwright-gateway: `POST /run`

## Consumes
- mcp-server: `POST /search`

## Local Verification
- `cd worker-playwright && . .venv/bin/activate && python -m pytest -q`
- `cd playwright-gateway && . .venv/bin/activate && python -m pytest -q`

## Notes
- 该子项目的关键是把两套 `/run` 的请求/响应契约写清楚并保持一致。
