# Linpo

Linpo 是位于 OpenClaw 与用户之间的流程编排 Web 层。  
开源版聚焦私有化部署，包含：流程编辑、看板协作、文件产物查看。

## 快速开始（Docker）

### 1. 准备配置

```bash
cp .env.example .env
```

至少需要设置：

- `LINPO_SECRET_ENCRYPTION_KEY`
- `OPENCLAW_BASE_URL`
- `OPENCLAW_GATEWAY_TOKEN`

生成 `LINPO_SECRET_ENCRYPTION_KEY`：

```bash
python - <<'PY'
import base64, os
print(base64.urlsafe_b64encode(os.urandom(32)).decode())
PY
```

### 2. 启动

```bash
docker compose up -d --build
```

默认地址：

- 前端：`http://localhost:4173`
- 后端：`http://localhost:8000`

### 3. 验证

```bash
curl -fsS http://localhost:8000/api/v1/health
```

## 本地开发（不走 Docker）

### 后端

```bash
source .venv/bin/activate
fastapi dev --port 8000
```

### 前端

```bash
npm --prefix frontend install
npm --prefix frontend run dev
```

默认开发地址：`http://localhost:5173`

## 常用命令

```bash
# 后端测试
source .venv/bin/activate && pytest

# 前端测试
npm --prefix frontend run test

# 前端构建
npm --prefix frontend run build
```

## 文档

- 协作规范：[AGENTS.md](AGENTS.md)
- 贡献说明：[CONTRIBUTING.md](CONTRIBUTING.md)
- 架构文档：[docs/architecture.md](docs/architecture.md)
- 产品需求：[docs/prd.md](docs/prd.md)

## 开源边界

- 仅支持 Web 端。
- 不包含支付、会员、模板市场等 SaaS 扩展能力。
