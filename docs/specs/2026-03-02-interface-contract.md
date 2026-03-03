# 接口契约规范（对齐 PRD v3，推荐形态）

**日期**: 2026-03-02

## 目的
本规范用于消除迁移过程中遗留的“过时规则”，把对外接口约定统一到 PRD v3 所强调的核心体验：

- 以 run 为中心（团队树 + 实时状态）。
- WebSocket 实时推送状态更新。
- 通过 `sop.replace` 对单个 Agent 的 SOP 做显式变更。

PRD v3 不规定具体 URL/headers，本规范选择“当前实现 + PRD 目标”作为推荐契约；各子目录文档应引用本规范，避免再次漂移。

## 路由边界（必须遵守）

对外（公网，经 edge/gateway）：
- `/` UI (web-frontend)
- `/api/*` 外部 API
- `/ws/*` WebSocket

内部（不经 gateway 暴露）：
- `/internal/*` 仅用于内部/管理接口（admin/internal auth）

## 认证与身份（推荐统一口径）

外部 API（租户级）
- Header: `X-API-Key`
- 用于公开 API 调用（非浏览器会话）

浏览器会话（用户级）
- Header: `X-Session-Token` 或会话 Cookie
- 主要用于指挥舱 UI 的登录态（例如 `/api/auth/*`、`/api/runs/*`）

术语澄清（避免混用）
- Agent 侧存在“身份/权限”的内部概念（用于文件系统与执行循环的内部边界）。
- 对外登录态使用 `session_token`（以及 `X-Session-Token` / 会话 Cookie），不要与内部概念混用。

内部服务调用（服务间）
- Header: `X-Internal-Key`
- 若接口是“租户范围”语义，通常还需要 `X-Tenant-ID`
- 说明：租户范围接口包括任务事件写入、任务/Run 查询等；纯内部无租户接口按各服务约定执行。

管理接口（平台级）
- Header: `X-Admin-Key`
- 典型：`POST /internal/tenants`

## 核心对外契约（run-centric）

### 创建 run
- `POST /api/runs`
- 目标：把自然语言目标转换为一个可执行 run，并进入派发流程（由系统触发 dispatch）。

### 获取 run 的团队树
- `GET /api/runs/{run_id}/tree`
- 返回：agents + edges（用于前端树状可视化）。

### SOP 替换动作
- `POST /api/runs/{run_id}/actions`
- Body 示例：
```json
{
  "target_agent_id": "123",
  "action_type": "sop.replace",
  "expected_version": 1,
  "md_text": "# Updated SOP\n\n..."
}
```
- 语义：创建并应用 SOP 变更动作，写入 `action.requested/sop.updated/action.applied` 事件并通过 run WebSocket 广播。

### WebSocket（推荐入口）

`WS /ws/runs/{run_id}`

- 推荐用于指挥舱 UI 与 run 级别的实时状态订阅。
- 认证方式（任选其一）：
  - 外部客户端：Query `api_key=...`
  - 内部服务：Query `internal_key=...&tenant_id=...`
  - 浏览器会话：Query `session_token=...` 或会话 Cookie

消息约定（当前实现约束）：
- 连接后先发 `snapshot`：包含 `run`、`agents`、`edges`、`recent_events`、`cursor`
- 后续推送 `delta`：包含增量 `recent_events` 与新的 `cursor`

## 招募 API（Recruitments）

以下端点用于 run 内成员招募与审核。推荐浏览器会话鉴权：`X-Session-Token: <session_token>` 或会话 Cookie。

### 创建招募申请

- `POST /api/recruitments`
- 鉴权：`session_token`（`X-Session-Token` 或会话 Cookie）
- 请求体 schema：
```json
{
  "run_id": "string",
  "template_id": "string",
  "role": "string | null",
  "skills": ["string"]
}
```
- 响应 schema（`201`）：
```json
{
  "id": "string",
  "run_id": "string",
  "template_id": "string",
  "role": "string | null",
  "skills": ["string"],
  "overrides": {
    "role": "string | null",
    "skills": [
      {
        "name": "string",
        "filename": "string | null",
        "code": "string | null"
      }
    ]
  },
  "status": "pending | approved | rejected",
  "review_comment": "string | null",
  "reviewed_by": "string | null",
  "created_by": "string | null",
  "reviewed_at": "ISO8601 string | null",
  "hired_agent_id": "string | null",
  "instantiate_result": {"...": "..."},
  "created_at": "ISO8601 datetime"
}
```
- 错误码说明：
  - `404`：`run_id` 对应 run 不存在，或 `template_id` 不存在
  - `409`：`RUN_STATE_INVALID`（run 状态不允许招募，如 `paused/terminated`）
  - `422`：请求体字段缺失/类型不匹配（例如 `run_id`、`template_id` 非法）

### 创建招募申请（run 作用域，推荐）

- `POST /api/runs/{run_id}/recruitments`
- 鉴权：`session_token`（`X-Session-Token` 或会话 Cookie）
- 请求体 schema：
```json
{
  "template_id": "string",
  "overrides": {
    "role": "string | null",
    "skills": [
      {
        "name": "string",
        "filename": "string | null",
        "code": "string | null"
      }
    ]
  }
}
```
- 响应 schema（`201`）：同 `POST /api/recruitments` 单对象响应 schema。
- 错误码说明：
  - `404`：`run_id` 对应 run 不存在，或 `template_id` 不存在
  - `409`：`RUN_STATE_INVALID`（run 状态不允许招募，如 `paused/terminated`）
  - `400`：技能输入不合法（例如非法 filename、空 code）
  - `422`：路径/请求体字段校验失败

### 查询招募列表

- `GET /api/recruitments`
- 鉴权：`session_token`（`X-Session-Token` 或会话 Cookie）
- Query schema：
```json
{
  "run_id": "string (optional)",
  "status": "pending | approved | rejected (optional)"
}
```
- 响应 schema（`200`）：
```json
[
  {
    "id": "string",
    "run_id": "string",
    "template_id": "string",
    "role": "string | null",
    "skills": ["string"],
    "overrides": {
      "role": "string | null",
      "skills": [
        {
          "name": "string",
          "filename": "string | null",
          "code": "string | null"
        }
      ]
    },
    "status": "pending | approved | rejected",
    "review_comment": "string | null",
    "reviewed_by": "string | null",
    "created_by": "string | null",
    "reviewed_at": "ISO8601 string | null",
    "hired_agent_id": "string | null",
    "instantiate_result": {"...": "..."},
    "created_at": "ISO8601 datetime"
  }
]
```
- 错误码说明：
  - `404`：不适用（列表接口本身不按 ID 查询）
  - `409`：不适用（列表接口无状态冲突）
  - `422`：查询参数类型不匹配（例如非字符串传值导致校验失败）

### 查询招募详情

- `GET /api/recruitments/{id}`
- 鉴权：`session_token`（`X-Session-Token` 或会话 Cookie）
- Path schema：
```json
{
  "id": "string (数字字符串)"
}
```
- 响应 schema（`200`）：同 `POST /api/recruitments` 的单对象响应 schema。
- 错误码说明：
  - `404`：`id` 对应招募记录不存在
  - `409`：不适用（详情查询无状态冲突）
  - `422`：路径参数类型/格式不匹配

### 审核通过

- `PUT /api/recruitments/{id}/approve`
- 鉴权：`session_token`（`X-Session-Token` 或会话 Cookie）
- 请求体 schema：
```json
{
  "expected_version": 1
}
```
- 响应 schema（`200`）：同 `POST /api/recruitments` 的单对象响应 schema，`status` 更新为 `approved`。
- 错误码说明：
  - `404`：`id` 对应招募记录不存在
  - `409`：`Recruitment already reviewed` / `Recruitment version conflict` / `RUN_STATE_INVALID`
  - `422`：路径参数类型/格式不匹配，或 `expected_version < 1`

### 审核招募（run 作用域）

- `POST /api/runs/{run_id}/recruitments/{recruitment_id}/review`
- 鉴权：`session_token`（`X-Session-Token` 或会话 Cookie）
- 请求体 schema：
```json
{
  "decision": "approved | rejected",
  "comment": "string | null",
  "expected_version": "integer | null"
}
```
- 响应 schema（`200`）：同 `POST /api/recruitments` 单对象响应 schema。
- 错误码说明：
  - `404`：`run_id` 或 `recruitment_id` 不存在
  - `409`：`Recruitment already reviewed` / `Recruitment version conflict` / `RUN_STATE_INVALID`
  - `500`：审核通过后实例化失败（`detail=Failed to instantiate recruitment`，同时 `instantiate_result.error=RECRUITMENT_INSTANTIATE_FAILED`）
  - `422`：路径/请求体字段校验失败

### 审核拒绝

- `PUT /api/recruitments/{id}/reject`
- 鉴权：`session_token`（`X-Session-Token` 或会话 Cookie）
- 请求体 schema：
```json
{
  "expected_version": 1
}
```
- 响应 schema（`200`）：同 `POST /api/recruitments` 的单对象响应 schema，`status` 更新为 `rejected`。
- 错误码说明：
  - `404`：`id` 对应招募记录不存在
  - `409`：`Recruitment already reviewed` / `Recruitment version conflict` / `RUN_STATE_INVALID`
  - `422`：路径参数类型/格式不匹配，或 `expected_version < 1`

## 兼容接口（不推荐对外宣传）

### Task WebSocket（历史/调试）

`WS /ws/events?api_key=...&task_id=...`

`WS /ws/events?internal_key=...&tenant_id=...&task_id=...`

- 这是 task 视角事件流，迁移阶段保留以兼容仍基于 `task_id` 的消费者。
- 不建议在根文档或 UI 文档中作为主要入口对外宣传；对外推荐使用 `/ws/runs/{run_id}`。

## 文档维护规则

- 所有对外文档（根 `README.md`、`docs/*`、各服务 `README.md`）在描述接口/鉴权/WS 时必须以本规范为准。
- 若需要变更对外契约：先更新 `docs/specs/`，再由各子项目 owner 更新各自目录内文档与实现。
