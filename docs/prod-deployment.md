# 生产环境部署指南 (Split Deployment)

**目标**: 让 `https://roboard.duckdns.org/` 的前端（ravin，`68.64.179.125`）与后端/worker（ubuntu@175.178.213.10）分离部署，并通过固定 TAG 从阿里云 ACR 拉取镜像。

## 当前运行位置 (务必先确认)

本仓库存在两种部署形态。当前常见资源形态是：

- 本机（开发）
- `ravin`（frontend host，`68.64.179.125`，跑 edge/gateway/web-frontend/searxng）
- `ubuntu@175.178.213.10`（worker host，跑后端/worker）

1) **双机拆分部署 (split deployment)**
   - 特征：frontend host 运行 edge/gateway/web-frontend/searxng；worker host 运行 api/dispatch/worker-playwright/...。
   - Compose：`ops/deploy/prod/docker-compose.frontend.yml`（frontend）；worker 侧以 `docs/worker-deployment.md` / 实际运维 SOP 为准。
   - 适用：前后端分离、worker 资源隔离。

备注：如果你只有一台生产机（例如只有 ravin），则 split deployment 的 "worker host" 可能与 frontend host 是同一台机器；这种情况下按实际 compose 落地为准。

如果你不确定当前线上属于哪种形态，先在目标机器执行：

```bash
docker ps --format "{{.Names}}\t{{.Image}}\t{{.Ports}}"
```

看到同时存在 `edge` 与 `api`（以及 postgres/redis）通常意味着 single-host；只看到 edge/gateway/web-frontend 通常意味着 split。

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

## 部署：frontend host (ravin, 68.64.179.125)

frontend host 负责：edge(Caddy) + gateway + web-frontend + **searxng**。

**SearXNG 部署说明**：
- **位置**：ravin (68.64.179.125) - 美国服务器
- **网络优势**：可直接访问 google、duckduckgo、bing、brave 等所有国际搜索引擎
- **配置**：使用 `use_default_settings: true`，启用所有默认引擎
- **访问地址**：`http://127.0.0.1:8081/`（仅 ravin 本地）
- **后端调用**：mcp-server 通过 `SEARXNG_URL` 环境变量访问

在 ravin 上：

frontend host 负责：edge(Caddy) + gateway + web-frontend + searxng。

在 ravin 上：

```bash
export ROBOARD_ROOT="/home/ravin/roboard-root"
export TAG="<your-tag>"
export API_BACKEND_URL="http://175.178.213.10:8000"

cd "$ROBOARD_ROOT"
docker compose -f ops/deploy/prod/docker-compose.frontend.yml pull
docker compose -f ops/deploy/prod/docker-compose.frontend.yml up -d
docker compose -f ops/deploy/prod/docker-compose.frontend.yml ps
```

## 部署：worker host (ubuntu@175.178.213.10)

worker host 负责：api/dispatch/worker-playwright/mcp-server/postgres/redis/llm-gateway 等核心后端组件，以及与 ravin 的隧道桥接。

此部分以实际运维 SOP 为准（不同部署可能存在差异）：
- 若使用 docker compose：在 worker 上 `docker compose pull && docker compose up -d`
- 确保 `/api/*` 与 `/ws/*` 的隧道链路健康

## 验证清单

从任意能访问公网的机器执行：

```bash
curl -fsS https://roboard.duckdns.org/api/health
curl -fsS https://roboard.duckdns.org/ >/dev/null

# 验证 SearXNG（SSH 登录 ravin）
ssh ravin "curl -s 'http://127.0.0.1:8081/search?q=test&format=json'"
# 期望输出：Results: N | Engines OK: 0

端口固定约定（split 部署）：
- 前端 host：80/443 由 edge 占用；gateway 仅本机 127.0.0.1:8082
- worker host：api 对外 `0.0.0.0:8000->8000`，必须可被前端 host 访问
```

从任意能访问公网的机器执行：

```bash
curl -fsS https://roboard.duckdns.org/api/health
curl -fsS https://roboard.duckdns.org/ >/dev/null

端口固定约定（split 部署）：
- 前端 host：80/443 由 edge 占用；gateway 仅本机 127.0.0.1:8082
- worker host：api 对外 `0.0.0.0:8000->8000`，必须可被前端 host 访问
```

浏览器人工验收：
- 未登录显示登录/注册
- 注册/登录后可创建 run 并连接 WS（不需要填写 API key）
- Logout 正常清理会话
