# scripts/

本目录包含部署、推送、备份与验证脚本。

原则:
- 脚本尽量保持幂等。
- 生产相关操作需要显式 TAG (禁止 dirty/latest)。

## 常用脚本

部署:
- `ops/scripts/deploy_local.sh`: 本地/单机快速部署核心服务
- `ops/scripts/deploy_worker_host.sh`: 部署后端重服务 (本地构建镜像)
- `ops/scripts/deploy_ravin_frontend.sh`: 在 ravin 部署 gateway/web-frontend
- `ops/scripts/deploy_worker.sh`: 在 worker 主机部署服务

推送镜像:
- `ops/scripts/push_core_images.sh`: 推送 core 镜像到 ACR
- `ops/scripts/push_worker_images.sh`: 推送 worker 镜像到 ACR
- `ops/scripts/push_frontend_images.sh`: 推送前端相关镜像到 ACR

数据库备份:
- `ops/scripts/pg_backup.sh`
- `ops/scripts/pg_restore.sh`

验证:
- `ops/scripts/e2e.sh`: 端到端验证入口
- `ops/scripts/verify_no_*.sh`: 快速检查历史遗留关键字/引用

子项目导出 (polyrepo 预备):
- `ops/scripts/polyrepo_export.py`: 从 monorepo 导出子项目树到 `dist/polyrepo/`
- `ops/scripts/polyrepo_split_subtree.py`: 使用 `git subtree split` 生成带历史的独立 repo 到 `dist/polyrepo-repos/`
  - 依赖: git 2.x (内置 subtree)
- `ops/scripts/polyrepo_bootstrap_root.py`: 使用 split repos 生成本地 `dist/roboard-root` 编排仓 (submodules)
