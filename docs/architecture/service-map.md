# 服务地图 (多子项目并行推进)

[← 返回文档中心](../README.md)

本文档给出服务与目录的一一对应关系, 用于多子项目并行推进时快速定位"谁拥有哪个服务"。

说明:
- "拥有者"指推荐的 owner/子项目划分, 不是权限系统。
- 端口映射以 `docker-compose.yml` 为准; 本文只描述逻辑边界。

---

## 服务与目录对应表

| 服务 | 目录 | 主要职责 | 典型入口 | Owned By |
| --- | --- | --- | --- | --- |
| api | `api/` | 对外 API + WS, DB 持久化, 事件流 | `api/app/main.py` | api |
| dispatch | `dispatch/` | 调度编排, 消费 Redis streams, 内部派发 | `dispatch/app/main.py` | dispatch |
| worker-playwright | `browser/worker-playwright/` | Worker 入口, 负责调用搜索与浏览器 | `browser/worker-playwright/app/main.py` | browser |
| playwright-gateway | `browser/playwright-gateway/` | Playwright runner 编排 | `browser/playwright-gateway/app/main.py` | browser |
| skill-gateway | `internal/skill-gateway/` | 技能 sandbox 执行网关 | `internal/skill-gateway/app/main.py` | internal |
| llm-gateway | `internal/llm-gateway/` | LLM 内部代理 (仅内部调用) | `internal/llm-gateway/app/main.py` | internal |
| mcp-server | `internal/mcp-server/` | 搜索代理 (SearXNG proxy) | `internal/mcp-server/app/main.py` | internal |
| sandbox-template | `internal/sandbox-template/` | Sandbox 模板生成 | `internal/sandbox-template/app/main.py` | internal |
| gateway | `edge-ui/gateway/` | nginx reverse proxy 规则 | `edge-ui/gateway/nginx.conf` | edge-ui |
| edge | `edge-ui/edge/` | edge proxy (Caddy/Nginx) | `edge-ui/edge/Caddyfile` | edge-ui |
| web-frontend | `edge-ui/web-frontend/` | 静态前端 (无 build) | `edge-ui/web-frontend/index.html` | edge-ui |

---

## 预制 Agent 与服务集成

预制 Agent 是预配置的专家 Agent 模板，可直接对接内部服务：

| Agent | 对接服务 | 端点 | 用途 |
|-------|----------|------|------|
| searcher | mcp-server | `POST /search` | 网络搜索 (SearXNG) |
| browser | worker-playwright | `POST /run` | 浏览器自动化 |
| analyzer | llm-gateway | `POST /internal/llm/chat` | 深度分析 |

### Searcher Agent 架构

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Lead      │────▶│  Searcher   │────▶│  mcp-server │
│   Agent     │     │   Agent     │     │  (searxng)  │
└─────────────┘     └─────────────┘     └─────────────┘
                          │
                   X-Internal-Key
                   POST /search
```

预制模板存储: `shared/agent-templates/*.yaml`
规格文档: `docs/specs/2026-03-02-agent-template-library.md`

---

## 关键边界 (必须遵守)

1) 内部接口不经 gateway 暴露
- `edge-ui/gateway/` 不应将 `/internal/*` 路由给外部。

2) 内部鉴权头统一
- 内部服务间调用使用 `X-Internal-Key` (以及需要时的 `X-Tenant-ID`)。

3) 跨服务变更先改契约
- API/WS/schema/header 变更必须先在 `docs/specs/*` 契约文档体现。

---

## 快速定位

- 外部 API/WS 行为: `api/app/main.py`, `api/app/tree_api.py`
- 调度/消费队列: `dispatch/app/main.py`
- 前端调用与 UI 显示: `edge-ui/web-frontend/app.js`, `edge-ui/web-frontend/index.html`
- 预制 Agent 模板: `shared/agent-templates/*.yaml`
- Agent 实例化: `api/app/agent_hiring.py`