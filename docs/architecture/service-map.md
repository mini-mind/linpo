# 服务地图 (多 Session 并行推进)

[← 返回文档中心](../README.md)

本文档给出服务与目录的一一对应关系, 用于多 Session 并行推进时快速定位“谁拥有哪个服务”。

说明:
- “拥有者 Session”指推荐的并行 Session 划分, 不是权限系统。
- 端口映射以 `docker-compose.yml` 为准; 本文只描述逻辑边界。

---

## 服务与目录对应表

| 服务 | 目录 | 主要职责 | 典型入口 | 拥有者 Session |
| --- | --- | --- | --- | --- |
| api-backend | `session-b-api/` | 对外 API + WS, DB 持久化, 事件流 | `session-b-api/app/main.py` | Session B |
| agent-manager | `session-c-dispatch/` | 调度编排, 消费 Redis streams, 内部派发 | `session-c-dispatch/app/main.py` | Session C |
| worker-playwright | `session-d-browser/worker-playwright/` | Worker 入口, 负责调用搜索与浏览器 | `session-d-browser/worker-playwright/app/main.py` | Session D |
| playwright-gateway | `session-d-browser/playwright-gateway/` | Playwright runner 编排 | `session-d-browser/playwright-gateway/app/main.py` | Session D |
| skill-gateway | `session-e-internal/skill-gateway/` | 技能 sandbox 执行网关 | `session-e-internal/skill-gateway/app/main.py` | Session E |
| llm-gateway | `session-e-internal/llm-gateway/` | LLM 内部代理 (仅内部调用) | `session-e-internal/llm-gateway/app/main.py` | Session E |
| mcp-server | `session-e-internal/mcp-server/` | 搜索代理 (SearXNG proxy) | `session-e-internal/mcp-server/app/main.py` | Session E |
| sandbox-template | `session-e-internal/sandbox-template/` | Sandbox 模板生成 | `session-e-internal/sandbox-template/app/main.py` | (待分配, 建议 Session E 或单独) |
| gateway | `session-f-edge-ui/gateway/` | nginx reverse proxy 规则 | `session-f-edge-ui/gateway/nginx.conf` | Session F |
| edge | `session-f-edge-ui/edge/` | edge proxy (Caddy/Nginx) | `session-f-edge-ui/edge/Caddyfile` | Session F |
| web-frontend | `session-f-edge-ui/web-frontend/` | 静态前端 (无 build) | `session-f-edge-ui/web-frontend/index.html` | Session F |

---

## 关键边界 (必须遵守)

1) 内部接口不经 gateway 暴露
- `session-f-edge-ui/gateway/` 不应将 `/internal/*` 路由给外部。

2) 内部鉴权头统一
- 内部服务间调用使用 `X-Internal-Key` (以及需要时的 `X-Tenant-ID`)。

3) 跨服务变更先改契约
- API/WS/schema/header 变更必须先在 `session-a-docs/specs/*` 契约文档体现。

---

## 快速定位

- 外部 API/WS 行为: `session-b-api/app/main.py`, `session-b-api/app/tree_api.py`
- 调度/消费队列: `session-c-dispatch/app/main.py`
- 前端调用与 UI 显示: `session-f-edge-ui/web-frontend/app.js`, `session-f-edge-ui/web-frontend/index.html`
