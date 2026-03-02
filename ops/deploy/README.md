# deploy/

本目录包含 Docker Compose 的部署变体。

目录说明:
- `session-g-ops/deploy/prod/`: 生产部署相关 compose 覆盖
- `session-g-ops/deploy/worker/`: worker 主机部署相关 compose 覆盖
- `session-g-ops/deploy/legacy/`: 历史/兼容配置 (仅在需要时使用)

注意:
 - 路由与边缘代理的部署脚本入口见 `session-g-ops/scripts/`。
 - 变体目录不应改变服务的接口契约, 如需改动先更新 `session-a-docs/specs/` 的契约文档。
