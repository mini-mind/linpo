api: FastAPI HTTP API with Postgres persistence.

This service is the backend API for creating tasks, posting task events, streaming events over WebSocket, and exposing notification/result placeholders.

Notes:
- Current MVP execution plumbing is intended to integrate with MCP.
- The API is intentionally shaped to be reusable from a Godot client.
- Interface contract (recommended): `docs/specs/2026-03-02-interface-contract.md`

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
- DISPATCH_URL: Optional URL for dispatch /internal/dispatch

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

### Auth

`POST /api/auth/register`

注册新用户并创建租户，返回 `session_token` 并写入会话 Cookie。

Request:
```json
{
  "email": "user@example.com",
  "password": "testpass",
  "tenant_name": "optional"
}
```

Response:
```json
{
  "session_token": "...",
  "expires_at": "..."
}
```

`POST /api/auth/login`

使用账号密码登录，返回 `session_token` 并写入会话 Cookie。

Request:
```json
{
  "email": "user@example.com",
  "password": "testpass"
}
```

Response:
```json
{
  "session_token": "...",
  "expires_at": "..."
}
```

`GET /api/auth/me` (requires `X-Session-Token` or session cookie)

返回当前会话对应的用户与租户信息。

`POST /api/auth/logout` (requires `X-Session-Token` or session cookie)

清除会话并返回 HTTP 204。

### Create task

`POST /api/tasks` (requires `X-API-Key` OR `X-Internal-Key` + `X-Tenant-ID`)

创建任务后会**自动触发执行**，无需手动调用 dispatch。系统会在后台调用 dispatch 的 `/internal/dispatch` 端点进行任务派发；若未配置 `DISPATCH_URL`，则退回 Redis `queue:dispatch`。

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

### Create run

`POST /api/runs` (requires `X-API-Key` OR `X-Internal-Key` + `X-Tenant-ID`)

创建 run, 返回 `run_id` 并立刻进入派发流程。若配置 `DISPATCH_URL`，会调用 dispatch `/internal/dispatch`；否则使用 Redis `queue:dispatch`。

Request:
```json
{
  "input_nl": "描述运行目标",
  "input": {}
}
```

Response:
```json
{
  "run_id": "...",
  "status": "queued",
  "created_at": "..."
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

### Run tree

`GET /api/runs/{run_id}/tree`

返回 run 的 agent 树（agents + edges），用于前端任务树展示。

### Run SOP

`GET /api/agents/{agent_id}/sop`

Query:
- `version` (可选): 指定 SOP 版本号；为空时返回最新版本并优先读取 `mission.md`。

Response:
```json
{
  "md_text": "...",
  "version": 1
}
```

说明:
- 产品语境中 SOP 常被用于指代 TODO/计划列表, 其来源为 `plan.md` 并解析为 `plan_subtasks`.
- 该接口返回的是 SOP 模板文本, 与计划列表在实现上并存.

### Run actions (sop.replace)

`POST /api/runs/{run_id}/actions`

Request:
```json
{
  "target_agent_id": "123",
  "action_type": "sop.replace",
  "expected_version": 1,
  "md_text": "# Updated SOP\n\n...",
  "idempotency_key": "sop-replace-1"
}
```

`action_type` 目前仅支持 `sop.replace`。

### Agent skills

`GET /api/runs/{run_id}/agents/{agent_id}/skills`
`PUT /api/runs/{run_id}/agents/{agent_id}/skills`

Request (PUT):
```json
{
  "skills": [
    {"name": "hello", "filename": "hello.py", "code": "def run():\n    return 'hello'\n"}
  ]
}
```

技能清单写入 `agent_fs/skills/manifest.json`，代码文件写入 `agent_fs/skills/*.py`。

### Community skills

`GET /api/community-skills`

返回 `config/community_skills.yaml` 中登记的技能列表。

`GET /api/community-skills/search`

Query:
- `query`: 搜索关键词 (必填)
- `limit`: 返回条数，默认 5

按关键词搜索社区技能，返回匹配的技能列表。

`POST /api/runs/{run_id}/agents/{agent_id}/skills/install`

Request:
```json
{ "skill_key": "hello_world" }
```

安装指定社区技能并更新 manifest。

`POST /api/runs/{run_id}/agents/{agent_id}/skills/install-nl`

Request:
```json
{ "query": "hello world" }
```

根据自然语言查询匹配社区技能并安装，默认选取第一个匹配项。

### Team template export/import

`GET /api/runs/{run_id}/team/export`

Query:
- `format`: `yaml` (default) or `json`

Response (YAML):
```json
{ "format": "yaml", "yaml": "version: 1\n..." }
```

Response (JSON):
```json
{ "format": "json", "content": "{\"version\":1,...}" }
```

`POST /api/runs/team/import`

Request:
```json
{ "yaml": "version: 1\n..." }
```

导入后创建新的 run，并按模板生成 agent 树。

## WebSocket

订阅任务事件流，连接时发送快照，之后广播新事件。

### Run 事件流
`WS /ws/runs/{run_id}`

- 推荐用于指挥舱 UI 与 run 级别的实时状态订阅。
- 认证方式：
  - 外部客户端：`?api_key=...`
  - 内部服务：`?internal_key=...&tenant_id=...`
  - 浏览器会话：`?session_token=...` 或会话 Cookie
- 连接后发送 `snapshot`，包含 `run`、`agents`、`edges`、`recent_events`、`cursor`。
- 后续以 `delta` 消息推送增量事件，字段包含 `recent_events` 和 `cursor`。

### Task 事件流（任务视角，不推荐）
`WS /ws/events?api_key=...&task_id=...`

- 这是 task 视角的事件流，主要用于调试或对接仍基于 `task_id` 的消费者。
- 外部客户端认证：`api_key` 查询参数。

`WS /ws/events?internal_key=...&tenant_id=...&task_id=...`

- 内部服务认证：`internal_key` + `tenant_id` 查询参数。
- 用于服务内部监听特定租户的 task 事件。

### 消息格式
- 连接成功后，服务器发送 `snapshot` 消息。
  - 对 `WS /ws/runs/{run_id}`：`data` 包含 `run`、`agents`、`edges`、`recent_events`、`cursor`。
  - 对 `WS /ws/events`：`data` 包含 `task` 与 `events`。
- 之后每当有新事件提交，会以 `delta`（run）或事件广播（task）方式推送给所有连接的客户端。
