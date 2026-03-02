# deploy/

本目录包含 Docker Compose 的部署变体。

目录说明:
- `ops/deploy/prod/`: 生产部署相关 compose 覆盖
- `ops/deploy/worker/`: worker 主机部署相关 compose 覆盖


注意:
 - 路由与边缘代理的部署脚本入口见 `ops/scripts/`。
 - 变体目录不应改变服务的接口契约, 如需改动先更新 `docs/specs/` 的契约文档。
