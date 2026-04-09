# Linpo

Linpo 是位于 OpenClaw 与用户之间的人机协作编排交互层。  
当前版本聚焦 Web 私有化部署（PC + 移动浏览器），主工作区为：

- 摘要
- 看板
- 流程编辑
- 文件

## Docker 私有化部署（主路径）

前置：

- Docker 24+
- Docker Compose v2

### 1) 准备最小配置

```bash
cp .env.example .env
```

必须设置：

- `LINPO_SECRET_ENCRYPTION_KEY`（合法 Fernet key，32-byte urlsafe base64）

可用以下命令生成一个 key：

```bash
python - <<'PY'
import base64, os
print(base64.urlsafe_b64encode(os.urandom(32)).decode())
PY
```

### 2) 启动

```bash
docker compose up -d --build
```

默认地址：

- 前端：`http://localhost:4173`
- 后端：`http://localhost:8000`

### 3) 健康检查

```bash
curl -fsS http://localhost:8000/api/v1/health
curl -i http://localhost:8000/api/v1/ops/setup
```

说明：

- 开源版默认免注册/免登录，首次访问会自动引导为本地默认用户。
- 开源版为单实例模式，不提供运行时实例创建/配对能力。

### 4) 必填 OpenClaw 配置

开源版单实例模式下，以下三项必须在启动前提供：

- `OPENCLAW_BASE_URL`
- `OPENCLAW_GATEWAY_TOKEN`
- `LINPO_TASK_EVENT_CALLBACK_BASE_URL`

可在 `.env`、容器环境变量或 `docker-compose` 覆盖项中设置。

其余常用覆盖项：

- `LINPO_ALLOW_PRIVATE_ENDPOINTS`
- `LINPO_ALLOW_LOOPBACK_ENDPOINTS`

### 环境文件约定（精简）

仅保留以下 2 个文件：

- `.env.example`：唯一模板（可提交）
- `.env`：唯一实际配置（不提交）

不建议新增其它 `.env*` 变体（如临时备份文件）；需要临时值请直接用 shell 环境变量覆盖。

## 数据库策略

- 默认无需外部数据库：未配置 `LINPO_DATABASE_URL` 时，后端使用 `sqlite:///./linpo.db`。
- 生产如需切换外部数据库，显式设置 `LINPO_DATABASE_URL` 即可。

## 本地开发（贡献者）

本地开发与质量门详见：

- [CONTRIBUTING.md](CONTRIBUTING.md)

最小联调路径（跳过 Docker，推荐用于私有化本地验收）：

```bash
# 后端（默认会自动读取仓库根目录 .env）
fastapi dev --port 8000

# 前端
npm --prefix frontend run dev
```

常见本地坑位（`8000 + npm run dev`）：

- 前端开发端口固定为 `5173`；若被占用会直接报错，请先释放端口后重试。
- 前端开发默认连接 `http://localhost:8000`；可通过 `VITE_API_BASE_URL` 覆盖，例如：
  `VITE_API_BASE_URL=http://<server-ip>:8000 npm --prefix frontend run dev`。
- 后端 CORS 通过 `LINPO_CORS_ALLOW_ORIGINS` 控制允许来源（逗号分隔完整 Origin）。
- `LINPO_TASK_EVENT_CALLBACK_BASE_URL` 为必填；建议本机联调填 `http://localhost:8000`，跨机/容器填 OpenClaw 可访问的 Linpo 地址。

一键本地验收（最小串联，需先启动后端+前端）：

```bash
set -euo pipefail
curl -fsS http://localhost:8000/api/v1/health >/dev/null
INSTANCE_ID="$(curl -fsS http://localhost:8000/api/v1/instances | jq -r '.[0].id')"
jq -n --arg instanceId "$INSTANCE_ID" \
  '{requirement:"smoke: 拆分并推进最小流程",instanceId:$instanceId,executorAgentId:"main"}' \
  > /tmp/linpo-flow-generate.json
curl -fsS -X POST http://localhost:8000/api/v1/boards/default/tasks/flow/generate \
  -H 'content-type: application/json' \
  --data @/tmp/linpo-flow-generate.json \
  > /tmp/linpo-flow-generate-resp.json
jq -n \
  --arg instanceId "$INSTANCE_ID" \
  --arg plannerSessionKey "$(jq -r '.plannerSessionKey' /tmp/linpo-flow-generate-resp.json)" \
  --arg executionSessionPrefix "$(jq -r '.executionSessionPrefix' /tmp/linpo-flow-generate-resp.json)" \
  --argjson nodes "$(jq '.nodes' /tmp/linpo-flow-generate-resp.json)" \
  --argjson edges "$(jq '.edges' /tmp/linpo-flow-generate-resp.json)" \
  '{instanceId:$instanceId,executorAgentId:"main",managerAgentId:"main",plannerSessionKey:$plannerSessionKey,executionSessionPrefix:$executionSessionPrefix,requirementTitle:"smoke-confirm",nodes:$nodes,edges:$edges}' \
  > /tmp/linpo-flow-confirm.json
curl -fsS -X POST http://localhost:8000/api/v1/boards/default/tasks/flow/confirm \
  -H 'content-type: application/json' \
  --data @/tmp/linpo-flow-confirm.json >/tmp/linpo-flow-confirm-resp.json
PLAYWRIGHT_DEPLOYED_BASE_URL=http://127.0.0.1:5173 npm --prefix frontend run e2e:deployed
echo "local smoke passed"
```

若失败，优先排查：

- `curl .../health` 失败：后端未在 `8000` 启动。
- `flow/generate` 或 `flow/confirm` 失败：检查 `.env` 的 `OPENCLAW_*`。
- 若 `ops/setup` 的 `flow_decomposition_configured` 报默认 `main` 不可用：按 `nextStep` 使用运行时可用 agent（以 message 中 agents 列表为准）。
- `e2e:deployed` 失败：确认前端在 `5173`，并检查 `PLAYWRIGHT_DEPLOYED_BASE_URL`。

常用质量命令（精简）：

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
