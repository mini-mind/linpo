# 仓库目录结构 (面向多子项目并行)

[← 返回文档中心](../README.md)

本文档描述当前 RoBoard 的“物理目录结构”与“多子项目并行推进的逻辑分区”。

原则:
- 通过目录所有权 + 契约同步实现低耦合并行。
- 任何跨服务耦合的改变, 先落地到接口契约文档, 再由各 owner 在各自目录实现。

---

## 物理目录结构 (当前)

核心服务目录 (FastAPI):
- `api/`: 对外 HTTP API + WebSocket
- `dispatch/`: 调度编排 (Redis streams 消费, /internal/dispatch)
- `browser/worker-playwright/`: Worker API (调用浏览器与搜索)
- `browser/playwright-gateway/`: Playwright runner 编排
- `internal/skill-gateway/`: 技能沙箱执行网关
- `internal/llm-gateway/`: LLM 内部代理 (仅 /internal)
- `internal/mcp-server/`: SearXNG proxy (/search)
- `internal/sandbox-template/`: Sandbox template generator

入口与前端:
- `edge-ui/gateway/`: nginx reverse proxy 规则 (对外路径整形)
- `edge-ui/edge/`: edge proxy (Caddy/Nginx)
- `edge-ui/web-frontend/`: 静态前端 (无 build)

配置/运行时/内容:
- `shared/config/`: YAML/JSON 模板与静态配置
- `shared/prompts/`: 提示词/模板
- `shared/sops/`: SOP 模板 (当前实现仍存在)
- `shared/community_skills/`: 社区技能目录
- `internal/searxng/`: 搜索相关
- `shared/redis/`: redis 配置

部署与运维:
- `ops/deploy/`: compose 变体 (prod/worker)
- `ops/scripts/`: 部署/推送/备份/验证脚本
- `shared/observability/`: Prometheus 配置等

本地/运行时产物 (通常 gitignore, 但目录可能存在):
- `data/`, `backups/`, `screenshots/`, `.worktrees/`, `.pytest_cache/`

---

## 多子项目并行的逻辑分区 (推荐)

按“目录所有权”划分, 每个 owner 默认只修改自己的目录, 避免并行冲突:

- docs: `docs/**`
- api: `api/**`
- dispatch: `dispatch/**`
- browser: `browser/**`
- internal: `internal/**`
- edge-ui: `edge-ui/**`
- ops: `ops/**`, `shared/observability/**`

详细协作规则见:
- `docs/process/multi-session-ownership.md`

---

## “看起来杂乱”的处理策略 (不破坏路径)

1) 通过文档索引让路径“可读”
- 在 `docs/architecture/` 维护目录/服务的索引与边界说明。

2) 将跨域变更收敛成“契约变更”
- 任何跨服务 API/WS/header/schema 变化, 先改契约, 再实现。

3) 本地运行时产物不要求搬迁
- `data/`/`backups/`/`screenshots/` 等目录保留, 但应在文档明确其用途与是否可安全删除。
