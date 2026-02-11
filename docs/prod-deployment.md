# 生产环境部署指南 (Core Stack)

**相关文档**: [文档中心](README.md) | [Worker Deployment](worker-deployment.md)

## 概述

本文档说明如何将核心服务镜像发布到 ACR 并使用 `deploy/prod/docker-compose.yml` 部署。

**核心服务**: edge (Caddy), gateway, web-frontend, api-backend, agent-manager, worker-playwright, mcp-server, llm-gateway, postgres, redis, searxng。

## 为什么使用 TAG 部署 (Option B)

使用 `latest` 标签会导致版本丢失。使用不可变的 `TAG` 部署可确保每个版本对应唯一标签，支持追溯和回滚。

## TAG 策略

**推荐格式**: `YYYYMMDD-<git-short-sha>` (脚本自动生成)
- `20260211-a1b2c3d` - 干净工作目录
- `20260211-a1b2c3d-dirty` - 有未提交更改 (警告)

**获取 git 短 SHA**: `git rev-parse --short HEAD`

## 前置条件

**本地机器**: Docker 已安装，已登录 ACR `docker login registry.cn-hangzhou.aliyuncs.com`

**生产主机**: Docker/Compose 已安装，已登录 ACR，仓库布局完整 (config/, prompts/, edge/Caddyfile, searxng/)

## ACR 仓库

- **Registry**: `registry.cn-hangzhou.aliyuncs.com/ravin/`
- **镜像**: web3d-web-frontend, web3d-gateway, web3d-api-backend, web3d-agent-manager, web3d-worker-playwright, web3d-mcp-server, web3d-llm-gateway

## 部署流程

### Step 1: 构建并推送镜像

```bash
TAG=20260211-a1b2c3d ./scripts/push_core_images.sh
```

脚本构建所有核心服务镜像并推送到 ACR。

### Step 2: 部署到生产主机

```bash
export TAG=20260211-a1b2c3d
export ADMIN_API_KEY="..."
export INTERNAL_API_KEY="..."
export SEARXNG_SECRET_KEY="..."
export LLM_PROVIDERS_HOST_PATH="/path/to/llm-providers.json"
export CADDY_EMAIL="admin@example.com"  # 可选

docker compose -f deploy/prod/docker-compose.yml pull
docker compose -f deploy/prod/docker-compose.yml up -d
```

**⚠️ 警告**: 不要将密钥提交到 Git。使用 `.env` 文件或环境变量管理。

### Step 3: 验证部署

```bash
# 检查服务状态
docker compose -f deploy/prod/docker-compose.yml ps

# 检查镜像 TAG
docker ps --format "{{.Names}}\t{{.Image}}" | grep -E "(web-frontend|gateway|api-backend)"

# HTTP 健康检查
curl -I https://roboard.duckdns.org/
curl https://roboard.duckdns.org/api/health

# Bootstrap 端点 (需要先注册获取 session_token)
python3 - <<'PY'
import urllib.request, json, time, uuid

BASE = "https://roboard.duckdns.org"

# 1. Register
email = f"{int(time.time())}-{uuid.uuid4().hex[:8]}@example.com"
req = urllib.request.Request(
    f"{BASE}/api/auth/register",
    data=json.dumps({"email": email, "password": "testpass"}).encode(),
    headers={"Content-Type": "application/json"}
)
with urllib.request.urlopen(req) as resp:
    token = json.load(resp)["session_token"]

# 2. Bootstrap
req = urllib.request.Request(
    f"{BASE}/api/world/bootstrap",
    data=json.dumps({"world_id": "test"}).encode(),
    headers={"X-Session-Token": token, "Content-Type": "application/json"}
)
with urllib.request.urlopen(req) as resp:
    data = json.load(resp)
    ws_url = data.get("ws_url")
    print(ws_url)
    assert ws_url.startswith("wss://"), "ws_url must start with wss://"
PY
```

## 环境变量

**必填**: `ADMIN_API_KEY`, `INTERNAL_API_KEY`, `SEARXNG_SECRET_KEY`, `LLM_PROVIDERS_HOST_PATH`

**可选**: `CADDY_EMAIL` (Let's Encrypt), `DATABASE_URL`, `REDIS_URL`

## Bind Mounts 注意事项

`deploy/prod/docker-compose.yml` 使用相对于 compose 文件的 bind mounts:

- `../../config:/app/config:ro` → 仓库根目录 `config/`
- `../../prompts:/app/prompts:ro` → 仓库根目录 `prompts/`
- `../../edge/Caddyfile:/etc/caddy/Caddyfile:ro` → 仓库根目录 `edge/Caddyfile`

**确保生产主机上存在这些目录和文件**。

## 回滚流程

```bash
export TAG=20260210-f1e2d3c  # 之前的版本
docker compose -f deploy/prod/docker-compose.yml pull
docker compose -f deploy/prod/docker-compose.yml up -d
```

## 完整部署示例

```bash
TAG=20260211-a1b2c3d ./scripts/push_core_images.sh

# 在生产主机上
export TAG=20260211-a1b2c3d
export ADMIN_API_KEY="..."
export INTERNAL_API_KEY="..."
export SEARXNG_SECRET_KEY="..."
export LLM_PROVIDERS_HOST_PATH="/path/to/llm-providers.json"

docker compose -f deploy/prod/docker-compose.yml pull && \
docker compose -f deploy/prod/docker-compose.yml up -d
```

## 常见问题

**"Unable to pull image"**: 生产主机未登录 ACR，执行 `docker login registry.cn-hangzhou.aliyuncs.com`

**"Bind mount path does not exist"**: 检查仓库目录是否存在 (config/, prompts/, edge/Caddyfile)

**"llm-gateway 502"**: 检查 `LLM_PROVIDERS_HOST_PATH` 指向的文件是否存在

## 安全建议

1. 使用 `.env` 文件或 Docker Secrets 管理敏感配置，不要提交到 Git
2. 仅开放必要端口 (80, 443)
3. 定期 `docker compose logs` 检查异常
