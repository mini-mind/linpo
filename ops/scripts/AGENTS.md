# scripts

## OVERVIEW
Operational scripts for deploy/push/backup/verification workflows.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Local deploy | ops/scripts/deploy_local.sh | Core services via compose |
| Split deploy | ops/scripts/deploy_worker_host.sh | Backend-heavy services |
| Worker deploy | ops/scripts/deploy_worker.sh | SSH + scp to worker host |
| Frontend deploy | ops/scripts/deploy_ravin_frontend.sh | SSH to frontend host |
| Push images | ops/scripts/push_*_images.sh | ACR push helpers |
| DB backup | ops/scripts/pg_backup.sh | docker compose exec |
| DB restore | ops/scripts/pg_restore.sh | destructive restore w/ confirmation |
| Validation | ops/scripts/e2e.sh | e2e checks |

## CONVENTIONS
- Bash scripts use `set -euo pipefail` and `DRY_RUN` flags.
- Tag format: `YYYYMMDD-<git-short-sha>` (core push adds `-dirty` if dirty).
- `deploy_worker.sh` requires `INTERNAL_API_KEY` and pre-pulls runner images.
- 每次完成版本更新（TAG/镜像）必须完成测试、commit、部署。
- 尽可能用中文与写文档，除非用户明确要求使用其他语言。

## OWNERSHIP
- Owned paths: `ops/scripts/**`
- 禁止跨目录修改：默认不修改非 `ops/scripts/**` 的文件；脚本依赖的接口/路径变更先更新 `docs/specs/`。
- 放弃向后兼容：脚本中的目录/服务名示例以当前语义名为准。
- 验证要求：修改脚本后至少运行一次相关脚本的 `DRY_RUN=1` 预览，并运行 `docker compose config -q`。

## ANTI-PATTERNS
- Do not run `pg_restore.sh` without confirming target DB and backups.
- Do not push images with uncommitted changes unless explicitly intended.

## NOTES
- `deploy_ravin_frontend.sh` defaults to SSH host/user values; set env vars to override.
