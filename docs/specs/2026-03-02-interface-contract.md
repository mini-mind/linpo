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

## 兼容接口（不推荐对外宣传）

### Task WebSocket（历史/调试）

`WS /ws/events?api_key=...&task_id=...`

`WS /ws/events?internal_key=...&tenant_id=...&task_id=...`

- 这是 task 视角事件流，迁移阶段保留以兼容仍基于 `task_id` 的消费者。
- 不建议在根文档或 UI 文档中作为主要入口对外宣传；对外推荐使用 `/ws/runs/{run_id}`。

## 文档维护规则

- 所有对外文档（根 `README.md`、`docs/*`、各服务 `README.md`）在描述接口/鉴权/WS 时必须以本规范为准。
- 若需要变更对外契约：先更新 `docs/specs/`，再由各子项目 owner 更新各自目录内文档与实现。
