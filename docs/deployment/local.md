# 本地 Docker 部署指南

本指南帮助操作员通过 Docker Compose 在本地部署变更以进行验证。

## 前置条件

部署前，请确保：
- 已安装 Docker 和 Docker Compose（`docker compose version` 或 `docker-compose version`）
- Docker 守护进程正在运行
- 具有网络连接（如果从远程仓库构建镜像）
- 访问 `.env` 文件（包含必需的密钥）

## 核心服务

默认部署目标（支持 `roboard.duckdns.org` 的服务）：
- `edge` - Caddy 反向代理（端口 80/443）
- `gateway` - 内部 Nginx 网关（容器内监听 80；仅 compose 网络内访问）
- `web-frontend` - 静态文件服务
- `api-backend` - FastAPI 后端（容器内 8000；本地默认绑定 `127.0.0.1:8005->8000` 供调试）
- `agent-manager` - 任务调度器（端口 7000）
- `llm-gateway` - LLM 提供商多路复用（端口 7300）
- `mcp-server` - MCP 协议服务

可选/辅助服务（按需单独部署）：
- `postgres` - PostgreSQL 数据库
- `redis` - Redis 缓存和消息代理
- `mailhog` - 邮件测试（开发环境，端口 8025；本仓库 `docker-compose.yml` 提供该服务，但脚本默认不启动）
- `searxng` - 搜索引擎（端口 8081；在 `deploy/prod/docker-compose.frontend.yml` / legacy compose 中提供。若本地不跑该服务，可通过 `SEARXNG_URL` 让 `mcp-server` 指向一个外部 SearXNG 实例）

## 端口映射清单（固定约定）

本地单机部署默认端口：

| 服务 | 容器端口 | 宿主机端口 | 说明 |
| --- | --- | --- | --- |
| edge | 80/443 | 80/443 | 统一公网入口（可能与本机其他服务冲突） |
| gateway | 80 | 127.0.0.1:8082 | 本机调试入口（前端 host 上使用） |
| api-backend | 8000 | 127.0.0.1:8005 | 本机调试入口 |
| api-backend | 8000 | 0.0.0.0:8000 | split 部署 worker 对外入口 |
| searxng | 8080 | 127.0.0.1:8081 | 仅本机访问 |
| playwright-gateway | 7200 | 7200 | worker 对外入口（限制来源 IP） |

> 提示：如果只做本地验证，不要暴露 0.0.0.0:8000；split 部署时必须开放 8000 给前端 host。

## 端口冲突与规避

- 若 80/443 被占用：先停止旧 edge/nginx/caddy 服务，或改用 split 部署（前端 host 持有 80/443）。
- 若 8000 被占用：停止旧的 api-backend / 反向代理进程，避免网关连错服务。
- 若 8082/8081 被占用：仅影响本机调试，不影响公网入口。

## 部署策略

## 必需环境变量（.env）

本项目的 `docker-compose.yml` 对部分环境变量使用了 `:?set` 约束（缺失会直接失败），本地部署前请在项目根目录准备 `.env`：

```bash
ADMIN_API_KEY=...
INTERNAL_API_KEY=...

# Optional:
# LLM_PROVIDERS_HOST_PATH=/abs/path/to/llm-providers.json
# SEARXNG_URL=http://host.docker.internal:18081
# SEARXNG_SECRET_KEY=...  # only required if you deploy the searxng service
```

SOP 存储默认挂载在宿主机目录 `./sops/`（容器内为 `/app/sops`）。如果你要自定义路径，可设置 `ROBOARD_SOP_ROOT`（默认 `/app/sops`）。

### 快速部署脚本（推荐）

项目提供了 `scripts/deploy_local.sh` 脚本，用于快速迭代部署：

```bash
# 预览部署命令（不实际执行）
DRY_RUN=1 bash scripts/deploy_local.sh

# 执行部署
bash scripts/deploy_local.sh
```

该脚本会自动：
- 检测 `docker compose` 或 `docker-compose` 命令
- 构建并启动核心服务：`edge gateway web-frontend api-backend agent-manager llm-gateway mcp-server redis postgres`
- 执行 `docker compose up -d --build ...`

#### 拆分部署（前端与后端分离）

对于资源受限或需要分离负载的场景，可以使用拆分部署：

- **`scripts/deploy_local.sh`**（单主机部署）：在单个主机上部署所有服务，适合开发环境或小型部署
- **`scripts/deploy_worker_host.sh`**（拆分部署）：在 worker 主机上部署后端服务（`api-backend agent-manager llm-gateway mcp-server worker-playwright redis postgres`），前端（`edge gateway web-frontend`）部署在其他主机（如 ravin `68.64.179.125`）

使用拆分部署脚本：

```bash
# 预览部署命令（不实际执行）
DRY_RUN=1 bash scripts/deploy_worker_host.sh

# 在 worker 主机上执行部署（后端服务）
bash scripts/deploy_worker_host.sh
```

拆分部署适用于：
- 前端服务（edge/gateway/web-frontend）运行在资源有限的主机（如 ravin `68.64.179.125`）
- 后端服务（数据库、LLM 网关等）运行在性能更强的 worker 主机
- 需要隔离前端和后端资源使用场景

该脚本会自动：
- 检测 `docker compose` 或 `docker-compose` 命令
- 构建并启动核心服务：`api-backend agent-manager llm-gateway mcp-server worker-playwright redis postgres`
- 执行 `docker compose up -d --build ...`

### 1. 验证 Compose 配置（快速失败）

在任何构建或部署之前，验证 compose 文件是否有效：

```bash
# 切换到项目根目录（docker-compose.yml 所在位置）
cd /path/to/project/root

# 验证 compose 配置（静默模式，出错时失败）
docker compose config -q
# 或回退：docker-compose config -q

# 如果无效，运行不带 -q 的命令查看详细错误输出
docker compose config
```

如果验证失败：
- 检查 YAML 语法（缩进、引号）
- 验证所有引用的文件存在（env 文件、构建上下文）
- 检查循环依赖或冲突的配置

### 2. 构建和部署

**全栈部署**（默认服务）：

```bash
# 构建并启动所有默认服务
docker compose up -d --build edge gateway web-frontend api-backend agent-manager llm-gateway mcp-server

# 检查部署状态
docker compose ps
```

**最小化重部署**（服务子集）：

当只有特定服务变更时，仅重部署这些服务：
```bash
# 仅重部署 API 后端
docker compose up -d --build api-backend

# 重部署前端和 API
docker compose up -d --build web-frontend api-backend
```

**数据库/基础设施优先部署**：

用于初始设置或数据库 schema 变更：
```bash
# 先部署 postgres 和 redis
docker compose up -d postgres redis

# 等待 postgres 准备就绪
docker compose logs -f postgres

# 然后部署应用服务
docker compose up -d --build edge gateway web-frontend api-backend agent-manager llm-gateway mcp-server
```

### 3. 检查失败

如果部署失败：

```bash
# 检查服务状态
docker compose ps

# 查看特定服务的日志
docker compose logs api-backend

# 实时跟踪日志
docker compose logs -f api-backend

# 查看最近的日志（最后 50 行）
docker compose logs --tail=50 api-backend

# 检查所有服务的日志
docker compose logs
```

常见失败模式：
- **端口冲突**：检查端口 80/443 是否被占用（`sudo lsof -i :80`）
- **镜像构建失败**：检查 Dockerfile 语法、构建上下文、基础镜像可用性
- **环境变量缺失**：验证 `.env` 文件包含所有必需变量
- **数据库连接错误**：确保 postgres 服务正在运行且健康

### 4. 验证清单

部署后，使用以下检查进行验证：

**服务健康**：
```bash
# 检查所有服务都在运行
docker compose ps
# 预期：所有服务显示 "Up" 或 "running" 状态

# Compose 网络内健康检查（不依赖公网域名；适合本地/开发机验证）
docker compose exec -T api-backend curl -fsS http://localhost:8000/health
docker compose exec -T gateway curl -fsS http://localhost/api/health

# 如果你是在真实线上机器部署（域名已解析到该机器），可额外做一次公网验证：
# curl -fsS https://roboard.duckdns.org/api/health
# curl -I https://roboard.duckdns.org/ >/dev/null
```

**Bootstrap 验证**（如果适用）：
```bash
# 检查 bootstrap 端点返回 ws_url
docker compose exec -T gateway curl -fsS http://localhost/api/bootstrap
# 预期：返回 JSON，包含 "ws_url" 字段（生产环境通常为 wss://roboard.duckdns.org/...）
```

**内部服务连接**（从 compose 网络内）：
```bash
# 通过 docker compose exec 访问内部服务
docker compose exec -T api-backend curl -fsS http://localhost:8000/health
docker compose exec gateway curl http://localhost/api/health
```

### 5. 回滚

如果验证失败且需要回滚：

```bash
# 停止并移除已部署的服务
docker compose down

# 仅停止特定服务
docker compose stop api-backend
docker compose rm -f api-backend

# 重新部署之前已知良好的状态（如果已版本化）
# git restore 需要较新的 git；如不可用可回退为 git checkout
git restore docker-compose.yml || git checkout docker-compose.yml
docker compose up -d
```

## 最佳实践

- 在任何 `up` 或 `build` 命令之前始终包含 `docker compose config -q`（快速失败）
- 根据上下文分离全栈部署与最小化重部署（全栈 vs. 服务子集）
- 提供适用于 `docker compose` 和 `docker-compose` 回退的命令
- 包含日志检查命令以进行故障排查
- 对于生产部署，先将镜像推送到到远程仓库
- 输出中不要包含密钥或真实 API 密钥
