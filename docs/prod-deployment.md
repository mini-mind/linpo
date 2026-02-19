# 生产环境部署指南 (Split Deployment)

**目标**: 让 `https://roboard.duckdns.org/` 的前端（ravin）与后端/worker（ubuntu@175.178.213.10）分离部署，并通过固定 TAG 从阿里云 ACR 拉取镜像。

## 当前运行位置 (务必先确认)

本仓库存在两种部署形态：

1) **单机全量部署 (single-host)**
   - 特征：同一台机器同时运行 edge/gateway/web-frontend/api-backend/agent-manager/postgres/redis/... 等。
   - Compose：项目根 `docker-compose.yml`（本地构建镜像）或 `deploy/legacy/docker-compose.single-host.yml`（ACR 镜像）。
   - 适用：只有 1 台服务器时；或需要最快恢复时。

2) **双机拆分部署 (split deployment)**
   - 特征：frontend host 运行 edge/gateway/web-frontend/searxng；worker host 运行 api-backend/agent-manager/worker-playwright/...。
   - Compose：`deploy/prod/docker-compose.frontend.yml`（frontend）；worker 侧以 `docs/worker-deployment.md` / 实际运维 SOP 为准。
   - 适用：前后端分离、worker 资源隔离。

如果你不确定当前线上属于哪种形态，先在目标机器执行：

```bash
docker ps --format "{{.Names}}\t{{.Image}}\t{{.Ports}}"
```

看到同时存在 `edge` 与 `api-backend`（以及 postgres/redis）通常意味着 single-host；只看到 edge/gateway/web-frontend 通常意味着 split。

**相关文档**:
- `docs/worker-deployment.md`
- `docs/worker-ops.md`

---

## 目录

- 前置条件
- 镜像与 TAG 策略
- 部署：frontend host (ravin)
- 部署：worker host (ubuntu@175.178.213.10)
- 验证清单
- Legacy

## 前置条件

- 两台机器均已完成：`docker login registry.cn-hangzhou.aliyuncs.com`
- 使用环境变量或 `.env` 管理敏感信息（不要提交到 git）

## 镜像与 TAG 策略

- ACR: `registry.cn-hangzhou.aliyuncs.com/<namespace>/...`
- 推荐 TAG: `YYYY-MM-DD-<git-short-sha>`（可追溯、可回滚）

## 部署：frontend host (ravin)

frontend host 负责：edge(Caddy) + gateway + web-frontend + searxng。

在 ravin 上：

```bash
export ROBOARD_ROOT="/home/ravin/roboard-root"
export TAG="<your-tag>"

cd "$ROBOARD_ROOT"
docker compose -f deploy/prod/docker-compose.frontend.yml pull
docker compose -f deploy/prod/docker-compose.frontend.yml up -d
docker compose -f deploy/prod/docker-compose.frontend.yml ps
```

## 部署：worker host (ubuntu@175.178.213.10)

worker host 负责：api-backend/agent-manager/worker-playwright/mcp-server/postgres/redis/llm-gateway 等核心后端组件，以及与 ravin 的隧道桥接。

此部分以实际运维 SOP 为准（不同部署可能存在差异）：
- 若使用 docker compose：在 worker 上 `docker compose pull && docker compose up -d`
- 确保 `/api/*` 与 `/ws/*` 的隧道链路健康

## 验证清单

从任意能访问公网的机器执行：

```bash
curl -fsS https://roboard.duckdns.org/api/health
curl -fsS https://roboard.duckdns.org/ >/dev/null
```

浏览器人工验收：
- 未登录显示登录/注册
- 注册/登录后可创建 run 并连接 WS（不需要填写 API key）
- Logout 正常清理会话

## Legacy

单机全量部署（历史版本）已移至：
- Compose: `deploy/legacy/docker-compose.single-host.yml`
- Doc: `docs/legacy/prod-deployment-single-host.md`
