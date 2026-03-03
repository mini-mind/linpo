## Amendments

- 2026-02-26: 升级 PRD 版本为 v3.0，覆盖核心功能与技术架构要点。
- 2026-02-26: 调整 MVP 范围分层，强调 Skill 自举与技能生态的差异化。
- 2026-03-02: 将 3.7 升级为 "Agent 模板库"，支持预制 Agent 与模板库管理。
- 2026-03-03: 新增 Agent 招募机制（模板招募 + 自定义技能招募），取消持久化架构复刻能力。
- 2026-03-03: 修复优先级、并发控制与招募流程严谨性问题，补充 API Schema、安全边界与边界场景。

· 升级 PRD 版本为 v3.0，覆盖核心功能与技术架构要点。
· 调整 MVP 范围分层，强调 Skill 自举与技能生态的差异化。

产品需求文档：灵板（RoBoard）

文档版本 v3.0
更新日期 2026-03-03
状态 正式版

1. 产品概述

1.1 产品名称

· 英文名：RoBoard（Robot + Board，机器人控制面板）
· 中文名：灵板（灵动指挥，智能面板）

1.2 一句话定义

灵板是一个“可指挥的多智能体 run”平台：用户用自然语言下达目标，系统按任务招募 Agent、实时可视化进度，用户可随时干预，并能通过安装或自建技能扩展能力边界。

1.3 产品定位

灵板不是单点聊天工具，而是 AI 多智能体协作的操作系统。它面向非技术业务操盘手提供可视化、可干预、可复用的 run 指挥能力。

1.4 核心价值

· 零门槛招募 Agent：一句话描述需求，系统自动生成可执行的 Agent 组合。
· 过程透明：状态与步骤可视化，关键节点可回溯。
· 可控变更：执行中可发起 SOP 替换动作，保持掌控权。
· 生态兼容：可直接安装社区技能，避免重复造轮子。
· 自我进化：智能体可生成新技能并自用，能力持续扩展。
· 知识沉淀：招募配置与偏好可复用、可共享。
· 预制能力：可从模板库快速选用预配置的专家 Agent（如搜索专家、分析专家）。

2. 目标用户与场景

2.1 核心用户画像

· 业务操盘手：采购、生产、运营等岗位，面对多任务线但缺乏技术资源。
· 解决方案构建者：AI 产品经理/行业专家，为内部或客户搭建垂直应用。
· 技术极客（可选）：使用进阶功能进行深度定制与调试。

2.2 典型场景

· 供应商监控：库存/价格阈值预警，日汇总。
· 工厂早会助手：采集数据、分析偏差、生成提纲。
· 竞品追踪：定时抓取网站，分析价格变化。
· 舆情监控：关键词趋势、异常预警。
· 文档自动化：从纪要生成文档与验收清单。

3. 产品核心功能（MVP范围）

3.1 自然语言创建 run（P0，含创建期初始招募）

· 用户以日常语言描述目标。
· 系统解析目标并给出创建期初始招募建议（模板 Agent 优先，可附加已审核自定义技能）。
· 用户确认招募清单后创建 run 并执行；创建期不包含运行中追加招募。
· 可验证指标：首次用户从目标输入到 run 启动耗时 P50 ≤ 60 秒，且确认步骤 ≤ 2 步。

3.2 树状可视化与实时状态监控

· 指挥舱显示 Agent 执行树，节点颜色表示状态（运行/成功/失败/等待）。
· 点击节点查看步骤、进度、摘要与工具结果。
· 状态更新通过 WebSocket 实时推送。

3.3 SOP 替换动作

· 支持对单个 Agent 发起 `sop.replace` 动作。
· 变更动作记录为事件并通过 WebSocket 实时可见。
· 通过 `expected_version` 控制并发冲突。
· 并发控制统一规则：所有 run/agent 写接口（`sop.replace`、`POST /api/runs/{run_id}/agents/recruit`、`PATCH /api/runs/{run_id}/agents/{agent_id}`）均需携带 `expected_version`，校验成功后版本号单调 +1，冲突返回 `409 VERSION_CONFLICT`。

3.4（已移除）可信来源机制

· PRD 方向调整后，可信来源绑定不再纳入当前范围。

3.5 Skill 自举（核心差异化）

· 当现有技能不足时，智能体可生成新技能代码并安装使用。
· 生成流程由系统完成，用户只需知情。
· 自举核心为元技能（skill-creator），由其根据需求生成新技能。
· 新技能运行在沙箱环境，隔离敏感资源。

3.6 兼容社区技能市场

· 提供“安装技能”能力，支持从社区仓库检索与安装。
· 可通过自然语言指令触发安装。
· 初期仅允许已验证技能。
· 技能调用由执行器自动完成，不依赖用户手动点击触发。

3.7 Agent 模板库

· 提供预制 Agent 模板（如搜索专家、分析专家、文档撰写专家）。
· 支持从模板实例化 Agent，自动绑定技能。
· 预制 Agent 可直接对接内部服务（如 searcher 接入 searxng）。

· 模板能力规则矩阵（MVP）：

| 规则项 | 平台预制模板 | 租户私有模板 | 说明 |
|---|---|---|---|
| 可见范围 | 全租户可见 | 仅本租户可见 | 避免跨租户泄露 |
| 可修改人 | 平台管理员 | 租户管理员 | 普通成员只可使用 |
| 角色/显示名覆盖 | 允许 | 允许 | 仅影响实例，不回写模板 |
| 技能绑定变更 | 仅可追加已审核租户技能，不可移除模板必选技能 | 可调整本租户技能 | 自定义技能必须先审核 |
| 内部服务端点 | 不可由用户改写 | 不可由用户改写 | 端点白名单与鉴权头由系统注入 |

3.8 Agent 招募机制（P1，运行期追加招募）

· 创建期初始招募归属 P0（见 3.1）；本节定义运行期追加招募（P1）。
· 运行期支持两种追加方式：模板招募、自定义技能招募（仅限已审核技能）。
· 招募后的 Agent 仅加入当前 run 执行，不引入跨 run 持久化层级管理。

3.8.1 运行期追加招募流程（简版）

· 选择来源（模板/自定义）→ 提交招募请求（含 `expected_version`）→ 规则校验/审核校验 → 创建并加入 run。

3.8.2 招募 API Schema（MVP）

以下端点用于 run 内成员招募与审核。

#### 创建招募申请（run 作用域）

· `POST /api/runs/{run_id}/recruitments`

请求体 schema：

```json
{
  "template_id": "searcher",
  "role": "市场研究员",
  "skills": []
}
```

响应体（201）：

```json
{
  "id": "1",
  "run_id": "101",
  "template_id": "searcher",
  "role": "市场研究员",
  "skills": [],
  "status": "pending",
  "created_at": "2026-03-03T12:00:00Z"
}
```

#### 创建招募申请（run 作用域，推荐）

· `POST /api/runs/{run_id}/recruitments`

请求体 schema：

```json
{
  "template_id": "searcher",
  "overrides": {
    "role": "市场研究员",
    "skills": [
      {"name": "custom_research", "filename": "custom_research.py", "code": "def run():\n    return 'ok'\n"}
    ]
  }
}
```

响应体（201）：同上。

#### 审核招募申请（run 作用域）

· `POST /api/runs/{run_id}/recruitments/{recruitment_id}/review`

请求体 schema：

```json
{
  "decision": "approved",
  "comment": "match the run goal"
}
```

响应体（200）：

```json
{
  "id": "1",
  "run_id": "101",
  "template_id": "searcher",
  "role": "市场研究员",
  "skills": [],
  "status": "approved",
  "hired_agent_id": "ag_998",
  "instantiate_result": {"status": "success"},
  "reviewed_by": "user_123",
  "reviewed_at": "2026-03-03T12:05:00Z",
  "created_at": "2026-03-03T12:00:00Z"
}
```

#### 查询招募列表（规划项）

· `GET /api/runs/{run_id}/recruitments`

Query 参数：
- `run_id` (可选): 按 run 过滤
- `status` (可选): `pending|approved|rejected`

响应体（200）：

```json
[
  {
    "id": "1",
    "run_id": "101",
    "template_id": "searcher",
    "role": "市场研究员",
    "skills": [],
    "status": "pending",
    "created_at": "2026-03-03T12:00:00Z"
  }
]
```

#### 查询招募详情（规划项）

· `GET /api/runs/{run_id}/recruitments/{recruitment_id}`

响应体（200）：同创建响应 schema。

#### 审核通过/拒绝（run 作用域）

· `POST /api/runs/{run_id}/recruitments/{recruitment_id}/review`（`decision=approved`）
· `POST /api/runs/{run_id}/recruitments/{recruitment_id}/review`（`decision=rejected`）

请求体：无（空 body）

响应体（200）：同创建响应 schema，`status` 更新为 `approved` 或 `rejected`。

错误码：

· `404 NOT_FOUND`：run、招募记录或模板不存在。
· `409 CONFLICT`：重复审核（已审核状态不可再次审核）或版本冲突。
· `422 UNPROCESSABLE_ENTITY`：参数校验失败（例如 `run_id` 非法、`template_id` 为空、`status` 非法值）。
· `500 INTERNAL_SERVER_ERROR`：实例化失败或其他内部错误。

· `POST /api/runs/{run_id}/agents/recruit`

请求体（模板招募示例）：

```json
{
  "mode": "template",
  "template_id": "searcher",
  "display_name": "市场研究员",
  "reason": "补齐竞品信息采集",
  "expected_version": 12
}
```

请求体（自定义技能招募示例）：

```json
{
  "mode": "custom",
  "role": "analyst",
  "display_name": "数据分析师",
  "skills": ["sql_analysis", "report_summary"],
  "reason": "补齐数据洞察链路",
  "expected_version": 12
}
```

响应体（201）：

```json
{
  "agent_id": "ag_998",
  "run_id": "101",
  "recruit_source": "template",
  "status": "running",
  "applied_version": 13
}
```

错误码：

· `400 INVALID_REQUEST`：参数缺失或 `mode` 非法。
· `403 SKILL_NOT_APPROVED`：自定义技能未审核通过或无权限使用。
· `404 RUN_OR_TEMPLATE_NOT_FOUND`：run、模板或技能不存在。
· `409 VERSION_CONFLICT`：`expected_version` 与服务端当前版本不一致。
· `409 RUN_STATE_INVALID`：run 不在可追加招募状态。

· `GET /api/runs/{run_id}/agents`

响应体（200）：

```json
[
  {
    "agent_id": "ag_998",
    "display_name": "市场研究员",
    "recruit_source": "template",
    "status": "running"
  }
]
```

· `PATCH /api/runs/{run_id}/agents/{agent_id}`

请求体（更新技能绑定示例）：

```json
{
  "skills": ["sql_analysis", "report_summary"],
  "expected_version": 13
}
```

响应体（200）：

```json
{
  "agent_id": "ag_998",
  "skills": ["sql_analysis", "report_summary"],
  "applied_version": 14
}
```

错误码：

· `400 INVALID_REQUEST`
· `403 SKILL_NOT_APPROVED`
· `404 RUN_OR_AGENT_NOT_FOUND`
· `409 VERSION_CONFLICT`

3.8.3 自定义技能审核规则

· 仅允许绑定“已审核通过（approved）”的租户私有技能；`pending/rejected` 技能不可用于招募。
· 审核最小维度：权限范围、依赖安全、资源配额；不通过必须返回可读拒绝原因。
· 审核责任边界：平台预制技能由平台维护，租户自定义技能由租户管理员审核。
· 运行边界：技能在沙箱执行，不可读取宿主机敏感路径，不可直接获取 `X-Internal-Key`。

3.8.4 招募边界场景表（与当前实现对齐）

| 场景 | 触发条件 | 处理策略 | 返回/可观测结果 |
|---|---|---|---|
| run 状态不允许招募 | run 状态为 `paused` 或 `terminated` | 拒绝创建/审核招募请求 | `409 RUN_STATE_INVALID` |
| 模板下线或不可用 | `template_id` 在模板库中不存在 | 拒绝创建招募申请 | `404 Template '<template_id>' not found` |
| 技能审核与输入校验 | 自定义技能文件名非法（含路径穿越）或 code 为空（当提供 code 时） | 拒绝写入招募申请，要求修正技能定义 | `400 Invalid skill filename` / `400 Skill code required` |
| 审核并发冲突 | 同一招募被并发审核，或 `expected_version` 不匹配 | 仅允许一次从 `pending` 进入终态，冲突请求拒绝 | `409 Recruitment already reviewed` / `409 Recruitment version conflict` |
| 实例化幂等冲突 | 同一 run 下重复提交相同 `idempotency_key` | 拒绝重复实例化请求 | `409 Duplicate instantiate request` |


3.9 多端协同基础

· 指挥舱支持响应式布局，移动端可查看关键状态。
· 移动端支持轻量查看，复杂操作引导至 PC。
· 登录后多端同步任务进度。

3.10 文件系统即界面（进阶）

· 技术用户可浏览智能体工作目录并预览产物。
· 支持文本/图片/PDF 预览。

4. 技术架构要点

4.1 Agent 核心模型

每个 Agent 通过“文件系统 + 事件驱动循环 + 工具调用”实现自治。示例结构：

```
/agents/<agent_id>/
├── identity.json        # 元数据：ID、名称、角色、状态、session_key、recruit_source
├── mission.md           # 当前任务描述
├── plan.md              # 子任务列表（JSON）
├── context/
│   └── workspace/       # 中间产物
├── children/            # 运行期子 Agent 目录（临时协作关系）
├── skills/              # 自建 Skill（Python 文件）
├── memory/
│   └── preferences.md   # 用户偏好（仅顶层）
└── logs/                # 执行日志
```

4.2 事件驱动执行

· 监听 mission、子 Agent 完成与定时事件。
· 每轮执行包含拆解、派发、汇总，再进入休眠。
· SOP 变更通过 `sop.replace` 动作触发并写入事件流。

4.3 Skill 自举机制

· 通过内置工具生成新技能代码并写入 skills/。
· 生成需遵循模板与安全约束（由 skill-creator 负责）。
· 生成后的技能以事件形式记录与回放。

4.4 社区技能集成

· 提供安装工具从社区拉取技能并落盘。
· 初期需要依赖与安全校验。
· 技能分为三层：内置技能（执行器封装）> 租户私有技能（租户 FS）> 平台预制技能（共享维护）。
· 执行器在 Docker 沙箱中运行技能，带生命周期管理与资源限制。

4.5 多端同步

· 后端通过 WebSocket 推送状态，前端缓存更新。
· 移动端与 Web 端共享同一 API。

4.6 Agent 招募流程（创建期）

· 流程图：

```
用户目标输入
   ↓
招募建议生成（模板/自定义）
   ↓
用户确认招募清单
   ↓
创建 run（写入初始 Agent 清单）
   ↓
执行与状态回传（WebSocket）
```

· 创建期招募属于 run 创建流程的一部分，不触发运行期追加接口。

4.7 Agent 招募流程（运行期追加）

· 流程图：

```
运行中 run
   ↓
提交追加招募（POST /api/runs/{run_id}/agents/recruit + expected_version）
   ↓
模板/技能校验（自定义技能需 approved）
   ↓
创建 Agent 并加入当前 run
   ↓
版本号 +1 与 WebSocket 状态回传
```

· 运行期仅维护当前 run 的协作关系，不维护跨 run 的持久化架构复刻。

4.8 安全边界（招募与技能）

· 用户输入边界：用户可提交角色、技能名、说明，不可提交内部鉴权头或内部服务密钥。
· 模板边界：模板可声明内部服务调用，但端点与鉴权方式由平台白名单和服务端注入控制。
· 执行边界：技能在 Docker 沙箱执行，按租户隔离文件系统与资源配额。
· 审核边界：自定义技能未审核通过前，不得进入招募与运行链路。

5. MVP 范围与优先级

P0（必须，4 周内）

· 自然语言创建 run + 创建期初始招募（模板优先）
· 树状可视化 + WebSocket 实时状态
· Agent 基础执行引擎（FS + 事件驱动）
· 前端基础界面（指挥舱）

P1（争取，4-6 周）

· Skill 自举（初版）
· 社区技能集成（搜索/安装/调用）
· Agent 模板库（预制 Agent + 自定义技能绑定）
· Agent 招募机制（运行期追加：模板招募 + 自定义技能招募 + 审核）
· 多端协同（移动端基础查看）

P2（后续迭代）

· 记忆版本管理
· 社区模板市场
· 多用户协作
· 高级安全沙箱（容器化）

6. 关键术语解释

· 智能体（Agent）：独立运行的 AI 单元，拥有文件系统与执行循环。
· 创建期初始招募：在 run 创建前确认初始 Agent 清单，并随 run 启动一次性生效。
· 运行期追加招募：run 启动后，通过招募接口将新 Agent 追加到当前 run。
· Agent 招募：创建期初始招募与运行期追加招募的统称。
· Skill：智能体可调用的工具函数，来源可为内置/社区/自建。
· SOP：产品语境下指 TODO/计划列表，来源为 `plan.md`，前端展示为 `plan_subtasks`。当前实现仍保留 SOP 模板（`sops/templates/*.md` + `mission.md` + `/api/agents/{agent_id}/sop`），与计划列表并存。
· Session Key：Agent 标识与权限依据。
· `expected_version`：run/agent 写操作的乐观并发版本号，服务端仅在版本匹配时应用变更。

7. 成功指标（内部使用）

· 创建期上手效率：首次用户从目标输入到 run 启动耗时 P50 ≤ 60 秒，P90 ≤ 180 秒。
· 创建期初始招募确认率：在首次创建流程内完成招募确认的比例 ≥ 85%。
· 运行期追加招募成功率：`POST /api/runs/{run_id}/agents/recruit` 成功率 ≥ 95%。
· 并发冲突正确拦截率：版本冲突样本中返回 `409 VERSION_CONFLICT` 的比例 ≥ 99%。
· 自定义技能审核时效：`pending -> approved/rejected` 的处理时长 P95 ≤ 10 分钟。

7.1 边界场景与处理策略（MVP）

| 场景 | 触发条件 | 处理策略 | 返回/可观测结果 |
|---|---|---|---|
| run 状态不允许追加 | run 为 `completed/failed/cancelled` | 拒绝运行期追加招募 | `409 RUN_STATE_INVALID` |
| 模板下线或禁用 | `template_id` 不存在或状态不可用 | 拒绝新招募，不影响已在跑 Agent | `404 RUN_OR_TEMPLATE_NOT_FOUND` |
| 版本冲突 | `expected_version` 落后于当前版本 | 拒绝写入并返回当前版本用于重试 | `409 VERSION_CONFLICT` |
| 自定义技能未审核 | skill 状态为 `pending/rejected` | 阻止绑定与招募 | `403 SKILL_NOT_APPROVED` |
| 资源越权访问 | 技能尝试访问非租户允许资源 | 在沙箱侧拦截并记录审计日志 | 执行失败事件 + 安全日志 |

---

本 PRD 为产品与研发协作的统一依据，功能变更需经产品确认。
