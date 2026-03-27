# Linpo Architecture

> 前置：`docs/prd.md`

## 1. 架构目标

在 v0.7 内，Linpo 以“看板+工具栏”单页面壳层承接编排，不扩展为多页导航体系。

核心目标：

- OpenClaw 继续作为 Agent 执行后端
- Linpo 负责流程编排交互、审批汇总与结果可视化
- 支持 Web 与 Tauri 双构建

## 2. 系统边界

- Linpo 前端：任务看板、流程编辑、审批面板、事件侧栏、产出预览、调试输入。
- Linpo 后端：聚合数据、调度编排、审批状态管理、OpenClaw 协议适配。
- OpenClaw：agent 生命周期、消息执行、会话与工具调用。

边界约束：

- 前端不直接绕过 Linpo 后端调用 OpenClaw 网关。
- OpenClaw 协议差异统一由 `Provider Adapter` 吸收。
- `claw1` 为默认联调实例，不写死到代码常量，走实例配置/环境变量。

## 3. 前端分层

- `KanbanShell`：主页面容器，承接工具栏、视图切换、任务列渲染。
- `FlowEditorPanel`：流程图生成与手动编辑。
- `ApprovalCenter`：统一审批列表与批量操作。
- `ArtifactPreviewPanel`：卡片产出详情与文件预览。
- `EventDrawer`：事件流侧边栏。
- `DebugInputBox`：上下文补充与重试触发输入。

## 4. 调度与执行模型

### 4.1 流程图到任务队列

- 输入：节点集合、依赖边集合、执行元数据。
- 解析：构建 DAG，校验环路，按拓扑序分层。
- 输出：可并行任务批次，任务写入看板队列。

### 4.2 状态机

建议状态最小集：

- `queued`
- `running`
- `blocked_by_approval`
- `failed`
- `completed`

## 5. 统一审批边界

- 所有敏感动作由后端统一归口为 `ApprovalRequest`。
- 看板中只展示可读摘要，不透出原始敏感载荷。
- 审批动作写入审计日志，支持回放。

## 6. 任务卡片扩展契约

卡片字段采用可扩展结构：

- 固定字段：`task_id`、`title`、`status`、`agent_id`、`dependencies`。
- 扩展字段：`extras: Record<string, unknown>`。
- 产出字段：`artifacts[]`（文本、结构化片段、文件引用）。

### 6.1 v0.7 任务 API 最小契约

- `GET /api/v1/boards/{board_id}/tasks`：返回当前登录用户在指定看板可见任务列表，作为看板主数据源。
- `POST /api/v1/boards/{board_id}/tasks`：创建任务并记录指派信息，创建成功后由应用层触发 OpenClaw `chat.send`。
- `POST /api/v1/boards/{board_id}/tasks/flow/generate`：根据需求生成流程图节点/边，并写入任务队列。
- v0.7 默认单看板，前端默认使用 `board_id=default`。
- 任务状态机最小集遵循 `queued/running/blocked_by_approval/failed/completed`。
- `session` 不作为任务主键来源，任务标识由 Linpo 侧生成并持久化。
- `flow.generate` 为流程页面分配专用 session：`planner`、`manager`、`execution` 前缀，用于流程拆解和任务调度链路。

## 7. 后端分层冻结

唯一调用链：

`API -> Application -> Domain Contract -> Provider Adapter -> Infra/Persistence`

分层职责：

- API：路由、鉴权、参数校验、错误封装。
- Application：流程解析、调度与审批编排。
- Domain Contract：Flow/Task/Approval/Artifact canonical 契约。
- Provider Adapter：OpenClaw RPC 与事件映射。
- Infra/Persistence：实例配置、会话、审计、重试与超时。

## 8. Tauri 构建约束

- 前端打包产物可被 Tauri WebView 加载。
- 桌面端运行时沿用同一套 API 基地址注入机制。
- 新增 Tauri 配置时不破坏现有 Web 构建脚本。

## 9. 迁移纪律

- 多页 IA 相关入口在 v0.7 迁移后不再作为主路径维护。
- 旧页面能力如需保留，仅作为过渡代码，不作为产品契约。
- 文档与实现不一致时先修文档或修实现，禁止长期漂移。

架构边界若与 `docs/prd.md` 或 `docs/test-resources.md` 冲突，以 `docs/architecture.md` 为准。
