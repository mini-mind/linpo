api-backend: FastAPI HTTP API with Postgres persistence.

This service is the backend API for creating tasks, posting task events, streaming events over WebSocket, and exposing notification/result placeholders.

Notes:
- Current MVP execution plumbing is intended to integrate with MCP.
- The API is intentionally shaped to be reusable from a Godot client.

## Install

Python 3.12+ recommended.

```bash
python -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
```

## Environment Variables

Required:
- DATABASE_URL: Postgres connection string
- REDIS_URL: Redis connection string for rate limiting
- ADMIN_API_KEY: Admin API key for admin endpoints
- INTERNAL_API_KEY: Internal service authentication key

Optional:
- ALLOW_ORIGINS: CORS allowed origins
- RATE_LIMIT: Rate limit requests per minute

## Run

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

## Authentication

1) External API: X-API-Key
2) Internal services: X-Internal-Key + X-Tenant-ID
3) Admin: X-Admin-Key

Note: /api endpoints accept either external or internal unless otherwise specified.

## Multi-tenant

Per-tenant concurrency is capped at 2 tasks in states `queued|running|needs_human`. Creating a task beyond the cap returns HTTP 429.

## Rate Limiting

Rate limiting enforced via Redis. Configured via `REDIS_URL` and `RATE_LIMIT`.

## Endpoints

### Health

`GET /health` -> `{ "status": "ok" }`

### Admin - Tenants

`POST /internal/tenants` (requires `X-Admin-Key`)

Create a new tenant.

Request:
```json
{
  "name": "tenant_name"
}
```

### Create task

`POST /api/tasks` (requires `X-API-Key` OR `X-Internal-Key` + `X-Tenant-ID`)

创建任务后会**自动触发执行**，无需手动调用 agent-manager。系统会在后台调用 agent-manager 的 `/internal/dispatch` 端点进行任务派发。

Request:
```json
{ "input": { "query": "..." } }
```

Response:
```json
{
  "id": "...",
  "tenant_id": 1,
  "status": "queued",
  "created_at": "...",
  "updated_at": "...",
  "input": {"query": "..."}
}
```

### Post event

`POST /api/tasks/{task_id}/events` (requires `X-Internal-Key` + `X-Tenant-ID`)

Updates task status and broadcasts over WebSocket.

Supported event types:
- `task.created`
- `task.step.started`
- `task.step.progress`
- `task.step.artifact`
- `task.requires_input`
- `task.completed`
- `task.failed`

Event -> status mapping:
- `task.created` -> `queued`
- `task.step.started` -> `running`
- `task.requires_input` -> `needs_human`
- `task.completed` -> `completed`
- `task.failed` -> `failed`

When status becomes `needs_human|completed|failed`, two placeholder notifications are appended:
- `web` notification: `delivered`
- `email` notification: `queued` (no real email sending)

### Get task

`GET /api/tasks/{task_id}` (requires `X-API-Key` OR `X-Internal-Key` + `X-Tenant-ID`)

### Get result

`GET /api/tasks/{task_id}/result` (requires `X-API-Key` OR `X-Internal-Key` + `X-Tenant-ID`)

Returns:
- `summary`: 任务完成摘要 (可选)
  - 如果 `task.completed` 事件包含 `summary` 字段，返回该值
  - 如果 `task.completed` 事件包含 `status` 字段，返回格式 `completed: {status}`
  - 否则返回 `completed`
- `artifacts`: 从 `task.step.artifact` 事件中提取的产物列表
- `structured_output`: 结构化输出 (暂未使用)

### Get notifications

`GET /api/tasks/{task_id}/notifications` (requires `X-API-Key` OR `X-Internal-Key` + `X-Tenant-ID`)

## WebSocket

订阅任务事件流，连接时发送快照，之后广播新事件。

### 外部客户端 (推荐)
`WS /ws/events?api_key=...&task_id=...`

- 使用 `api_key` 查询参数进行认证
- 系统会自动根据 api_key 查找对应的租户

### 内部服务
`WS /ws/events?internal_key=...&tenant_id=...&task_id=...`

- 使用 `internal_key` + `tenant_id` 查询参数进行认证
- 用于服务内部监听特定租户的任务事件

### 消息格式
- 连接成功后，服务器发送 `snapshot` 消息，包含当前任务状态和所有历史事件
- 之后每当有新事件提交，都会以 JSON 格式广播给所有连接的 WebSocket 客户端

示例消息:
```json
{
  "type": "snapshot",
  "data": {
    "task": { "id": "...", "status": "queued", ... },
    "events": [
      { "id": "...", "type": "task.created", "timestamp": "...", ... }
    ]
  }
}
```
