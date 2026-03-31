# Linpo Architecture

> 前置：`docs/prd.md`

## 1. 架构目标

在 v0.7 内，Linpo 以“看板 + 流程列表 + 流程编辑”承接编排主链。

核心目标：

- OpenClaw 继续作为 Agent 执行后端
- Linpo 负责流程编排交互、审批汇总与结果可视化
- 支持 Web 与 Tauri 双构建

## 2. 系统边界

- Linpo 前端：任务看板、流程列表、流程编辑、审批面板、事件侧栏、产出预览。
- Linpo 后端：聚合数据、调度编排、审批状态管理、OpenClaw 协议适配。
- OpenClaw：agent 生命周期、消息执行、会话与工具调用。

边界约束：

- 前端不直接绕过 Linpo 后端调用 OpenClaw 网关。
- OpenClaw 协议差异统一由 `Provider Adapter` 吸收。
- `claw1` 为默认联调实例，不写死到代码常量，走实例配置/环境变量。

## 3. 前端分层

- `KanbanShell`：主页面容器，承接工具栏、视图切换（状态/agent/流程）、任务列渲染。
- `FlowListPage`：所有流程列表页（我的流程目录），承接“工具栏筛选/排序 + 新建流程弹窗 + 卡片级编辑动作（重命名/删除）+ 需求拆解等待态”。
- `FlowListPage` 新建流程时，需求拆解 Agent 固定为 `claw3`（通过配置项可调整，不在 UI 暴露选择器）。
- `FlowEditorPanel`：编辑流程页，承接泳道画布编排、流程状态按钮（`运行/中断/继续`）、重命名交互与底部悬浮指令对话框（增量改图）。
- `KanbanShell` 在“按流程分列”模式下，列头需展示流程状态并提供主动作（`中断流程/继续流程/运行流程`）与删除动作。
- `Layout`：维护流程导航入口缓存（`linpo.lastFlowEntryPath`），用于“点击导航栏流程时回到上次访问的编辑页”。
- `PairingPage`：OpenClaw 实例页，承接“左侧实例列表 + 右侧主工作区”；右侧支持实例详情区块与新建配对双标签（Token/配对码）。
- `PairingTutorialPage`：配对教程页，承接“仅通过 OpenClaw 对话拿到 endpoint/token”的接入步骤说明与跳转入口。
- 三个主工作页（`KanbanShell/FlowListPage/FlowEditorPanel`）共用贴顶扁平工具栏样式 token，保持一致的视觉与层级。
- `ApprovalCenter`：统一审批列表与批量操作。
- `ArtifactPreviewPanel`：卡片产出详情与文件预览。
- `EventDrawer`：事件流侧边栏。

## 4. 调度与执行模型

### 4.1 流程图到任务队列

- 输入：节点集合、依赖边集合、执行元数据。
- 解析：构建 DAG，校验环路，按拓扑序动态分层并分配执行 Agent。
- 输出：可并行任务批次，任务写入看板队列。
- 拆解策略：`FlowDecompositionService` 提示词需优先生成“可并行”的分支结构，并在节点描述中给出“可委派 subagent 并行执行”的建议，避免过度串行化。
- 前端 `FlowEditorPanel` 必须支持节点/连接的本地编辑能力：`node create/update/delete` 与 `edge create/delete`，确认入板时提交最新画布状态。
- 流程画布采用“横向泳道列 + 顶部冻结泳道标题行”；双击顶部空白区创建泳道，双击泳道标题编辑泳道名称与委派 Agent。
- 节点以双击画布弹窗创建、双击节点弹窗编辑；节点上下左右提供连接点用于连线。
- 节点字段最小集包含 `title + description`，其中 `description` 用于执行上下文与任务摘要补充。
- 节点创建坐标决定归属泳道；泳道宽度按内部节点占用自适应，右侧泳道顺延。
- 节点拖拽允许跨泳道移动；跨泳道时同步更新节点泳道归属与默认执行 Agent。
- 连线交互采用连接点拖拽，边渲染按节点相对位置动态选择最短接入点组合。
- 流程编辑页保留底部悬浮对话框；发送规划指令时需携带当前 `nodes/edges` 作为上下文，并在请求期间冻结画布编辑。
- 前端不再提供 `L1~Lx` 手工编辑；`layer` 仅作为兼容字段，在运行流程前由拓扑算法动态回填。
- 节点间数据交换约束为临时文件通道（`temp file`），执行提示词与任务元数据保持一致。
- 单流程即单实例：`运行`将流程节点写入看板并进入运行态，不再创建多实例记录。
- 流程运行态冻结编辑；流程被中断进入阻塞态后允许编辑未执行节点，并通过后端同步接口回写看板任务。

### 4.2 状态机

建议状态最小集：

- `queued`
- `running`
- `blocked_by_approval`
- `failed`
- `completed`

### 4.3 执行事件链（v0.7）

- 主链：`queued -> running -> completed/failed/blocked_by_approval` 仅由 `task-run event callback` 推进。
- 事件入口：`POST /api/v1/boards/{board_id}/tasks/task-runs/{run_id}/events`。
- 事件类型：`started / heartbeat / progress / need_approval / completed / failed`。
- 幂等保障：事件携带 `idempotencyKey`，后端按 run 维度去重。
- 调度推进：每次入队、每次终态事件（`completed/failed/need_approval`）后，只拉取一个可执行 `queued` 任务投放。
- 补偿副链：仅在 `running` 长时间无 heartbeat 时触发低频巡检，转 `failed(stale_timeout)` 后再推进下一任务。

## 5. 统一审批边界

- 所有敏感动作由后端统一归口为 `ApprovalRequest`。
- 看板中只展示可读摘要，不透出原始敏感载荷。
- 审批动作写入审计日志，支持回放。

## 6. 任务卡片扩展契约

卡片字段采用可扩展结构：

- 固定字段：`task_id`、`title`、`status`、`agent_id`、`dependencies`。
- 扩展字段：`extras: Record<string, unknown>`。
- 产出字段：`artifacts[]`（文本、结构化片段、文件引用）。
- 需求分组字段：`extras.requirement_id`、`extras.requirement_title`（支持按需求分列、筛选、批量删除）。
- 详情弹窗字段：采用三标签页结构（`基本信息 / 执行流程 / 任务产出`）；消息流按“每节点一个 session”原则，仅使用 `execution_session_key`：先读 `chat.history`，再订阅 `session:{key}:messages` 实时增量。
- 任务详情弹窗默认进入 `基本信息` 标签页；任务进入终态后不自动切换标签页。
- `基本信息`页任务控制按钮按状态渲染：`running` 节点展示 `中断`，`blocked_by_approval` 节点展示 `继续`，其余状态按可用动作渲染或不渲染控制按钮。
- 任务产出契约：
  - 文本产出使用 Markdown 渲染；
  - 文件产出支持预览与下载；前端按 MIME 走专用渲染（JSON 树形折叠、图片/PDF/音视频内嵌）；
  - 交接文件资源仅认可 Agent 显式上报的 `artifact`（回调字段），不从普通消息文本做路径提取；
  - 后端提供任务范围内受限文件访问接口，禁止越权读取非任务关联路径。

### 6.1 v0.7 任务 API 最小契约

- `GET /api/v1/boards/{board_id}/tasks`：返回当前登录用户在指定看板可见任务列表，作为看板主数据源。
- `POST /api/v1/boards/{board_id}/tasks`：创建任务并记录指派信息，创建成功后由应用层触发 OpenClaw `chat.send`。
- `POST /api/v1/boards/{board_id}/tasks/flow/generate`：根据需求生成流程图节点/边草稿，不落看板任务；支持可选 `current_nodes/current_edges/planner_session_key` 以在已有流程上增量改图。
- `POST /api/v1/boards/{board_id}/tasks/flow/confirm`：确认草稿后创建 `queued` 任务并触发队列调度。
- `POST /api/v1/boards/{board_id}/tasks/{task_id}/interrupt`：中断指定任务；若任务处于运行态，后端请求 OpenClaw `chat.pause` 并将任务落为终态，再触发队列推进。
- `POST /api/v1/boards/{board_id}/tasks/{task_id}/continue`：继续阻塞任务；中断型阻塞恢复为 `queued` 并重新调度，审批型阻塞标记为 `completed` 并推进后续节点。
- `POST /api/v1/boards/{board_id}/tasks/requirements/{requirement_id}/rename`：重命名流程（回写同需求下节点的 `requirement_title`）。
- `POST /api/v1/boards/{board_id}/tasks/requirements/{requirement_id}/stop`：中断流程（阻断运行中节点并阻断后续调度）；看板“删除流程”先调用该接口再执行整组删除。
- `POST /api/v1/boards/{board_id}/tasks/requirements/{requirement_id}/continue`：继续流程（将被中断阻塞的节点恢复入队并推进调度）。
- `POST /api/v1/boards/{board_id}/tasks/requirements/{requirement_id}/sync`：阻塞态流程画布回写（仅同步未执行节点到看板任务）。
- `POST /api/v1/boards/{board_id}/tasks/task-runs/{run_id}/events`：执行端回调任务运行事件，驱动状态流转与下一任务调度。
- `GET /api/v1/boards/{board_id}/tasks/{task_id}/output-preview`：按任务关联路径返回文件预览元数据（文本/JSON 预览内容、二进制占位、下载地址）。
- `GET /api/v1/boards/{board_id}/tasks/{task_id}/output-file`：按任务关联路径返回文件流（支持 inline/attachment）。
- `DELETE /api/v1/boards/{board_id}/tasks/{task_id}`：删除单个需求节点；若该节点被同需求下游节点依赖，后端移除对应依赖并重算可调度任务。
- `DELETE /api/v1/boards/{board_id}/tasks/requirements/{requirement_id}`：删除整组需求节点（同 `requirement_id`）。
- `GET/POST/PATCH/DELETE /instances*`：OpenClaw 实例配对管理契约，配对成功后前端写入 `linpo.currentInstanceId` 作为默认实例上下文。
- `POST /instances/pair-code/validate`、`POST /instances/pair-code`：配对码校验与配对创建契约，后端负责将配对码解析为 `endpoint/gateway_token` 再复用实例校验与落库流程。
- 为兼容部分网关对 `DELETE` 的限制，提供等价兜底：`POST /api/v1/boards/{board_id}/tasks/{task_id}/delete`、`POST /api/v1/boards/{board_id}/tasks/requirements/{requirement_id}/delete`。
- v0.7 默认单看板，前端默认使用 `board_id=default`。
- 任务状态机最小集遵循 `queued/running/blocked_by_approval/failed/completed`。
- `session` 不作为任务主键来源，任务标识由 Linpo 侧生成并持久化。
- `flow.generate` 为流程页面分配专用 session：`planner:claw3`、`manager`、`execution` 前缀，用于流程拆解和任务调度链路。
- 流程拆解逻辑不在前端执行，统一由后端 `FlowDecompositionService` 通过 `claw3`（OpenClaw 实例）产出结构化节点 JSON。
- 流程创建入口仍由 `FlowListPage` 新建弹窗承接；`FlowEditorPanel` 底部悬浮对话框用于后续增量改图（同样调用 `flow.generate`）。
- 配对入口支持用户自有 OpenClaw（如 `claw2`）；Linpo 不要求用户先配置多页面，只需完成一次实例配对即可进入看板与流程主链。
- 调度策略：每次入队后立即从 `queued` 取一个“依赖满足”的任务投放执行；任务完成后再推进下一项。未完成任务保持 `running`，敏感终态进入 `blocked_by_approval`。
- 流程运行不再引入 `flow_instance_id` 多实例隔离；依赖判定键回归 `flow_id + flow_node`。
- v0.7 完成判定主路径采用 `task-run event callback`，`chat.history` 不参与主判定。

## 7. 后端分层冻结

唯一调用链：

`API -> Application -> Domain Contract -> Provider Adapter -> Infra/Persistence`

分层职责：

- API：路由、鉴权、参数校验、错误封装。
- Application：流程解析、调度与审批编排。
- Domain Contract：Flow/Task/Approval/Artifact canonical 契约。
- Provider Adapter：OpenClaw RPC 与事件映射。
- Infra/Persistence：实例配置、会话、审计、重试与超时。

### 7.1 拆解服务配置（claw3）

- `FLOW_DECOMPOSITION_OPENCLAW_BASE_URL`：拆解服务网关地址（默认 `ws://175.178.213.10:38789`）。
- `FLOW_DECOMPOSITION_OPENCLAW_GATEWAY_TOKEN`：拆解服务 Token（默认 claw3）。
- `FLOW_DECOMPOSITION_OPENCLAW_ORIGIN`：拆解服务 Origin（默认 `http://127.0.0.1:38789`）。
- `FLOW_DECOMPOSITION_AGENT_ID`：拆解服务使用的 agent（默认 `main`）。

### 7.2 任务事件回调配置

- `LINPO_TASK_EVENT_CALLBACK_BASE_URL`：写入任务投放提示词的回调基地址（默认 `http://127.0.0.1:8000`）。
- 未显式配置 `LINPO_TASK_EVENT_CALLBACK_BASE_URL` 时，后端会优先根据实例 endpoint 推导公网回调地址（host 不变，端口默认 `8000`），并附带 `127.0.0.1` 本地地址作为候选兜底。
- `LINPO_TASK_EVENT_CALLBACK_PORT`：未显式配置回调基地址时，推导公网回调地址使用的端口（默认 `8000`）。
- `LINPO_TASK_RUN_STALE_SECONDS`：`running` 无 heartbeat 的超时阈值（默认 `900` 秒，最小 `60` 秒）。

## 8. Tauri 构建约束

- 前端打包产物可被 Tauri WebView 加载。
- 桌面端运行时沿用同一套 API 基地址注入机制。
- 新增 Tauri 配置时不破坏现有 Web 构建脚本。

## 9. 迁移纪律

- 多页 IA 相关入口在 v0.7 迁移后不再作为主路径维护。
- 旧页面能力如需保留，仅作为过渡代码，不作为产品契约。
- 文档与实现不一致时先修文档或修实现，禁止长期漂移。

架构边界若与 `docs/prd.md` 或 `docs/test-resources.md` 冲突，以 `docs/architecture.md` 为准。
