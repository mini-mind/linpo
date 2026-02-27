# scripts

## OVERVIEW
Operational scripts for deploy/push/backup/verification workflows.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Local deploy | scripts/deploy_local.sh | Core services via compose |
| Split deploy | scripts/deploy_worker_host.sh | Backend-heavy services |
| Worker deploy | scripts/deploy_worker.sh | SSH + scp to worker host |
| Frontend deploy | scripts/deploy_ravin_frontend.sh | SSH to frontend host |
| Push images | scripts/push_*_images.sh | ACR push helpers |
| DB backup | scripts/pg_backup.sh | docker compose exec |
| DB restore | scripts/pg_restore.sh | destructive restore w/ confirmation |
| Validation | scripts/e2e.sh / scripts/verify_sse_streaming.py | e2e + SSE checks |

## CONVENTIONS
- Bash scripts use `set -euo pipefail` and `DRY_RUN` flags.
- Tag format: `YYYYMMDD-<git-short-sha>` (core push adds `-dirty` if dirty).
- `deploy_worker.sh` requires `INTERNAL_API_KEY` and pre-pulls runner images.
- 每次完成版本更新（TAG/镜像）必须完成测试、commit、部署。
- 尽可能用中文与写文档，除非用户明确要求使用其他语言。

## ANTI-PATTERNS
- Do not run `pg_restore.sh` without confirming target DB and backups.
- Do not push images with uncommitted changes unless explicitly intended.

## NOTES
- `deploy_ravin_frontend.sh` defaults to SSH host/user values; set env vars to override.
