# edge-ui

## OVERVIEW
边缘入口与前端展示层，负责公网 HTTPS 接入、路由转发和静态页面服务。

## STRUCTURE
```
edge-ui/
├── edge/
├── gateway/
└── web-frontend/
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| HTTPS 与入口路由 | `edge-ui/edge/Caddyfile` | 域名、TLS、上游转发 |
| 网关规则 | `edge-ui/gateway/nginx.conf` | `/`、`/api/`、`/ws/` 映射 |
| 网关模板 | `edge-ui/gateway/default.conf.template` | `API_BACKEND_URL` 注入 |
| 前端页面 | `edge-ui/web-frontend/index.html` | 主界面结构 |
| 前端逻辑 | `edge-ui/web-frontend/app.js` | API 调用与 WS 连接 |

## OWNERSHIP
- Lead: @platform

## ANTI-PATTERNS
- ❌ 代理或暴露 `/internal/*` 到公网路径。
- ❌ 在前端硬编码内部服务地址。
- ❌ 在 edge/gateway 混入业务鉴权逻辑。

## LINKS
- [CONSTITUTION](../docs/CONSTITUTION.md)

## NOTES
- 2026-03-03: 前端已移除 team export/import 相关 UI 逻辑；模板使用与招募流程改为直接调用 run 作用域 API 并跳转任务树页。
