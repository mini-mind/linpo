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
cp .env.example .env
/data/projects/linpo/.venv/bin/pip install -e .
/data/projects/linpo/.venv/bin/fastapi dev app/main.py
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

## Docker 私有化部署

最小可部署基线见：[DEPLOY.md](DEPLOY.md)  
包含 `docker-compose.yml + Dockerfile`，默认使用 SQLite 持久卷。

## 数据库策略

- 默认无需外部数据库：未配置 `LINPO_DATABASE_URL` 时，后端使用 `sqlite:///./linpo.db`。
- 生产如需切换外部数据库，显式设置 `LINPO_DATABASE_URL` 即可。

## 质量命令

```bash
/data/projects/linpo/.venv/bin/pytest
npm --prefix frontend run test
npm --prefix frontend run build
```

## 核心文档

- 治理规则：[AGENTS.md](AGENTS.md)
- 产品需求：[docs/prd.md](docs/prd.md)
- 架构边界：[docs/architecture.md](docs/architecture.md)
- 测试与联调：[docs/test-resources.md](docs/test-resources.md)
- 部署说明：[DEPLOY.md](DEPLOY.md)

## 开源边界

- 仅支持 Web 端，不包含 Tauri 客户端。
- 不包含支付、会员充值、模板市场等 SaaS 扩展能力。
