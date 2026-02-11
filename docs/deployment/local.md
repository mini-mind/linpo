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
- `gateway` - 内部 Nginx 网关（端口 8082）
- `web-frontend` - 静态文件服务
- `api-backend` - FastAPI 后端（端口 8000）
- `agent-manager` - 任务调度器（端口 7000）
- `llm-gateway` - LLM 提供商多路复用（端口 7300）
- `mcp-server` - MCP 协议服务

可选/辅助服务（按需单独部署）：
- `postgres` - PostgreSQL 数据库
- `redis` - Redis 缓存和消息代理
- `searxng` - 搜索引擎（端口 8081）
- `mailhog` - 邮件测试（开发环境，端口 8025）

## 部署策略

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

# 检查 edge (Caddy) 正在服务
curl -I https://roboard.duckdns.org/
# 预期：HTTP 200 或 308 重定向

# 检查 API 健康端点
curl https://roboard.duckdns.org/api/health
# 预期：包含 status "ok" 的 JSON 响应

# 检查 WebSocket 升级是否工作
curl -I -H "Upgrade: websocket" -H "Connection: Upgrade" \
  https://roboard.duckdns.org/ws/events
# 预期：101 Switching Protocols 或 400/426（缺少参数）
```

**Bootstrap 验证**（如果适用）：
```bash
# 检查 bootstrap 端点返回 wss:// URL
curl https://roboard.duckdns.org/api/bootstrap
# 预期：包含 "wss://roboard.duckdns.org" 的 "ws_url" JSON
```

**内部服务连接**（从 compose 网络内）：
```bash
# 通过 docker compose exec 访问内部服务
docker compose exec api-backend curl http://localhost:8000/internal/health
docker compose exec gateway curl http://localhost:8082/health
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
git checkout docker-compose.yml
docker compose up -d
```

## 最佳实践

- 在任何 `up` 或 `build` 命令之前始终包含 `docker compose config -q`（快速失败）
- 根据上下文分离全栈部署与最小化重部署（全栈 vs. 服务子集）
- 提供适用于 `docker compose` 和 `docker-compose` 回退的命令
- 包含日志检查命令以进行故障排查
- 对于生产部署，先将镜像推送到到远程仓库
- 输出中不要包含密钥或真实 API 密钥
