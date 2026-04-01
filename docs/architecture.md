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
- `FlowEditorPanel`：编辑流程页需订阅 board tasks SSE 任务事件并增量更新 `flowTasks`，由任务快照反向投影节点状态到画布。
- `KanbanShell` 在“按流程分列”模式下，列头需展示流程状态并提供主动作（`中断流程/继续流程/运行流程`）与删除动作。
- `KanbanShell` 支持按列维度维护折叠状态；双击列头可在“完整列 / 折叠列”间切换，折叠态收敛为半透明窄列并移除列头，仅在顶部保留纵向省略号与渐隐背景，不卸载整页横向滚动容器。
- `KanbanShell` 未折叠列采用“内容包裹 + 列体内滚动”布局：轨道顶部对齐，列本身只增长到当前工作区可用高度上限，超出部分由列内卡片列表承担纵向滚动。
- `Layout`：维护流程导航入口缓存（`linpo.lastFlowEntryPath`），用于“点击导航栏流程时回到上次访问的编辑页”。
- `Layout`：主导航保留 `看板/流程/文件`；账户相关入口统一走导航栏用户信息下拉菜单，`/pairing` 保留兼容路由但不在主导航暴露。
- `InstanceFilesPage`：实例文件页（`/instance-files`），按实例聚合任务产出文件与 Agent 文档，提供搜索、预览、下载与关联任务跳转。
- `InstanceFilesPage`：任务产物与 Agent 文档是两条数据链，前者走 Linpo 任务文件作用域校验，后者走 OpenClaw `agents.files.list/get` 白名单文档转调。
- `MessageCenterModal`：导航栏账户下拉菜单触发的消息中心弹窗，承接“消息列表 + 详情 + 回执确认跳转”。
- `MessageCenterModal`：通过 portal 挂载到 `document.body`，避免受局部层级与滚动容器影响导致不可见。
- `AccountMenu`：下拉菜单提供 `账户/消息/实例/退出` 菜单动作；`账户`打开 `UserProfileModal`（左侧 `基本信息/修改密码/会员` 侧边栏 + 右侧展示区）。
- `AccountMenu`：下拉菜单提供 `账户/实例/消息/退出` 菜单动作。
- `UserProfileModal`：`基本信息`页提供“头像更换按钮 + 用户名编辑按钮”；`修改密码`页提供密码更新表单；`会员`页展示充值渠道占位。
- `InstanceListModal`：由账户下拉菜单“实例”触发，展示已配对实例列表、实例信息与拓扑（`实例 -> Agent -> Session`）。
- `ProfilePage`：`/profile` 作为兼容入口保留，不再作为用户主导航路径。
- `PairingTutorialPage`：配对教程页，承接“仅通过 OpenClaw 对话拿到 endpoint/token”的接入步骤说明与跳转入口。
- `PairingTutorialPage`：公开路由（匿名可访问），用于“未登录/未配对阶段”的最短接入说明，避免教程访问死锁。
- `PairingTutorialPage`：提供可复制的纯文本模板（`mount/unmount`），模板内嵌 API 路径与 JSON 参数规范，供用户直接转发给 OpenClaw 执行。
- `PairingTutorialPage`：页面内容来自仓库内 Markdown 静态文件，不再维护独立的样式化说明卡片。
- OpenClaw 读取入口使用静态文件路径 `/pairing/tutorial.md`，返回纯 Markdown 文本；`/pairing/tutorial` 仅作为人类用户导航提示页。
- 兼容路径：`/pairing/tutorial` 进入后立即执行前端重定向到 `/pairing/tutorial.md`，避免路由漏写后缀导致读取错误格式。
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
- 拆解策略：`FlowDecompositionService` 提示词需补充“路径可访问性”约束，要求节点交接文件优先使用指定临时路径，若路径受沙箱限制需提供可访问替代路径与回传说明。
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
- 调度提示词：执行端需优先写入任务指定 `temp_output_path`；若该路径不可访问，必须回退到可访问工作目录并在 `completed` 的 `artifact/message` 回传“实际路径 + 回退原因”。
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
- 看板任务列表通过独立 board realtime 通道接收任务增量事件（新增/更新/删除），用于同步卡片状态与弹窗基础信息，避免全页轮询。
- 任务详情弹窗默认进入 `基本信息` 标签页；任务进入终态后不自动切换标签页。
- `基本信息`页任务控制按钮按状态渲染：`running` 节点展示 `中断`，`blocked_by_approval` 节点展示 `继续`，其余状态按可用动作渲染或不渲染控制按钮。
- 任务产出契约：
  - 文本产出使用 Markdown 渲染；
  - 文件产出支持预览与下载；前端按 MIME 走专用渲染（JSON 树形折叠、图片/PDF/音视频内嵌）；
  - 交接文件资源仅认可 Agent 显式上报的 `artifact`（回调字段），不从普通消息文本做路径提取；
  - 后端提供任务范围内受限文件访问接口，禁止越权读取非任务关联路径。

### 6.1 v0.7 任务 API 最小契约

- `GET /api/v1/boards/{board_id}/tasks`：返回当前登录用户在指定看板可见任务列表，作为看板主数据源。
- `GET /sse/boards/{board_id}/tasks`：看板任务 SSE 实时事件通道（按当前登录用户隔离），推送 `snapshot_ready/tasks_changed/error` 事件；看板页与流程编辑页统一使用该通道同步任务与节点状态。
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
- `GET /instances/{instance_id}/files`：返回该实例下任务关联的可访问产出文件列表（含存在性与大小信息）。
- `GET /instances/{instance_id}/files/preview`：按实例+任务上下文预览文件内容（文本/JSON/二进制占位）。
- `GET /instances/{instance_id}/files/download`：按实例+任务上下文下载文件流。
- `GET /instances/{instance_id}/agent-docs`：转调 OpenClaw `agents.files.list`，返回该实例下可读 Agent 白名单文档清单。
- `GET /instances/{instance_id}/agent-docs/preview`：转调 OpenClaw `agents.files.get`，返回指定 Agent 文档预览内容。
- `GET /instances/{instance_id}/agent-docs/download`：下载指定 Agent 文档内容。
- `GET /aggregate/topology`：实例列表详情态用于构建关系树（实例节点、Agent 节点、Session 节点），前端按选中实例筛选并渲染。
- `POST /instances/pair-code/validate`、`POST /instances/pair-code`：配对码校验与配对创建契约，后端负责将配对码解析为 `endpoint/gateway_token` 再复用实例校验与落库流程。
- `POST /auth/register`：注册请求需包含 `username + email + password`，邮箱全局唯一。
- `POST /auth/login`：登录请求支持 `identifier(用户名或邮箱) + password`。
- `PATCH /auth/profile`：登录态下更新用户头像（`avatar_url`，`data:image/*;base64`）。
- `POST /auth/password`：登录态下修改密码（校验 `current_password`，更新 `new_password`）。
- `GET /instances/messages`：读取当前登录用户的消息中心列表（包含回执链接与确认状态）。
- `POST /instances/messages/{message_id}/read`：将消息标记为已读。
- `POST /instances/agent-mount/request`：免登录的 Agent 自助挂载申请，提交 `email + endpoint + gatewayToken`；后端按 email 定位用户并返回 `confirmation_url`，同时投递到用户消息中心。
- `POST /instances/agent-unmount/request`：免登录的 Agent 自助卸载申请，提交 `email + instance_id`；后端校验实例归属并返回 `confirmation_url`，同时投递到用户消息中心。
- `POST /instances/agent-receipts/{token}/confirm`：登录用户确认回执；需校验 token、TTL、一次性消费与“登录用户邮箱=回执目标邮箱”。
- 为兼容部分网关对 `DELETE` 的限制，提供等价兜底：`POST /api/v1/boards/{board_id}/tasks/{task_id}/delete`、`POST /api/v1/boards/{board_id}/tasks/requirements/{requirement_id}/delete`。
- v0.7 默认单看板，前端默认使用 `board_id=default`。
- 任务状态机最小集遵循 `queued/running/blocked_by_approval/failed/completed`。
- `session` 不作为任务主键来源，任务标识由 Linpo 侧生成并持久化。
- 实例文件接口必须做任务作用域校验：仅允许当前用户、当前实例、当前看板下任务关联路径，不开放任意绝对路径访问。
- Agent 文档接口必须只暴露 OpenClaw 白名单文件名：`AGENTS.md`、`SOUL.md`、`TOOLS.md`、`IDENTITY.md`、`USER.md`、`HEARTBEAT.md`、`BOOTSTRAP.md`、`MEMORY.md`、`memory.md`；Linpo 不自行接受任意路径输入。
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

### 7.3 Agent 自助挂载回执配置

- `LINPO_PAIRING_RECEIPT_TTL_SECONDS`：挂载/卸载回执有效期（默认 `1800` 秒）。
- 回执 token 必须一次性消费，确认成功后立即失效。
- 回执确认必须要求登录态；登录用户邮箱与回执目标邮箱不一致时必须拒绝确认。

## 8. Tauri 构建约束

- 前端打包产物可被 Tauri WebView 加载。
- 桌面端运行时沿用同一套 API 基地址注入机制。
- 新增 Tauri 配置时不破坏现有 Web 构建脚本。

## 9. 迁移纪律

- 多页 IA 相关入口在 v0.7 迁移后不再作为主路径维护。
- 旧页面能力如需保留，仅作为过渡代码，不作为产品契约。
- 文档与实现不一致时先修文档或修实现，禁止长期漂移。

架构边界若与 `docs/prd.md` 或 `docs/test-resources.md` 冲突，以 `docs/architecture.md` 为准。
