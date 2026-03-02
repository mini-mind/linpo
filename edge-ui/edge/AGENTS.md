# edge

## OVERVIEW
`edge` 是公网入口（Caddy 反向代理 + HTTPS），负责把外部请求转发到 `gateway`，并保持路由边界清晰。

## STRUCTURE
```
edge-ui/edge/
├── AGENTS.md
├── Caddyfile
└── nginx.conf
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| HTTPS entry + reverse proxy | edge-ui/edge/Caddyfile | 域名、TLS、上游转发规则 |
| Edge config reference | edge-ui/edge/nginx.conf | 辅助配置参考（以 Caddyfile 为准） |

## CONVENTIONS
- `edge` 只做入口与转发，不承载业务逻辑。
- 路由契约以 `gateway` 为准：`/` (UI), `/api/` (HTTP), `/ws/` (WebSocket)。
- 安全边界：不得对外暴露 `/internal/*`。

## OWNERSHIP
- Owned paths: `edge-ui/edge/**`
- 禁止跨目录修改：默认不修改非 `edge-ui/edge/**` 的文件；如需调整对外路由契约先更新 `docs/specs/`，再由对应 owner 在各自目录实现。
- 验证要求：
  - `TAG=dev ADMIN_API_KEY=dev INTERNAL_API_KEY=dev SEARXNG_SECRET_KEY=dev docker compose config -q`
  - `ROBOARD_ROOT=/abs/path/to/roboard TAG=dev docker compose -f ops/deploy/prod/docker-compose.frontend.yml config -q`
- 手动冒烟（部署环境）：
  - `https://<domain>/` 可访问 UI
  - `https://<domain>/api/health` 可返回 200
  - `wss://<domain>/ws/...` 可建立连接（至少握手成功）

## ANTI-PATTERNS
- Do not route `/internal/*` through edge.
- 不要在 edge 中引入任何鉴权/业务逻辑（应在 `api` 或 `gateway` 层完成）。

## NOTES
- `edge` 与 `gateway` 的拆分部署边界见 `docs/prod-deployment.md`。
