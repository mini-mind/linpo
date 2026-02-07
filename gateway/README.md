gateway: 反向代理 / 边缘路由服务

Port: 8082

## 路由规则

### 静态文件 (前端 UI)
- `/` -> `web-frontend:80`
  - 根路径和所有非 API/WS 请求转发到前端静态文件服务

### API 端点
- `/api/health` -> `api-backend:8000/health`
  - 健康检查特殊映射 (精确匹配)
  - 返回: `{ "status": "ok" }`

- `/api/` -> `api-backend:8000`
  - 所有 `/api/` 前缀请求保留路径并转发到后端
  - 例如: `/api/tasks` -> `http://api-backend:8000/api/tasks`

### WebSocket 端点
- `/ws/` -> `api-backend:8000`
  - 所有 `/ws/` 前缀请求保留路径并转发到后端 WebSocket 服务
  - 超时时间: 3600s (1小时)
  - 例如: `/ws/events` -> `ws://api-backend:8000/ws/events`

## 访问方式

- **用户访问**: `http://localhost:8082/` (gateway 统一入口)
- **API 访问**: `http://localhost:8082/api/...` (经过 gateway)
- **WebSocket**: `ws://localhost:8082/ws/events?...`
- **内部管理**: `http://localhost:8000/internal/tenants` (直接访问后端，不经过 gateway)

## 重要说明

1. `/internal/` 端点**不经过 gateway**，仅用于内部管理，需要 X-Admin-Key 认证
2. WebSocket 长连接超时设置为 1 小时
3. Gateway 自动添加 `X-Forwarded-For` 等 HTTP 头部
