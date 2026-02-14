# P0 开发规划 (2026-02-13)

本文档基于 `docs/decisions/positioning-2026-02-13.md` 的定位决策，给出接下来 1-2 个迭代周期的开发规划。

## 目标

在不引入复杂编排平台、不做 Vercel 子域动态部署的前提下，构建一个可长期运行的简单服务构造系统：

- 业务专家可以用自然语言描述意图
- 系统会在不确定时向用户确认
- 系统运行过程中，前端能“一眼看懂”状态与卡点
- 用户可以对运行中的任务执行干预（暂停/重试/转派）

## P0 范围 (必须完成)

### 1) 状态协议 (前端生命线)

Deliverables:

- 定义并固化事件类型集合（task/step/agent/action 四类）
- 定义任务状态机与映射规则（例如 queued/running/blocked_user/paused/succeeded/failed/canceled）
- WebSocket snapshot 与增量消息结构统一，具备可排序与可回放属性

Implementation notes (基于现有能力复用):

- 复用 `api-backend` 的 `tasks + events` 模型与 WS 广播
- 事件的 `id` 作为单调序号，客户端按序处理并去重
- `ws/world` 从“单任务 snapshot”升级为“多任务看班 snapshot”（最近 N 个任务 + agents 状态）

### 2) 干预接口 (交互差异点)

Deliverables:

- 新增统一动作入口：`POST /api/tasks/{task_id}/actions`
- 支持动作：pause/resume/retry/reassign/cancel（至少 pause/retry/reassign 三个）
- 动作可审计：动作本身进入事件流（requested/accepted/applied/rejected）

Implementation notes:

- P0 允许先“记账再执行”：即先记录 action 事件并在前端可见，再逐步让执行器兑现语义
- 执行器兑现的最小闭环：pause 生效、retry 生效、reassign 生效

### 3) 意图编译器 (NL -> 标准化任务图谱)

Deliverables:

- 新增“图谱编译”端点（建议 `/api/blueprints/compile` 或 `/api/apps/compile`）
- 输出 JSON Schema 约束的任务图谱（agents、职责、依赖、工具、状态节点、干预点）
- 支持 open questions：当图谱不完整时，返回 `open_questions[]` 要求用户确认

Implementation notes:

- 复用 `llm-gateway` 与 `LLM_DEFAULT_MODEL`
- 图谱必须可验证（Pydantic/JSON Schema）且可版本化（schema_version）

### 4) 轻量编排执行 (自研状态机)

Deliverables:

- P0 使用自研轻量状态机推进图谱执行，不依赖外部编排平台
- 运行过程持续写入 `task.step.*` 事件与 `task.*` 状态变化

Implementation notes:

- 优先落在 `agent-manager`：它已经具备队列消费、重试、写事件能力
- 先支持 mock 工具调用（见下一条），再逐步替换为真实工具

### 5) 工具模拟器工厂 (Mock API)

Deliverables:

- 为图谱中的工具生成隔离的 mock endpoint（按 tenant/app_id 隔离）
- mock 响应可配置，支持业务专家迭代调整

Implementation notes:

- P0 优先采用路径隔离而非动态 mount 路由：例如 `/mock/{app_id}/{tool}`

## 不做 (明确排除)

- Vercel 动态部署独立子域（放弃）
- 复杂工作流编排平台接入（P1 评估）
- 向量记忆、沙箱执行环境深度工程化（P2）

## 里程碑 (建议)

### Milestone A: 协议打通 (1 周)

- 状态协议 v0（多任务 snapshot + 增量事件 + agent.status）
- 干预接口 v0（pause/retry/reassign），事件可审计
- 前端“看班模式”能同时展示 3-5 条任务并响应干预

### Milestone B: 图谱编译与 mock 执行 (1-2 周)

- 意图编译器 v0（支持 open questions）
- mock 工具端点 + 轻量状态机推进
- 形成“描述意图 -> 确认 -> 运行 -> 监控 -> 干预”的闭环

## 验收标准

- 用户在前端能同时盯 3-5 个任务，快速定位卡点
- 用户触发 pause/retry/reassign 后，1 秒内在状态流里看到动作回执
- 系统遇到不确定输入时会停下来提问，而不是生成不可信的执行计划
