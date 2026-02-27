# Search Infrastructure

## 文档目录结构

本项目明确分离人类文档与运行时角色提示词：

- **`docs/`** - 人类/操作员/开发者文档
  - [本地部署指南](docs/deployment/local.md) - Docker Compose 本地部署流程
  - [生产部署指南](docs/prod-deployment.md) - 生产环境部署配置
  - [文档中心](docs/README.md) - 完整的项目文档入口
  - [Sisyphus 工作流](docs/process/sisyphus-workflow.md) - `.sisyphus` 进程文档

- **`prompts/`** - 运行时角色提示词（仅供应用内 Agent 使用）
  - `prompts/agents/*.md` - Agent 角色定义
  - `prompts/skills/*.md` - Agent 技能提示词（如 `chat_user.md`, `search_web.md`, `browser_run.md`, `a2a_consult.md` 等）
  - 这些文件仅供 LLM 在运行时使用，不包含人类操作手册或部署指南

## 服务架构

### 服务组件
- **edge**: 80/443 (公网入口，Caddy 反向代理 + HTTPS)
- **gateway**: 80 (内部，统一入口，Nginx 反向代理；在 `deploy/prod/docker-compose.frontend.yml` 中会绑定 `127.0.0.1:8082->80` 便于本机调试)
- **web-frontend**: 80 (内部，静态文件服务)
- **api-backend**: 8000 (内部，FastAPI 后端；本地 `docker-compose.yml` 默认绑定 `127.0.0.1:8005->8000` 供调试)
- **agent-manager**: 7000 (内部，任务调度；默认不暴露到宿主机)
- **worker-playwright**: 7100 (内部，浏览器执行；默认不暴露到宿主机)
- **mcp-server**: 9000 (内部，MCP 协议服务；默认不暴露到宿主机)
- **postgres**: (内部，数据持久化，绑定 127.0.0.1:5432)
- **redis**: (内部，速率限制，绑定 127.0.0.1:6379)
- **mailhog**: 127.0.0.1:8025 (邮件测试；需要时启动)
- **searxng**: 127.0.0.1:8081 (搜索引擎；仅在 `deploy/prod/docker-compose.frontend.yml` / legacy compose 中提供)

### 访问入口/端口暴露

**生产环境公网访问**：
- **唯一公网入口**: `https://roboard.duckdns.org` (edge 80/443)
  - UI: `https://roboard.duckdns.org/`
  - API: `https://roboard.duckdns.org/api/...`
  - WebSocket: `wss://roboard.duckdns.org/ws/events?...`
- **不对公网暴露的端口**: 127.0.0.1 绑定的 8082/8005/5432/6379/8025/8081 等（按部署形态启用），以及仅在 compose 网络内可达的 7000/7100/9000 等

**内部管理访问**：
- **内部管理服务**: 绑定 127.0.0.1，仅本地访问
  - MailHog: `http://127.0.0.1:8025` (邮件测试)
  - SearXNG: `http://127.0.0.1:8081` (搜索引擎；如果启用了 searxng)
- `api-backend` 本地调试端口: `http://127.0.0.1:8005/health`
- **内部管理端点**: 使用 `docker compose exec` 进入容器
  - 临时端口映射 (仅本地调试): 修改 docker-compose.yml 添加 `127.0.0.1:端口号:端口号`（当前默认已映射 `api-backend:127.0.0.1:8005->8000`）

## Quick Start

Run all services:
```bash
docker compose up -d
```

If docker compose is not available, use:
```bash
docker-compose up -d
```

Stop services:
```bash
docker compose down
```

View logs:
```bash
docker compose logs -f
```

## A2A (Agent-to-Agent) Communication

The system supports async agent-to-agent communication via Redis streams:

### Flow
1. `POST /internal/a2a/ask` enqueues A2A jobs to Redis stream `queue:a2a`
2. `agent-manager` consumes `queue:a2a` (consumer group: `agent-manager-a2a`) and processes messages
3. `agent-manager` replies by calling `POST /internal/a2a/send`
4. `GET /api/a2a/threads/{id}` is used by the UI for expanding thread details

### Environment Variables

#### A2A Stream Configuration
- `A2A_STREAM`: Redis stream for A2A jobs (default: `queue:a2a`)
- `A2A_DEAD_STREAM`: Dead-letter stream for failed A2A jobs (default: `queue:a2a:dead`)
- `A2A_GROUP`: Redis consumer group for A2A (default: `agent-manager-a2a`)
- `A2A_CONSUMER`: Redis consumer name (default: `agent-manager` or hostname)
- `A2A_MAX_ATTEMPTS`: Max retry attempts for A2A jobs (default: `3`)

#### LLM Gateway Configuration
- `LLM_GATEWAY_URL`: URL of the LLM gateway service (default: `http://llm-gateway:7300`)
- `LLM_PROVIDERS_HOST_PATH`: Path to llm-providers.json file mounted by `llm-gateway`
  - HK dev path: `/home/ravin/.web3d-secrets/llm-providers.json`
  - Without a real providers file, LLM calls will return 502 errors

## CEO Delegation (Tool-Calling Flow)

The CEO agent uses native tool calling to delegate work to sub-agents. This is a **non-blocking** flow:
- The HTTP request returns immediately with an `a2a_thread_id`
- Agent execution continues in the background via `agent-manager`
- Progress can be tracked via A2A thread endpoints

### Flow
1. `POST /api/agents/ceo/chat` creates a chat request for the CEO agent
2. CEO LLM receives tools (`a2a.send`, `a2a.fetch_thread`) and decides to call them
3. API backend executes tool loop:
   - If tool calls exist: execute them (e.g., `a2a.send` to enqueue sub-agent work)
   - Pass tool responses back to LLM for further processing
4. HTTP response returns immediately with `{"a2a_thread_id": "..."}` (non-blocking)
5. Use `GET /api/a2a/threads/{id}` to poll agent messages and replies

### Tool Schema Requirements
For tool-calling to work, `llm-gateway` must pass through OpenAI-compatible message fields:
- `tool_calls`: Array of tool call objects (from LLM response)
- `tool_call_id`: String identifier for tool response messages
- **Gotcha**: Ensure `llm-gateway` message schema does not strip extra fields like `tool_call_id`

### Quick QA (Local)

```bash
docker compose exec -T api-backend python3 - <<'PY'
import urllib.request, json, time

# NOTE: This snippet runs inside the api-backend container.
# - So BASE=http://localhost:8000 is correct here.
# - From the host, api-backend is bound to http://127.0.0.1:8005 by default.
BASE = "http://localhost:8000"

# 1. Register
email = f"qa_{int(time.time())}@example.com"
req = urllib.request.Request(
    f"{BASE}/api/auth/register",
    data=json.dumps({"email": email, "password": "testpass"}).encode(),
    headers={"Content-Type": "application/json"}
)
with urllib.request.urlopen(req) as resp:
    token = json.load(resp)["session_token"]
print(f"Session Token: {token}")

# 2. CEO chat
req = urllib.request.Request(
    f"{BASE}/api/agents/ceo/chat",
    data=json.dumps({"message": "Get top 3 trending repos on GitHub"}).encode(),
    headers={"Content-Type": "application/json", "X-Session-Token": token}
)
with urllib.request.urlopen(req) as resp:
    chat = json.load(resp)
thread_id = chat["a2a_thread_id"]
print(f"A2A Thread ID: {thread_id}")

# 3. Poll thread (wait a bit for processing)
time.sleep(5)
req = urllib.request.Request(
    f"{BASE}/api/a2a/threads/{thread_id}",
    headers={"X-Session-Token": token}
)
with urllib.request.urlopen(req) as resp:
    thread = json.load(resp)
print(json.dumps(thread, indent=2))
PY
```

## Environment Variables

### 必填环境变量
- `ADMIN_API_KEY`: Admin 认证密钥 (用于创建租户)
- `INTERNAL_API_KEY`: 内部服务认证密钥 (服务间通信)
- `SEARXNG_SECRET_KEY`: SearXng 搜索引擎密钥（仅在部署 `searxng` 服务时需要）

### 可选环境变量 (有默认值)
- `DATABASE_URL`: PostgreSQL 连接字符串
  - 默认值: `postgresql://postgres:postgres@postgres:5432/web3d` (仅适用于 compose 网络内)
- `REDIS_URL`: Redis 连接字符串
  - 默认值: `redis://redis:6379/0` (仅适用于 compose 网络内)
- `ALLOW_ORIGINS`: CORS 允许的源
- `RATE_LIMIT`: 速率限制 (请求/分钟)

## Authentication

- **外部 API**: 使用 `X-API-Key` 头部认证
- **内部服务**: 使用 `X-Internal-Key` 头部认证
- **管理端点**: 使用 `X-Admin-Key` 头部认证

## 快速验证

以下命令在 Docker Compose 环境下可以快速验证端到端流程：

```bash
# 1. 创建租户 (获取 api_key) - 使用 docker compose exec 进入容器
ADMIN_KEY="your-admin-key-here"
TENANT_RESPONSE=$(docker compose exec -T api-backend python3 -c "
import requests, json, os
resp = requests.post('http://localhost:8000/internal/tenants',
    headers={'Content-Type': 'application/json', 'X-Admin-Key': os.environ['ADMIN_KEY']},
    data=json.dumps({'name': 'test-tenant'}))
print(resp.text)
" ADMIN_KEY="$ADMIN_KEY")
API_KEY=$(echo $TENANT_RESPONSE | jq -r '.api_key')
TENANT_ID=$(echo $TENANT_RESPONSE | jq -r '.tenant_id')
echo "API Key: $API_KEY"
echo "Tenant ID: $TENANT_ID"

# 方式 2: 使用 docker compose exec -T 直接调用 curl (容器内)
# docker compose exec -T api-backend curl -s -X POST http://localhost:8000/internal/tenants \
#   -H "Content-Type: application/json" -H "X-Admin-Key: $ADMIN_KEY" \
#   -d '{"name": "test-tenant"}'

# 方式 3: 临时端口映射 (仅用于本地调试)
# 本地 `docker-compose.yml` 默认已映射 "127.0.0.1:8005:8000" 到 api-backend ports
# curl -s -X POST http://127.0.0.1:8005/internal/tenants ...

# 2. 创建任务 (会自动触发执行) - 通过公网域名
TASK_RESPONSE=$(curl -s -X POST https://roboard.duckdns.org/api/tasks \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d '{"input": {"query": "example search"}}')
TASK_ID=$(echo $TASK_RESPONSE | jq -r '.id')
echo "Task ID: $TASK_ID"

# 3. 等待几秒让任务执行
sleep 6

# 4. 获取任务结果 - 通过公网域名
curl -s https://roboard.duckdns.org/api/tasks/$TASK_ID/result \
  -H "X-API-Key: $API_KEY" | jq

# 5. 获取通知 - 通过公网域名
curl -s https://roboard.duckdns.org/api/tasks/$TASK_ID/notifications \
  -H "X-API-Key: $API_KEY" | jq

# 6. WebSocket 连接 (使用 wscat 或 websocat) - 通过公网域名
# websocat "wss://roboard.duckdns.org/ws/events?api_key=$API_KEY&task_id=$TASK_ID"
```

**注意**：
- `/internal/tenants` 端点通过 `docker compose exec` 进入容器执行 (推荐方式)
  或直接使用本地默认映射 `127.0.0.1:8005:8000` (本地调试)
- 外部 API 访问 `https://roboard.duckdns.org/api/...` (经过 edge/Caddy + HTTPS)
- WebSocket 连接使用 `api_key` + `task_id` 参数，通过 `wss://` 安全连接
- 创建任务后会自动触发执行，无需手动调用 agent-manager

## 生产配置建议

### Secrets 管理

- 使用 `.env` 文件管理敏感配置（`ADMIN_API_KEY`, `INTERNAL_API_KEY`, `SEARXNG_SECRET_KEY` 等）
- 确保 `.env` 已加入 `.gitignore`，不要提交到版本控制
- 生产环境推荐使用 Docker Secrets：
  ```yaml
  services:
    api-backend:
      secrets:
        - admin_api_key
        - internal_api_key
        - searxng_secret_key
  secrets:
    admin_api_key:
      external: true
    internal_api_key:
      external: true
    searxng_secret_key:
      external: true
  ```
- 避免在日志中打印密钥，使用环境变量读取而非硬编码

### INTERNAL_API_KEY 强化路线

**现状**：当前 `INTERNAL_API_KEY` 为单一静态密钥，所有内部服务共享同一密钥进行服务间认证。

**推荐增强方案**：
- **支持密钥轮换/多密钥**：允许同时存在多个有效密钥，平滑过渡新旧密钥
- **短时效 Token**：内部服务间使用短期 JWT Token 替代静态密钥
- **mTLS 认证**：在服务间通信启用双向 TLS 认证，提供更强的安全隔离

### Gateway 限流

- **IP 级别限流**：已在 `gateway/nginx.conf` 配置基础限流和连接限制，作为兜底保护
- **租户级别限流**：应用层（api-backend）以 tenant 为单位进行速率限制，优先实现业务隔离
- 生产环境可根据实际流量调整 `nginx.conf` 中的 `limit_req_zone` 和 `limit_conn_zone` 参数

### 邮件配置

系统支持通过环境变量配置 SMTP 发送邮件通知：

- **本地开发**：默认使用 MailHog 服务，可访问 `http://127.0.0.1:8025` 查看捕获的邮件
- **SMTP 配置**：
  ```bash
  # SMTP 服务器配置
  SMTP_HOST=smtp.example.com
  SMTP_PORT=587
  SMTP_USERNAME=your-username
  SMTP_PASSWORD=your-password
  SMTP_USE_TLS=true
  
  # 默认通知收件人
  DEFAULT_NOTIFICATION_EMAIL=admin@example.com
  ```
  - 邮件通知会在任务完成、失败或特定事件触发时自动发送
- 未配置 SMTP 时，通知会默认发送到 MailHog（开发环境）或静默丢弃（生产环境需显式配置）

## Worker 部署 (Playwright)

Playwright 浏览器执行任务已迁移至独立 worker 服务器以提升性能和隔离性。

- **Worker 主机**: `175.178.213.10` (用户: `ubuntu`)
- **部署文档**: [docs/worker-deployment.md](docs/worker-deployment.md)
- **部署脚本**:
  - `scripts/push_worker_images.sh` - 推送 worker 镜像到远程
  - `scripts/deploy_worker.sh` - 在 worker 主机上部署服务

提示：项目根目录 `.env` 需要设置 `PLAYWRIGHT_GATEWAY_URL=http://175.178.213.10:7200`（并确保 `ADMIN_API_KEY`/`INTERNAL_API_KEY` 已配置；`SEARXNG_SECRET_KEY` 仅在部署 searxng 服务时需要）。

## 免费域名/DDNS

对于需要公网访问域名的场景，推荐使用 **DuckDNS**。

### DuckDNS 使用说明

- **获取子域名**：在 https://www.duckdns.org 注册，可免费获取 `your-name.duckdns.org` 子域名
- **更新 IP**：通过以下方式保持域名指向当前公网 IP：
  - **Web 界面**：登录 DuckDNS 后手动更新
  - **定时任务**：使用 `cron` 或定时脚本调用 DuckDNS API
  - **路由器 DDNS**：部分路由器支持 DuckDNS 动态更新
  - **Docker 容器**：可使用 `linuxserver/duckdns` 镜像自动更新 IP

### 注意事项

- **Freenom 已不可用**：Freenom 免费域名服务已终止，请勿再使用
- DuckDNS 提供稳定、免费的 DDNS 服务，适合个人开发和小型项目
- 确保公网 IP 变化时及时更新，否则域名将无法解析

## HTTPS 配置

### 生产域名（Caddy + Let's Encrypt）

**主域名**: `https://roboard.duckdns.org`

edge 服务使用 Caddy 作为反向代理，自动通过 Let's Encrypt 获取和管理 SSL 证书：

- **自动证书管理**：
  - Caddy 在首次访问时自动向 Let's Encrypt 申请证书
  - 证书存储在 `caddy-data` 卷中，持久化保存
  - 证书在过期前自动续期，无需手动操作
  - 支持 ACME HTTP-01 验证（端口 80）和 TLS-ALPN-01 验证（端口 443）

- **网络要求**：
  - 确保 ports 80 和 443 可从互联网访问
  - 防火墙/路由器需要开放这两个端口
  - DNS 解析 `roboard.duckdns.org` 到服务器公网 IP

- **访问方式**：
  ```bash
  # API 访问（自动验证证书）
  curl https://roboard.duckdns.org/api/health

  # WebSocket 连接
  wscat -c "wss://roboard.duckdns.org/ws/events?api_key=YOUR_KEY"
  ```

### IP 访问（HTTP 仅支持）

当前配置下，edge 服务仅支持通过域名 `https://roboard.duckdns.org` 的 HTTPS 访问。

- **生产环境端口不对公网暴露**
  - 内部服务端口（容器内）仅在 Docker 网络内可达（gateway:80, api-backend:8000, agent-manager:7000, ...）
  - frontend host 可能会把 gateway/searxng 绑定到 `127.0.0.1` 用于本机调试（例如 `127.0.0.1:8082` / `127.0.0.1:8081`）
  - 访问内部管理端点推荐使用 `docker compose exec`；本地调试可使用已绑定的 `127.0.0.1:*` 端口

- **临时测试**：本地调试时可在 docker-compose.yml 添加端口映射
  ```yaml
  services:
    api-backend:
      ports:
        - "127.0.0.1:8005:8000"  # 临时添加，测试后移除
  ```
  ```bash
  curl http://127.0.0.1:8005/internal/tenants ...
  ```

- **生产环境**：建议使用域名 `https://roboard.duckdns.org` 以获得完整的 HTTPS 支持

### Let's Encrypt 手动配置（备用方案）

如果需要手动配置 Let's Encrypt 证书（例如使用 DNS-01 验证）：

#### DuckDNS + DNS-01 验证

- Let's Encrypt 支持 DuckDNS 的 DNS-01 验证方式
- 使用 `certbot-dns-duckdns` 插件自动完成证书申请和续期
- 示例命令：
  ```bash
  certbot certonly --dns-duckdns --dns-duckdns-token YOUR_TOKEN \
    --dns-duckdns-domains your-name.duckdns.org
  ```

#### 自有域名 + Cloudflare

- 如使用 Cloudflare 托管域名，可利用 Cloudflare 的 DNS API
- 使用 `certbot-dns-cloudflare` 插件进行 DNS-01 验证
- 需配置 Cloudflare API Token 并具有 DNS 编辑权限

#### 证书续期

- Let's Encrypt 证书有效期为 90 天
- 建议设置自动续期任务（crontab）
- 示例续期命令：
  ```bash
certbot renew --deploy-hook "docker exec edge reload-nginx"
  ```

## 数据备份与恢复

### 备份脚本

使用 `scripts/pg_backup.sh` 备份 PostgreSQL 数据库：

```bash
# 使用默认配置备份（数据库名: web3d）
./scripts/pg_backup.sh

# 使用环境变量自定义备份
PG_DB=mydb PG_USER=myuser BACKUP_DIR=./my_backups ./scripts/pg_backup.sh
```

- 备份文件命名：`{database_name}_YYYYMMDD_HHMMSS.dump`
- 备份格式：PostgreSQL custom format (`-Fc`)
- 默认配置：
  - `PG_DB`: `web3d`（数据库名）
  - `PG_USER`: `postgres`（数据库用户）
  - `BACKUP_DIR`: `./backups`（备份目录）
  - `SERVICE`: `postgres`（Docker 服务名）

### 恢复脚本

使用 `scripts/pg_restore.sh` 恢复数据库：

```bash
# 恢复指定备份文件
./scripts/pg_restore.sh backups/web3d_20250207_120000.dump

# 使用环境变量指定数据库
PG_DB=mydb PG_USER=myuser ./scripts/pg_restore.sh backups/web3d_20250207_120000.dump
```

- **注意**：恢复操作会完全删除并重建目标数据库，所有现有数据将丢失
- 恢复流程：
  1. 停止依赖服务（api-backend、agent-manager）
  2. 删除现有数据库
  3. 创建空数据库
  4. 从备份文件恢复数据
  5. 重启依赖服务
- 默认配置：
  - `PG_DB`: `web3d`（恢复的目标数据库名）
  - `PG_USER`: `postgres`（数据库用户）
  - `SERVICE`: `postgres`（Docker 服务名）

### 最佳实践

- 定期执行备份（建议每天至少一次）
- 将备份文件异地存储（云存储、外部硬盘等）
- 定期验证备份文件的可恢复性
- 记录备份和恢复操作日志

## 部署邮件服务注意事项

在生产环境中部署邮件发送功能时，需注意以下邮件合规性和最佳实践：

### SPF/DKIM/DMARC 配置

为确保邮件不被标记为垃圾邮件，必须配置以下 DNS 记录：

- **SPF (Sender Policy Framework)**：指定哪些服务器有权限代表域名发送邮件
  - 示例记录：`v=spf1 ip4:your-ip -all`
- **DKIM (DomainKeys Identified Mail)**：为邮件添加数字签名，验证发送者身份
  - 需生成密钥对，并在 DNS 中配置公钥记录
- **DMARC (Domain-based Message Authentication)**：基于 SPF 和 DKIM 的邮件验证策略
  - 建议初始策略：`v=DMARC1; p=none; rua=mailto:dmarc@example.com`
  - 稳定后可调整为：`v=DMARC1; p=quarantine;` 或 `p=reject;`

### 退订与订阅管理

- **退订机制**：所有营销邮件必须提供清晰的退订链接
- **退订处理**：
  - 实现一键退订功能，退订请求应在 10 个工作日内处理
  - 退订链接应长期有效，不得设期限
- **订阅确认**：使用双选入（Double Opt-in）流程，用户确认后才发送邮件

### 发送速率与重试策略

- **速率限制**：
  - 初始阶段建议每分钟发送不超过 10-20 封邮件
  - 根据收件人域名逐步提升，观察邮件送达率
- **退信处理**：
  - 实现退信跟踪，永久失败地址应从发送列表中移除
  - 临时失败可设置重试机制（指数退避策略）
- **黑名单风险**：
  - 定期检查域名是否被列入邮件黑名单
  - 黑名单后需立即停止发送，并联系相关机构申诉

### 其他建议

- 使用专业邮件服务商（如 SendGrid、Mailgun、AWS SES）可提升送达率
- 监控邮件发送指标：送达率、打开率、点击率、退订率、投诉率
- 遵守反垃圾邮件法（如 CAN-SPAM 法案、GDPR 邮件规定）
- 维护清洁的邮件列表，定期清理无效地址和退订用户
