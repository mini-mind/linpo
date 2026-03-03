# 生产环境部署指南 (Split Deployment)

**当前运行位置**:
- `ravin` (68.64.179.125): edge/gateway/web-frontend/searxng
- 本地机器：api/dispatch/worker-playwright/其他后端服务

---

## 部署：frontend host (ravin)

```bash
export ROBOARD_ROOT="/home/ravin/roboard-root"
export TAG="<your-tag>"
export API_BACKEND_URL="http://175.178.213.10:8000"

cd "$ROBOARD_ROOT"
docker compose -f ops/deploy/prod/docker-compose.frontend.yml pull
docker compose -f ops/deploy/prod/docker-compose.frontend.yml up -d
docker compose -f ops/deploy/prod/docker-compose.frontend.yml ps
```

**服务**: edge(Caddy) + gateway + web-frontend + searxng

---

## 部署：worker host

以实际运维 SOP 为准。若使用 docker compose：
```bash
docker compose pull && docker compose up -d
```

---

## 验证清单

```bash
# API 健康
curl -fsS https://roboard.duckdns.org/api/health

# 前端
curl -fsS https://roboard.duckdns.org/ >/dev/null

# SearXNG (SSH 登录 ravin)
ssh ravin "curl -s 'http://127.0.0.1:8081/search?q=test&format=json'"
```

**端口约定**:
- 前端 host: 80/443 (edge), 127.0.0.1:8082 (gateway)
- worker host: api 对外 0.0.0.0:8000

---

## 本地开发

本地只运行后端服务：
```bash
docker compose up -d  # api, dispatch, worker-playwright, postgres, redis 等
```

**测试**:
- API: `http://127.0.0.1:8005/health`
- 前端 UI: 访问 ravin `https://roboard.duckdns.org/`
- SearXNG: `export SEARXNG_URL=http://68.64.179.125:8081`

**相关文档**:
- `docs/worker-deployment.md`
- `docs/worker-ops.md`
- `internal/searxng/AGENTS.md`
