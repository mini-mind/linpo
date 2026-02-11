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

**生产主机**: Docker/Compose 已安装，已登录 ACR

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
export ROBOARD_ROOT="/opt/roboard"
export ADMIN_API_KEY="..."
export INTERNAL_API_KEY="..."
export SEARXNG_SECRET_KEY="..."
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

**必填**: `ROBOARD_ROOT`, `ADMIN_API_KEY`, `INTERNAL_API_KEY`, `SEARXNG_SECRET_KEY`

**可选**: `CADDY_EMAIL` (Let's Encrypt), `DATABASE_URL`, `REDIS_URL`

## ROBOARD_ROOT 目录结构

`deploy/prod/docker-compose.yml` 使用 `ROBOARD_ROOT` 环境变量指定生产文件根目录（通常为 `/opt/roboard`）。

必需的目录结构：

```
/opt/roboard/
├── config/
│   ├── agent-config.yml      # Agent 配置
│   └── llm-providers.example.json
├── prompts/
│   └── *.yml                 # Agent 提示词文件
├── edge/
│   └── Caddyfile             # Caddy 反向代理配置
├── searxng/
│   ├── config/
│   │   └── settings.yml      # SearXNG 配置
│   └── data/                 # SearXNG 缓存目录 (自动创建)
└── secrets/
    └── llm-providers.json    # LLM 提供商配置 (包含 API 密钥)
```

### 准备 ROBOARD_ROOT 目录

**方法 1: 从仓库发布包复制**

```bash
# 1. 创建目标目录
sudo mkdir -p /opt/roboard/{config,prompts,edge,searxng/config,searxng/data,secrets}

# 2. 从仓库发布包复制 (假设已下载发布 tarball 到 /tmp)
tar -xzf /tmp/roboard-release-20260211.tar.gz -C /tmp/roboard-release

# 3. 复制必要文件
sudo cp -r /tmp/roboard-release/config/* /opt/roboard/config/
sudo cp -r /tmp/roboard-release/prompts/* /opt/roboard/prompts/
sudo cp /tmp/roboard-release/edge/Caddyfile /opt/roboard/edge/

# 4. 设置 SearXNG 配置 (使用仓库中的示例或自定义配置)
sudo cp /tmp/roboard-release/searxng/config/settings.yml /opt/roboard/searxng/config/

# 5. 创建 LLM 提供商配置 (必须包含真实的 API 密钥)
sudo tee /opt/roboard/secrets/llm-providers.json > /dev/null <<'EOF'
{
  "providers": [
    {
      "name": "openai",
      "type": "openai",
      "base_url": "https://api.openai.com/v1",
      "api_key": "sk-your-actual-api-key"
    }
  ]
}
EOF

# 6. 设置权限
sudo chown -R root:root /opt/roboard
sudo chmod -R 755 /opt/roboard
sudo chmod 600 /opt/roboard/secrets/llm-providers.json
```

**方法 2: 从 Git 仓库直接克隆 (仅用于初始设置)**

```bash
sudo mkdir -p /opt/roboard

# 克隆仓库到临时目录
git clone https://github.com/your-org/roboard.git /tmp/roboard-repo

# 复制必要文件
sudo cp -r /tmp/roboard-repo/config/* /opt/roboard/config/
sudo cp -r /tmp/roboard-repo/prompts/* /opt/roboard/prompts/
sudo cp /tmp/roboard-repo/edge/Caddyfile /opt/roboard/edge/
sudo cp -r /tmp/roboard-repo/searxng/config/* /opt/roboard/searxng/config/

# 创建 secrets 目录并配置 LLM 提供商
sudo mkdir -p /opt/roboard/secrets
sudo tee /opt/roboard/secrets/llm-providers.json > /dev/null <<'EOF'
{
  "providers": [
    {
      "name": "openai",
      "type": "openai",
      "base_url": "https://api.openai.com/v1",
      "api_key": "sk-your-actual-api-key"
    }
  ]
}
EOF

# 清理临时目录
rm -rf /tmp/roboard-repo

# 设置权限
sudo chown -R root:root /opt/roboard
sudo chmod -R 755 /opt/roboard
sudo chmod 600 /opt/roboard/secrets/llm-providers.json
```

### 验证目录结构

部署前验证 `ROBOARD_ROOT` 目录完整：

```bash
export ROBOARD_ROOT="/opt/roboard"

# 检查必需文件和目录
for path in \
  "$ROBOARD_ROOT/config" \
  "$ROBOARD_ROOT/config/agent-config.yml" \
  "$ROBOARD_ROOT/prompts" \
  "$ROBOARD_ROOT/edge/Caddyfile" \
  "$ROBOARD_ROOT/searxng/config/settings.yml" \
  "$ROBOARD_ROOT/secrets/llm-providers.json"
do
  if [ ! -e "$path" ]; then
    echo "Missing: $path"
    exit 1
  fi
done

echo "ROBOARD_ROOT structure OK"
```

### 更新配置文件

部署新版本时，仅需要更新相应文件：

```bash
# 更新 config/prompts (例如: 新版本提示词)
tar -xzf /tmp/roboard-release-20260212.tar.gz -C /tmp/roboard-release
sudo cp -r /tmp/roboard-release/config/* /opt/roboard/config/
sudo cp -r /tmp/roboard-release/prompts/* /opt/roboard/prompts/

# 重启服务以应用新配置
docker compose -f deploy/prod/docker-compose.yml up -d
```

## 本地快速部署 (Push then Deploy)

**适用场景**: 在同一台机器（roboard.duckdns.org 服务器）上开发并部署，无需 ACR 推送。

**📚 官方文档**: 本流程的完整说明和最佳实践请参考 [本地部署指南](deployment/local.md)。

当 `roboard.duckdns.org` 域名指向开发机器时，使用以下流程快速部署：

```bash
# 1. 提交并推送代码
git add .
git commit -m "your change"
git push

# 2. 立即在服务器上部署（使用默认服务）
export SERVICES="edge gateway web-frontend api-backend agent-manager llm-gateway mcp-server"
docker compose up -d --build $SERVICES
```

### 部署行为

- **Compose 文件**: 使用 repo-root `docker-compose.yml`（非 `deploy/prod/docker-compose.yml`）
- **默认服务**: `edge gateway web-frontend api-backend agent-manager llm-gateway mcp-server`
  - 可通过 `SERVICES` 环境变量覆盖：`SERVICES="edge gateway api-backend" docker compose up -d --build $SERVICES`
- **构建选项**: `docker compose up -d --build`（强制重新构建）
- **验证前检查**: 执行 `docker compose config -q` 确保配置有效

### 验证部署

```bash
# 检查服务状态
docker compose ps

# 健康检查
curl https://roboard.duckdns.org/
curl https://roboard.duckdns.org/api/health
```

## 回滚流程

```bash
export TAG=20260210-f1e2d3c  # 之前的版本
docker compose -f deploy/prod/docker-compose.yml pull
docker compose -f deploy/prod/docker-compose.yml up -d
```

## 完整部署示例

```bash
# 本地构建并推送镜像
TAG=20260211-a1b2c3d ./scripts/push_core_images.sh

# 在生产主机上
export TAG=20260211-a1b2c3d
export ROBOARD_ROOT="/opt/roboard"
export ADMIN_API_KEY="..."
export INTERNAL_API_KEY="..."
export SEARXNG_SECRET_KEY="..."

docker compose -f deploy/prod/docker-compose.yml pull && \
docker compose -f deploy/prod/docker-compose.yml up -d
```

## 常见问题

**"Unable to pull image"**: 生产主机未登录 ACR，执行 `docker login registry.cn-hangzhou.aliyuncs.com`

**"ROBOARD_ROOT: parameter not set"**: 未设置 `ROBOARD_ROOT` 环境变量，执行 `export ROBOARD_ROOT="/opt/roboard"`

**"Bind mount path does not exist"**: 检查 `ROBOARD_ROOT` 目录下是否存在必需的文件和目录 (config/, prompts/, edge/Caddyfile, searxng/, secrets/llm-providers.json)

**"llm-gateway 502"**: 检查 `ROBOARD_ROOT/secrets/llm-providers.json` 是否存在且包含有效的 LLM 提供商配置

**"Permission denied" accessing ROBOARD_ROOT**: 检查目录权限，确保 Docker 可以读取 (建议权限: 755 for directories, 644 for files, 600 for secrets)

## 安全建议

1. 使用 `.env` 文件或 Docker Secrets 管理敏感配置，不要提交到 Git
2. 仅开放必要端口 (80, 443)
3. 定期 `docker compose logs` 检查异常
