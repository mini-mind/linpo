# Linpo

Linpo 是位于 OpenClaw 与用户之间的人机协作编排交互层。  
当前版本聚焦 Web 私有化部署（PC + 移动浏览器），主工作区为：

- 摘要
- 看板
- 流程编辑
- 文件

## 快速启动（本地）

前置：

- Node.js `20.19.0`
- npm `>=10`
- Python `3.12+`

后端：

```bash
python -m venv .venv
source .venv/bin/activate
cp .env.example .env
set -a; source .env; set +a
pip install -e .
fastapi dev app/main.py
```

前端：

```bash
cd frontend
npm ci
npm run dev
```

默认地址：

- 前端：`http://127.0.0.1:5173`
- 后端：`http://127.0.0.1:8000`

## Docker 私有化部署（推荐）

前置：

- Docker 24+
- Docker Compose v2

启动：

```bash
docker compose up -d --build
```

默认地址：

- 前端：`http://localhost:4173`
- 后端：`http://localhost:8000`

健康检查：

```bash
curl -fsS http://localhost:8000/api/v1/health
curl -i http://localhost:8000/api/v1/ops/setup
```

说明：

- `ops/setup` 未登录返回 `401` 属于正常。
- 默认无需手工配置 `.env.deploy`，直接可启动。
- 启动后可直接在前端“实例”弹窗通过 UI 完成 OpenClaw 绑定（endpoint/token）。

仅在需要覆盖默认值时创建 `.env.deploy`（可参考 `.env.deploy.example`）：

- 常用覆盖项：`OPENCLAW_BASE_URL`、`OPENCLAW_GATEWAY_TOKEN`
- 若容器访问宿主机 OpenClaw：建议 `host.docker.internal`

## 数据库策略

- 默认无需外部数据库：未配置 `LINPO_DATABASE_URL` 时，后端使用 `sqlite:///./linpo.db`。
- 生产如需切换外部数据库，显式设置 `LINPO_DATABASE_URL` 即可。

## 质量命令

```bash
pytest
npm --prefix frontend run test
npm --prefix frontend run build
```

## 核心文档

- 治理规则：[AGENTS.md](AGENTS.md)
- 产品需求：[docs/prd.md](docs/prd.md)
- 架构边界：[docs/architecture.md](docs/architecture.md)
- 测试与联调：[docs/test-resources.md](docs/test-resources.md)

## 开源边界

- 仅支持 Web 端，不包含 Tauri 客户端。
- 不包含支付、会员充值、模板市场等 SaaS 扩展能力。
