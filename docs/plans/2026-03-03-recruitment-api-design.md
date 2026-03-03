# 招募流程 API 设计方案（MVP）

## 1. 目标与边界

本方案只做轻量级招募资源（Recruitment Requests）的接口设计，不改动现有接口语义，不引入多级审批。

- 目标闭环：申请 -> 审核 -> 加入 run
- MVP 状态机：`pending -> approved | rejected`
- 保持现有路由结构：在 `api/app/tree_api.py` 增加路由，由 `api/app/main.py` 已有 `app.include_router(tree_api.router)` 自动注册

---

## 2. 现有 API 结构对齐结论

已确认：

- `api/app/tree_api.py` 使用 `router = APIRouter()` 承载扩展业务接口
- `api/app/main.py` 末尾通过 `app.include_router(tree_api.router)` 统一挂载

因此，招募 API 的最小侵入做法是：

- 在 `tree_api.py` 新增 Recruitment 的请求/响应模型和 5 个端点
- 不改 `main.py` 的注册方式

---

## 3. Recruitment 数据模型设计

### 3.1 资源字段（对外）

`Recruitment`

- `id`: string（对外返回字符串，内部可为自增 int）
- `run_id`: string
- `template_id`: string
- `role`: string | null
- `skills`: string[]
- `status`: `pending | approved | rejected`
- `created_at`: ISO 8601 string

> 字段严格覆盖需求：`id, run_id, template_id, role, skills, status, created_at`。

### 3.2 建议持久化表（MVP）

建议新增表：`recruitments`

- `id` (PK, int)
- `tenant_id` (FK -> tenants.id, not null)
- `run_id` (FK -> tasks.id, not null)
- `template_id` (string, not null)
- `role` (string, nullable)
- `skills_json` (text/json, not null, default `[]`)
- `status` (string, not null, default `pending`)
- `created_at` (datetime, not null)

建议索引：

- `ix_recruitments_tenant_id`
- `ix_recruitments_run_id`
- `ix_recruitments_status`

### 3.3 校验规则（MVP）

- `run_id` 必须是正整数且属于当前 tenant
- `template_id` 必填（审批通过后要调用实例化 API）
- `skills` 为字符串数组，允许空数组
- 创建时 `status` 固定为 `pending`，客户端不可传入

---

## 4. API 端点设计（CRUD + 审核动作）

鉴权建议沿用现有租户鉴权依赖（与 `tree_api.py` 一致）：

- `Depends(require_tenant)`

### 4.1 创建申请

`POST /api/runs/{run_id}/recruitments`

请求体：

```json
{
  "run_id": "101",
  "template_id": "agent_template_researcher_v1",
  "role": "市场研究员",
  "skills": ["research", "reporting"]
}
```

行为：

- 验证 run 存在且属于当前 tenant
- 写入一条 recruitment，`status = pending`

响应：`201 Created`

```json
{
  "id": "1",
  "run_id": "101",
  "template_id": "agent_template_researcher_v1",
  "role": "市场研究员",
  "skills": ["research", "reporting"],
  "status": "pending",
  "created_at": "2026-03-03T12:00:00Z"
}
```

### 4.2 查询列表

`GET /api/runs/{run_id}/recruitments`（设计草案，当前实现未开放）

查询参数（MVP）：

- `run_id` (optional)
- `status` (optional: `pending|approved|rejected`)

响应：`200 OK`

```json
[
  {
    "id": "1",
    "run_id": "101",
    "template_id": "agent_template_researcher_v1",
    "role": "市场研究员",
    "skills": ["research"],
    "status": "pending",
    "created_at": "2026-03-03T12:00:00Z"
  }
]
```

### 4.3 查询详情

`GET /api/runs/{run_id}/recruitments/{recruitment_id}`（设计草案，当前实现未开放）

响应：`200 OK`，返回单条 `Recruitment`。

异常：

- `404`：不存在或不属于当前 tenant

### 4.4 审核通过

`POST /api/runs/{run_id}/recruitments/{recruitment_id}/review`（decision=approved）

请求体（MVP 可为空）：

```json
{}
```

处理流程：

1. 校验 recruitment 属于当前 tenant 且 `status == pending`
2. 更新 `status = approved`
3. 调用现有实例化 API：`POST /api/runs/{run_id}/agents/instantiate`
   - `template_id <- recruitment.template_id`
   - `overrides.role <- recruitment.role`（有值时）
   - `overrides.skills <- recruitment.skills`（有值时，映射为 `[{name, filename, code?}]` 或按现有技能入参约定处理）

响应：`200 OK`

```json
{
  "id": "1",
  "run_id": "101",
  "template_id": "agent_template_researcher_v1",
  "role": "市场研究员",
  "skills": ["research", "reporting"],
  "status": "approved",
  "created_at": "2026-03-03T12:00:00Z"
}
```

### 4.5 审核拒绝

`POST /api/runs/{run_id}/recruitments/{recruitment_id}/review`（decision=rejected）

请求体（MVP 可为空）：

```json
{}
```

处理流程：

1. 校验 recruitment 属于当前 tenant 且 `status == pending`
2. 更新 `status = rejected`

响应：`200 OK`，返回更新后的 `Recruitment`。

---

## 5. 审核流程状态机

```text
[create request]
    -> pending
        -> (approve) approved -> call instantiate API
        -> (reject)  rejected
```

状态迁移约束（MVP）：

- `pending -> approved` 允许
- `pending -> rejected` 允许
- `approved/rejected` 为终态，不可再次审核

建议错误码：

- `409 Conflict`: 非 `pending` 状态下重复审核
- `404 Not Found`: 记录不存在或越权

---

## 6. 与现有能力衔接（关键点）

### 6.1 与实例化接口衔接

已存在接口：`POST /api/runs/{run_id}/agents/instantiate`。

招募审批通过后，直接复用该接口创建 agent，避免新增另一套入队/实例化逻辑。

### 6.2 保持最小改动

- 不改现有 `/api/runs/*` 与 `/api/agent-templates/*` 行为
- 不改 `main.py` 路由注册
- 新增资源独立，不影响现有 run 创建流程

---

## 7. MVP 错误处理约定

- 创建时 run 不存在：`404 Run not found`
- approve/reject 重复提交：`409 Recruitment already reviewed`
- approve 时实例化失败：返回 `500`，并记录错误日志（MVP 先不扩展额外状态）

---

## 8. 交付物清单（设计层）

本方案已覆盖：

1. 招募申请数据模型（Recruitment）
2. API 端点设计（创建、列表、详情、通过、拒绝）
3. 审核流程状态机（`pending -> approved|rejected`）
4. 审核通过后调用实例化 API 的衔接方案
