# roboard

## OVERVIEW
多服务 RoBoard 仓库总览，覆盖 API、internal 服务、浏览器执行链路、边缘路由与运维脚本。

## STRUCTURE
```
./
├── api/
├── browser/
├── internal/
├── edge-ui/
├── ops/
└── docs/
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| 外部 API 与 WS | `api/app/main.py` | 对外入口与鉴权边界 |
| 浏览器执行链路 | `browser/AGENTS.md` | worker 与 gateway 职责拆分 |
| 内部服务网关 | `internal/AGENTS.md` | llm/search/skill/template 聚合说明 |
| 边缘路由与静态 UI | `edge-ui/AGENTS.md` | `edge` + `gateway` + `web-frontend` |
| 部署与脚本 | `ops/AGENTS.md` | compose 变体与 deploy/push/backup |
| 文档规范与章程 | `docs/AGENTS.md` | 文档入口与治理文档索引 |

## OWNERSHIP
- Lead: @platform

## ANTI-PATTERNS
- ❌ 在 `AGENTS.md` 记录历史流水账/变更日志。
- ❌ 复制 `docs/CONSTITUTION.md` 中已有治理条款。
- ❌ 把 `/internal/*` 对外暴露到公网路由。

## LINKS
- [CONSTITUTION](docs/CONSTITUTION.md)
