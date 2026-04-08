# 部署指南（Web 私有化最小基线）

本文档描述 Linpo 的最小可部署方案：`api + frontend`，数据库默认 SQLite（持久卷）。

## 1. 前置条件

- Docker 24+
- Docker Compose v2
- 可访问的 OpenClaw 网关地址与 token

## 2. 准备配置

默认可直接使用 `.env.deploy.example` 启动。  
生产建议复制一份独立配置文件：

```bash
cp .env.deploy.example .env.deploy
```

必须修改以下项：

- `LINPO_SECRET_ENCRYPTION_KEY`
- `OPENCLAW_BASE_URL`
- `OPENCLAW_GATEWAY_TOKEN`
- `OPENCLAW_ORIGIN`
- `FLOW_DECOMPOSITION_OPENCLAW_BASE_URL`
- `FLOW_DECOMPOSITION_OPENCLAW_GATEWAY_TOKEN`
- `FLOW_DECOMPOSITION_OPENCLAW_ORIGIN`

可按需修改：

- `FLOW_DECOMPOSITION_AGENT_ID`（必须替换为实例可见 agent_id）
- `VITE_API_BASE_URL`（前端构建时注入）
- `LINPO_DATABASE_URL`（默认 `sqlite:////data/linpo.db`）

## 3. 启动

```bash
docker compose up -d --build
```

访问地址：

- 前端：`http://localhost:4173`
- 后端：`http://localhost:8000`

## 4. 健康检查

```bash
curl -fsS http://localhost:8000/api/v1/health
curl -fsS http://localhost:8000/api/v1/ops/setup
```

## 5. 停止与清理

停止服务（保留数据卷）：

```bash
docker compose down
```

停止并删除数据卷：

```bash
docker compose down -v
```
