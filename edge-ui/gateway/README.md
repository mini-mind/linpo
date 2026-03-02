gateway: 反向代理 / 边缘路由服务

Port: 80 (container)

Host 端口绑定取决于 compose 文件：

- 项目根 `docker-compose.yml`: 默认不把 gateway 暴露到宿主机端口（只能通过 `edge` 或 `docker compose exec gateway ...` 访问）
- `session-g-ops/deploy/prod/docker-compose.frontend.yml`: 绑定 `127.0.0.1:8082->80`（用于 frontend host 本机调试）
- split 部署需设置 `API_BACKEND_URL`，并保证 worker host 的 `8000` 对前端 host 可达

## 路由规则

### 静态文件 (前端 UI)
- `/` -> `web-frontend:80`
  - 根路径和所有非 API/WS 请求转发到前端静态文件服务

### API 端点
- `/api/health` -> `${API_BACKEND_URL:-api-backend:8000}/health`
  - 健康检查特殊映射 (精确匹配)
  - 返回: `{ "status": "ok" }`

- `/api/` -> `${API_BACKEND_URL:-api-backend:8000}`
  - 所有 `/api/` 前缀请求保留路径并转发到后端
  - 例如: `/api/tasks` -> `http://api-backend:8000/api/tasks`

### WebSocket 端点
- `/ws/` -> `${API_BACKEND_URL:-api-backend:8000}`
  - 所有 `/ws/` 前缀请求保留路径并转发到后端 WebSocket 服务
  - 超时时间: 3600s (1小时)
  - 例如: `/ws/runs/{run_id}` -> `ws://api-backend:8000/ws/runs/{run_id}`

## 访问方式

- **用户访问**:
  - 生产/线上：`https://roboard.duckdns.org/`（edge -> gateway）
  - 若 gateway 已绑定 8082：`http://localhost:8082/`
- **API 访问**:
  - `https://roboard.duckdns.org/api/...`
  - 或 `http://localhost:8082/api/...`（gateway 已绑定 8082 时）
- **WebSocket**:
  - `wss://roboard.duckdns.org/ws/runs/{run_id}`
  - 或 `ws://localhost:8082/ws/runs/{run_id}`（gateway 已绑定 8082 时）

- **内部管理**（`/internal/*` 直连后端，不经过 gateway）:
  - 容器内：`http://api-backend:8000/internal/tenants`
  - 宿主机（本地 compose 默认映射）：`http://127.0.0.1:8005/internal/tenants`

## 重要说明

1. `/internal/` 端点**不经过 gateway**，仅用于内部管理，需要 X-Admin-Key 认证
2. WebSocket 长连接超时设置为 1 小时
3. Gateway 自动添加 `X-Forwarded-For` 等 HTTP 头部
4. Split 部署时需要设置 `API_BACKEND_URL` 指向 worker host（例如 `http://175.178.213.10:8000`）
5. Nginx 使用模板 `default.conf.template` 注入 `API_BACKEND_URL`，避免硬编码冲突。
