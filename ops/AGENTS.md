# ops

## OVERVIEW
运维与部署层，维护 compose 变体、发布脚本、镜像推送和备份恢复流程。

## STRUCTURE
```
ops/
├── deploy/
└── scripts/
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| 前端主机 compose | `ops/deploy/prod/docker-compose.frontend.yml` | edge/gateway/web/searxng |
| worker 主机 compose | `ops/deploy/worker/docker-compose.yml` | playwright-gateway 与 socket proxy |
| 本地部署脚本 | `ops/scripts/deploy_local.sh` | 本地核心服务快速部署 |
| 发布脚本 | `ops/scripts/push_*_images.sh` | 镜像打标与推送 |
| 备份恢复 | `ops/scripts/pg_backup.sh` | PostgreSQL 备份入口 |

## OWNERSHIP
- Lead: @platform

## ANTI-PATTERNS
- ❌ 未确认目标库即执行 `pg_restore.sh`。
- ❌ 生产流程中使用脏工作区镜像标签。
- ❌ 暴露本应内网的服务端口到公网。

## LINKS
- [CONSTITUTION](../docs/CONSTITUTION.md)

## NOTES
- 2026-03-03: `ops/scripts/e2e.sh` 的 WS 校验已切换到 run 视角入口，避免依赖已下线的旧 task 视角 WS。
