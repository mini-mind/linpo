# Linpo Architecture

> 前置：`docs/prd.md`

## 1. 架构目标

在 v0.7 内，Linpo 以“摘要 + 看板 + 流程列表 + 流程编辑 + 文件”承接编排主链。

核心目标：

- OpenClaw 继续作为 Agent 执行后端
- Linpo 负责流程编排交互、审批汇总与结果可视化
- 支持 Web 与 Tauri 双构建

## 2. 系统边界

- Linpo 前端：摘要页、任务看板、流程列表、流程编辑、消息中心、实例/账户弹窗、产出预览。
- Linpo 后端：聚合数据、调度编排、审批状态管理、OpenClaw 协议适配。
- OpenClaw：agent 生命周期、消息执行、会话与工具调用。

边界约束：

- 前端不直接绕过 Linpo 后端调用 OpenClaw 网关。
- OpenClaw 协议差异统一由 `Provider Adapter` 吸收。
- `claw1` 为默认联调实例，不写死到代码常量，走实例配置/环境变量。

## 3. 前端分层

- `KanbanShell`：主页面容器，承接工具栏、视图切换（状态/agent/流程）、任务列渲染。
- `SummaryPage`：摘要页（`/summary`）不再提供独立顶部工具栏；页面主体直接展示 token 消耗趋势曲线、待审批卡片列表与事件流侧栏。
- `SummaryPage`：审批卡片复用看板 `Task` 数据源与 `continue` 动作，不新增独立审批实体接口；卡片内不再提供“打开看板”跳转。事件流复用聚合层 `global_events`。
- `SummaryPage`：若实例支持 OpenClaw `usage.cost`，曲线展示 token 日序列；否则切换为任务节点数量时间序列，并在 UI 标明当前指标类型。
- `SummaryPage`：事件流筛选完全在前端本地完成，不新增后端筛选接口；仅保留关键字筛选，结果按分页展示，单页最多 10 条。
- `SummaryPage`：移动端采用单列堆叠布局，审批列表与事件流保留各自的内部滚动区域；事件流筛选与分页控件允许在小屏下自然换行或堆叠。
- `SummaryPage`：事件卡片默认展开，展示实例、Agent、类型与完整描述；不再提供分类按钮组或“全部展开”动作。
- `SummaryPage`：整体页面壳与 `InstanceFilesPage` 主内容区对齐；普通桌面维持稳定留白，超宽屏时整体居中并限制最大内容宽度，避免统计图与左右分栏过度拉伸。
- `FlowEditorPanel`：编辑流程页，不再提供顶部独立工具栏；当前打开流程的侧栏卡片承担主`运行`入口，流程级 `重命名/删除/运行/中断/继续` 收敛到左侧流程列表项的编辑弹窗。
- `FlowEditorPanel`：编辑流程页需订阅 board tasks SSE 任务事件并增量更新 `flowTasks`，由任务快照反向投影节点状态到画布；左侧流程侧栏复用 Flow 与草稿索引数据源，并承接流程切换与新建流程能力。
- `FlowEditorPanel`：流程列表渲染采用 `草稿 / 已提交` 两组视图；当前打开流程保留在所属分组内，仅通过激活态高亮，不再单独抽成“当前”分组。
- `FlowEditorPanel`：各分组内的流程项按最后编辑时间倒序排列；当前打开流程不能因为路由激活而改写排序。
- `FlowEditorPanel`：左侧流程侧栏头部仅保留标题与同行右侧“新建”按钮，不再保留筛选器、排序器或补充说明文案。
- `FlowEditorPanel`：移动端不依赖双击手势承载核心编辑能力；画布内需暴露显式节点动作入口，至少覆盖 `新建节点/编辑已选节点/打开流程列表`。
- `FlowEditorPanel`：流程新建弹窗固定使用 `claw3` 作为拆解 Agent（后续可通过配置切换，不在 UI 暴露选择器）。
- `FlowEditorPanel`：移动端将左侧流程列表改为抽屉式侧栏，默认收起；画布内显式入口负责打开/关闭抽屉，抽屉内部继续复用桌面端的流程切换与新建动作。
- `FlowEditorPanel`：移动端流程抽屉需处理焦点迁移：打开时聚焦当前流程项（若不存在则聚焦抽屉内首个可操作按钮），关闭时将焦点还给画布内的流程列表触发按钮。
- `FlowEditorPanel`：底部悬浮规划窗口改为“紧凑对话框 + 按需展开消息流”模式；不再展示 title/描述文案，焦点进入浮窗或消息流时自动展开，焦点回到画布等区域时自动收起。
- `FlowEditorPanel`：流程规划消息流不再依赖 `flow.generate` 响应里的静态 `messages` 字段，改为在发送前确定 `planner_session_key`，随后通过 SSE 订阅该 planner session 的增量消息；消息需由 Linpo 后端持久化保存，以支持刷新恢复。
- `FlowEditorPanel`：流程图更新同样走 planner SSE，而不是等待 `flow.generate` 一次性返回整图；前端按收到的节点级补丁实时改写本地草稿，再由 `depends_on` 即时派生边。
- `FlowEditorPanel`：折叠态仅保留半透明单输入框，placeholder 固定为 `输入您的需求，自动规划流程`，且不再渲染额外外层边框；展开态中消息流位于输入框上方，若无历史消息则保持空白，发送按钮位于输入框下一行最右侧，左侧展示 `Enter 发送 / Shift+Enter 换行` 灰色说明。
- `FlowEditorPanel`：规划浮窗在展开或收到新消息时需自动滚动到底部；页面布局不得因浮窗常驻而制造额外底部留白，画布可视区需尽量填满剩余空间。
- `FlowEditorPanel`：发送规划请求期间，浮窗主按钮由`发送`切换为`停止`；在 planner session 进入终态前，画布持续显示半透明遮罩并冻结人工编辑，不能因首个 HTTP 响应或临时 SSE 静默而提前解除。
- `KanbanShell` 在“按流程分列”模式下，列头需展示流程状态并提供主动作（`中断流程/继续流程/运行流程`）；删除流程统一留在 `FlowEditorPanel` 当前流程详情中处理。
- `KanbanShell` 支持按列维度维护折叠状态；双击列头可在“完整列 / 折叠列”间切换，折叠态收敛为半透明窄列并移除列头，仅在顶部保留纵向省略号与渐隐背景，不卸载整页横向滚动容器。
- `KanbanShell` 未折叠列采用“内容包裹 + 列体内滚动”布局：轨道顶部对齐，列本身只增长到当前工作区可用高度上限，超出部分由列内卡片列表承担纵向滚动。
- `KanbanShell` 响应式分三档：`default` 左对齐横向滚动、`narrow-mobile` 单列分页式查看并支持触摸左右切换列；不再为超宽屏单独居中轨道，但工作区容器仍保持满高；三档共享同一列数据与状态源，不复制渲染逻辑。
- `Layout`：维护流程导航入口缓存（`linpo.lastFlowEntryPath`），用于“点击导航栏流程时回到上次访问的编辑页”。
- `Layout`：主导航保留 `摘要/看板/流程/文件`；账户相关入口统一走导航栏用户信息下拉菜单，不再提供 `/pairing` 与 `/profile` 独立页面路由入口。
- `Layout`：移动端主导航不得换成隐藏菜单；保留同一行主导航，但导航区本身需成为横向滚动容器，品牌区与账户入口固定在两侧。
- `Layout`：全站滚动所有权归 `main` 工作区；`html/body/#root` 只承担满高，不再直接滚动，避免移动端双滚动冲突影响看板/流程/摘要等内部滚动区域。
- `InstanceFilesPage`：实例文件页（`/instance-files`），按实例聚合任务产出文件与 Agent 文档，提供搜索、预览、下载与关联任务跳转。
- `InstanceFilesPage`：不再提供独立工具栏；实例选择、搜索与刷新动作合并进左侧资源侧栏头部。
- `InstanceFilesPage`：左侧资源侧栏头部固定为两行：首行是实例选择下拉与右侧刷新按钮，次行是搜索框；下方资源树以“实例名”为根节点映射工作区真实路径，并支持目录递归展开。
- `InstanceFilesPage`：桌面端侧栏宽度允许用户通过拖拽分隔条手动调整；预览区头部仅保留文件信息与下载动作，不再提供“回看板”快捷操作。
- `InstanceFilesPage`：文件树叶子节点采用紧凑树项样式，仅展示文件类型图标与文件名；`配置/产出`、流程、节点、Agent、路径、更新时间等附加信息收敛到右侧预览头部与元信息区，不再在左侧做卡片化展示。
- `InstanceFilesPage`：右侧主内容区占满侧栏之外的剩余空间，但预览内容本身需要受单独 `max-width` 约束并水平居中，避免文本/图片在超宽屏失控拉伸。
- `InstanceFilesPage`：任务产物与 Agent 文档是两条数据链，前者走 Linpo 任务文件作用域校验，后者走 OpenClaw `agents.files.list/get` 白名单文档转调。
- `MessageCenterModal`：导航栏账户下拉菜单触发的消息中心弹窗，承接“消息列表 + 详情 + 回执确认跳转”。
- `MessageCenterModal`：通过 portal 挂载到 `document.body`，避免受局部层级与滚动容器影响导致不可见。
- `AccountMenu`：下拉菜单提供 `账户/实例/消息/退出` 菜单动作；`账户`打开 `UserProfileModal`（左侧 `基本信息/修改密码/会员` 侧边栏 + 右侧展示区）。
- `UserProfileModal`：`基本信息`页提供“头像更换按钮 + 用户名编辑按钮”；`修改密码`页提供密码更新表单；`会员`页展示充值渠道占位。
- `InstanceListModal`：由账户下拉菜单“实例”触发，展示已配对实例列表、实例信息与拓扑（`实例 -> Agent -> Session`）；当用户进入`/kanban`且无实例时自动弹出。
- `InstanceListModal`：添加实例页支持`配对会话`、`Token`两种方式；默认打开`配对会话`标签页，`Token`作为第二标签页。
- `InstanceListModal`：配对会话页由 Linpo 创建短时会话，展示 `short_code + pairing_url` 并轮询状态；OpenClaw 侧 attach 成功后自动落库实例并切换到实例详情。
- 两个主工作页（`KanbanShell/FlowEditorPanel`）曾共用贴顶扁平工具栏样式 token；当前仅 `KanbanShell` 继续保留顶栏，`FlowEditorPanel` 改为画布内悬浮动作。
- `SummaryPage` 维持受限宽页面壳：`page gutter + content max-width` 共用一组 token，避免统计页在超宽屏过度拉伸。
- `InstanceFilesPage` 不再复用 `SummaryPage` 的桌面壳宽约束；桌面端以贴边侧栏 + 自适应主内容区为主，移动端再退化为单列。
- `KanbanShell` 顶部工具栏不再受 `max-width` 约束：工具栏内容直接铺满可用横向空间，仅保留页面内边距与移动端换行/横滑能力。
- 页面壳样式应收敛到共用 helper/token（如 `page / shell / inner width`），避免 Summary、InstanceFiles 再次出现宽度与留白漂移。
- `KanbanShell/FlowEditorPanel/InstanceFilesPage` 在移动端共享一组页面壳约束：工具栏允许换行或内部横滑承载控件，主体优先退化为单列布局，重内容区域通过局部滚动保持可操作。
- 全站表单控件尺寸约束需统一：`input/textarea/select` 默认采用 `box-sizing: border-box`、`min-width: 0`、`max-width: 100%`，避免在 flex/grid 容器中向右溢出。
- `ArtifactPreviewPanel`：卡片产出详情与文件预览。

## 4. 调度与执行模型

### 4.1 流程图到任务队列

- 输入：节点集合、依赖边集合、执行元数据。
- 解析：构建 DAG，校验环路，按拓扑序动态分层并分配执行 Agent。
- 输出：可并行任务批次，任务写入看板队列。
- 拆解策略：`FlowDecompositionService` 提示词需优先生成“可并行”的分支结构，并在节点描述中给出“可委派 subagent 并行执行”的建议，避免过度串行化。
- 拆解策略：`FlowDecompositionService` 提示词需补充“路径可访问性”约束；节点交接文件优先使用指定临时路径，且可预览、可下载的产物路径统一限制在 `/tmp/linpo/**`。
- 前端 `FlowEditorPanel` 必须支持节点/连接的本地编辑能力：`node create/update/delete` 与 `edge create/delete`，确认入板时提交最新画布状态。
- 流程画布继续保留泳道列，用于承载不同实例/Agent 负责的节点；节点在所属泳道内编辑、拖拽与连线。
- 节点以双击画布弹窗创建、双击节点弹窗编辑；节点上下左右提供连接点用于连线。
- 触屏环境保留双击快捷操作但不能依赖它作为唯一入口；需提供画布内显式按钮触发节点创建与节点编辑，单击节点用于选中后再编辑。
- 节点字段最小集包含 `title + description`，其中 `description` 用于执行上下文与任务摘要补充。
- 连线交互采用连接点拖拽，边渲染按节点相对位置动态选择最短接入点组合。
- 流程编辑页左侧改为流程列表侧栏；发送规划指令时需携带当前 `nodes/edges` 作为上下文，并在请求期间冻结画布编辑。
- 流程图 canonical 结构是 `nodes[].depends_on`；`edges` 属于前端/后端根据节点快照计算出的派生表示，仅用于画布渲染和兼容已有提交接口。
- 流程规划改为“节点级 patch 流”而非“整图 JSON commit”：Linpo 维护独立的持久化 `planner session`，记录 `messages/current_nodes/revision/status`，并在每次有效增量后产出最新节点快照。
- 节点级 patch 最小集合冻结为：`upsert_node`（创建/更新节点，包含完整 `id/title/description/depends_on/sensitive`）与 `delete_node`（按 `id` 删除节点）。节点依赖变更必须通过 `upsert_node.depends_on` 表达，不再定义独立 edge patch。
- `FlowDecompositionService` 负责向 `claw3` 发起规划会话，但不再依赖 claw3 最终回整图 JSON 作为主链；主链改为 claw3 在会话中调用 Linpo planner HTTP 接口进行 `upsert_node/delete_node/complete/fail`。
- Planner HTTP 接口必须携带 `planner_token`；Linpo 在收到每次节点编辑请求后，先落持久化消息，再更新 draft snapshot/revision，并通过 SSE 推送 `planner_messages_updated / planner_nodes_patched / planner_snapshot_updated / planner_session_updated`。
- `complete` 接口负责对最终节点集执行完整校验：节点数、唯一 id、`depends_on` 引用合法、至少一个 `sensitive=true`。校验通过才将 planner session 置为 `completed`；否则写入失败消息并保持会话 `failed`。
- `stop` 接口由前端触发，Linpo 需同时落会话状态、写入消息流，并通过 Provider `chat.pause` 中断 claw3 对应 session。
- `FlowEditorPanel` 应用 patch 后立即重算派生边；若 SSE 重连、丢序或解析失败，则请求当前 draft snapshot 并整体替换本地 nodes，再继续接收后续 patch。
- 流程规划消息流与输入框回到画布底部悬浮窗口：同一浮层内承载消息流与输入框，不再占据左侧主列，也不再展示额外标题或说明文本。
- 浮层与画布的空间分配遵循“最小常驻占位”原则：收起态仅保留紧凑输入区，展开态按内容浮起显示，不为页面制造固定大块底部留白。
- 浮层展开结构固定为“消息流在上、输入框在下”；消息流为空时不渲染占位提示文案。
- 前端不再提供 `L1~Lx` 手工编辑；`layer` 仅作为兼容字段，在运行流程前由拓扑算法动态回填。
- 节点间数据交换约束为临时文件通道（`temp file`），执行提示词与任务元数据保持一致。
- 单流程支持跨实例协作：`运行`时允许节点按泳道绑定不同实例/Agent，并按节点目标实例写入看板任务。
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
- 完整性校验：新投放任务会下发一次性 `callbackToken`，执行端需以 `callbackToken` 作为 HMAC key，对 `runId/eventType/idempotencyKey/requestId/message/artifact/occurredAt` 的升序紧凑 JSON 计算 `HMAC-SHA256` 后回传 `callbackSignature`。
- 调度推进：每次入队、每次终态事件（`completed/failed/need_approval`）后，只拉取一个可执行 `queued` 任务投放。
- 调度提示词：执行端需优先写入任务指定 `temp_output_path`；若该路径受沙箱限制不可写，不得静默回退到其他目录并宣告 `completed`，必须回调 `failed` 并写明不可访问路径与原因。
- 补偿副链：仅在 `running` 长时间无 heartbeat 时触发补偿巡检，转 `failed(stale_timeout)` 后再推进下一任务；当前实现由任务读取链路触发该巡检（非独立后台定时任务）。

## 5. 统一审批边界

- 所有敏感动作由后端统一归口为 `ApprovalRequest`。
- v0.7 实现独立“摘要/审批中心”页面；审批入口同时落在摘要页审批卡片与看板节点状态中，由同一 `blocked_by_approval` 状态承载。
- 看板中只展示可读摘要，不透出原始敏感载荷。
- 审批动作写入审计日志，支持回放。

## 6. 聚合与摘要统计

- `AggregateService` 继续作为摘要页聚合入口，输出实例诊断、事件流与统计曲线。
- token 统计优先通过 Provider 主链转调 OpenClaw `usage.cost`，不得绕过 `ProviderApplicationService -> ProviderAdapter -> OpenClawClient` 分层。
- `AggregateOverviewResponse.stats.total_tokens` 应返回当前聚合窗口内的 token 总量；`token_groups[]` 返回按实例分组的时间序列样本。
- token 曲线样本最小字段保持 `label/input_tokens/output_tokens/total_tokens`，前端按实例名分组绘图。
- 当某实例 `usage.cost` 不可用或返回异常时，聚合层允许对该实例返回空 token 样本；若全部实例均不可用，前端改用本地任务节点时间序列作为兜底显示。

## 7. 任务卡片扩展契约

卡片字段采用可扩展结构：

- 固定字段：`task_id`、`title`、`status`、`agent_id`、`dependencies`。
- 扩展字段：`extras: Record<string, unknown>`。
- 产出字段：`artifacts[]`（文本、结构化片段、文件引用）。
- 流程分组字段：`extras.requirement_id`、`extras.requirement_title`（支持按流程分列、流程名展示与整组删除）。
- 详情弹窗字段：采用三标签页结构（`基本信息 / 执行流程 / 任务产出`）；消息流按“每节点一个 session”原则，仅使用 `execution_session_key`：先读 `chat.history`，再订阅 `session:{key}:messages` 实时增量。
- 看板任务列表通过独立 board realtime 通道接收任务增量事件（新增/更新/删除），用于同步卡片状态与弹窗基础信息，避免全页轮询。
- 任务详情弹窗默认进入 `基本信息` 标签页；任务进入终态后不自动切换标签页。
- `基本信息`页任务控制按钮按状态渲染：`running` 节点展示 `中断`，`blocked_by_approval` 节点展示 `继续`，其余状态按可用动作渲染或不渲染控制按钮。
- 任务产出契约：
  - 文本产出使用 Markdown 渲染；
  - 文件产出支持预览与下载；前端按 MIME 走专用渲染（JSON 树形折叠、图片/PDF/音视频内嵌）；
  - 交接文件资源仅认可 Agent 显式上报的 `artifact`（回调字段），不从普通消息文本做路径提取；
  - 后端提供任务范围内受限文件访问接口，禁止越权读取非任务关联路径。

### 7.1 v0.7 任务 API 最小契约

- 对外 API 路径统一采用 `/api/v1/**`；不再保留历史无前缀兼容别名。
- `GET /api/v1/boards/{board_id}/tasks`：返回当前登录用户在指定看板可见任务列表，作为看板主数据源。
- `GET /api/v1/sse/boards/{board_id}/tasks`：看板任务 SSE 实时事件通道（按当前登录用户隔离），推送 `snapshot_ready/tasks_changed/error` 事件；看板页与流程编辑页统一使用该通道同步任务与节点状态。支持可选查询参数 `instanceId`（UUID）：
  - 未传 `instanceId`：保持现有行为，返回当前用户在该 board 的全部任务事件。
  - 传入合法且归属当前用户的 `instanceId`：`snapshot_ready` 仍按原契约返回，`tasks_changed` 仅返回该实例相关事件。
  - `instanceId` 非法 UUID 返回 `422`；`instanceId` 不属于当前登录用户返回 `404`。
- `POST /api/v1/boards/{board_id}/tasks`：创建任务并记录指派信息，创建成功后由应用层触发 OpenClaw `chat.send`。
- `POST /api/v1/boards/{board_id}/tasks/flow/generate`：启动或续接一次 planner 增量编辑会话，不直接落看板任务；支持可选 `current_nodes/current_edges/planner_session_key` 以在已有流程上增量改图。后端固定以 `claw3` 作为 planner 目标，先持久化用户消息、当前工作流快照与 planner session 状态，再把“历史消息 + 当前快照 + 本次需求 + planner HTTP 接口信息”发送给 `claw3`。响应至少返回 `planner_session_key` 与当前 draft snapshot，不再要求等待完整整图生成结束。
- `GET /api/v1/boards/{board_id}/tasks/flow/planner-sse?sessionKey=...`：流程规划 SSE 通道；固定连接 `FlowDecompositionService` 的 `claw3` planner session，除 `snapshot_ready/planner_messages_updated/error` 外，还需推送图补丁事件与快照事件，供流程页在消息流外同步实时改图。
- 图补丁事件最小集合冻结为 `planner_nodes_patched` 与 `planner_snapshot_updated`：
  - `planner_nodes_patched`：负载包含 `session_key/revision/operations[]`，其中操作仅允许 `upsert_node/delete_node`。
  - `planner_snapshot_updated`：负载包含 `session_key/revision/nodes[]`，前端用于重连首屏或重同步纠偏。
- `GET /api/v1/boards/{board_id}/tasks/flow/planner-sse` 还需推送 `planner_session_updated`，至少包含 `session_key/status/revision/updated_at`，用于前端维持“遮罩/停止按钮/恢复编辑”状态。
- `POST /api/v1/boards/{board_id}/tasks/flow/planner-stop`：前端停止当前 planner 会话；后端需落持久化状态并尝试暂停 `claw3`。
- `GET /api/v1/boards/{board_id}/tasks/flow/drafts`：返回当前登录用户在该看板下的流程草稿列表（后端真源）。
- `POST /api/v1/boards/{board_id}/tasks/flow/drafts`：新增或更新流程草稿，落库字段至少覆盖 `nodes/edges/planner_messages/lanes/node_lane_by_id` 与 session 元数据。
- `DELETE /api/v1/boards/{board_id}/tasks/flow/drafts/{flow_id}`：删除指定流程草稿。
- `POST /api/v1/boards/{board_id}/tasks/flow/planner-sessions/{session_key}/nodes/upsert`：planner 内部接口，基于 token 单节点创建或更新。
- `POST /api/v1/boards/{board_id}/tasks/flow/planner-sessions/{session_key}/nodes/delete`：planner 内部接口，基于 token 删除单节点。
- `POST /api/v1/boards/{board_id}/tasks/flow/planner-sessions/{session_key}/complete`：planner 内部接口，提交最终节点集并触发完整校验。
- `POST /api/v1/boards/{board_id}/tasks/flow/planner-sessions/{session_key}/fail`：planner 内部接口，写入失败原因并结束会话。
- `POST /api/v1/boards/{board_id}/tasks/flow/confirm`：确认草稿后创建 `queued` 任务并触发队列调度。
- `POST /api/v1/boards/{board_id}/tasks/{task_id}/interrupt`：中断指定任务；若任务处于运行态，后端请求 OpenClaw `chat.pause` 并将任务落为终态，再触发队列推进。
- `POST /api/v1/boards/{board_id}/tasks/{task_id}/continue`：继续阻塞任务；中断型阻塞恢复为 `queued` 并重新调度，审批型阻塞标记为 `completed` 并推进后续节点。
- `POST /api/v1/boards/{board_id}/tasks/requirements/{requirement_id}/rename`：重命名流程（回写同需求下节点的 `requirement_title`）。
- `POST /api/v1/boards/{board_id}/tasks/requirements/{requirement_id}/stop`：中断流程（阻断运行中节点并阻断后续调度）；看板“删除流程”先调用该接口再执行整组删除。
- `POST /api/v1/boards/{board_id}/tasks/requirements/{requirement_id}/continue`：继续流程（将被中断阻塞的节点恢复入队并推进调度）。
- `POST /api/v1/boards/{board_id}/tasks/requirements/{requirement_id}/sync`：阻塞态流程画布回写（仅同步未执行节点到看板任务）。
- `POST /api/v1/boards/{board_id}/tasks/task-runs/{run_id}/events`：执行端回调任务运行事件，驱动状态流转与下一任务调度；新任务默认要求 `callbackSignature` HMAC 校验。
- `GET /api/v1/boards/{board_id}/tasks/{task_id}/output-preview`：按任务关联路径返回文件预览元数据（文本/JSON 预览内容、二进制占位、下载地址）。
- `GET /api/v1/boards/{board_id}/tasks/{task_id}/output-file`：按任务关联路径返回文件流（支持 inline/attachment）。
- `DELETE /api/v1/boards/{board_id}/tasks/{task_id}`：删除单个需求节点；若该节点被同需求下游节点依赖，后端移除对应依赖并重算可调度任务。
- `DELETE /api/v1/boards/{board_id}/tasks/requirements/{requirement_id}`：删除整组需求节点（同 `requirement_id`）。
- `GET/POST/PATCH/DELETE /api/v1/instances*`：OpenClaw 实例配对管理契约，配对成功后前端写入 `linpo.currentInstanceId` 作为默认实例上下文。
- `GET /api/v1/instances/{instance_id}/files`：返回该实例下任务关联且位于 `/tmp/linpo/**` 的可访问产出文件列表（含存在性与大小信息）。
- `GET /api/v1/instances/{instance_id}/files/preview`：按实例+任务上下文预览位于 `/tmp/linpo/**` 的文件内容（文本/JSON/二进制占位）。
- `GET /api/v1/instances/{instance_id}/files/download`：按实例+任务上下文下载位于 `/tmp/linpo/**` 的文件流。
- `GET /api/v1/instances/{instance_id}/agent-docs`：转调 OpenClaw `agents.files.list`，返回该实例下可读 Agent 白名单文档清单。
- `GET /api/v1/instances/{instance_id}/agent-docs/preview`：转调 OpenClaw `agents.files.get`，返回指定 Agent 文档预览内容。
- `GET /api/v1/instances/{instance_id}/agent-docs/download`：下载指定 Agent 文档内容。
- `GET /api/v1/summary/topology`：实例列表详情态用于构建关系树（实例节点、Agent 节点、Session 节点），前端按选中实例筛选并渲染。
- `GET /api/v1/summary/overview`：摘要页与看板页的聚合入口，返回实例诊断、事件流、总 token 与按实例分组的 token 曲线样本。
- `GET /api/v1/ops/setup`：私有化部署配置检查入口；返回必填运行配置检查结果（仅状态，不回传明文敏感值）、实例接入状态与可执行修复建议。
- `GET /api/v1/ops/diagnostics`：私有化部署诊断导出入口；返回可复制的脱敏诊断信息（版本、配置检查摘要、实例连通性、最近错误上下文与 requestId），用于工单/群内协同排障。
- `POST /api/v1/instances/pairing-sessions`：登录用户创建配对会话，返回 `session_id + short_code + pairing_url + expires_at`。
- `pairing_url` 统一返回协议短链 `linpo://pair?code=...`，用于复制转发给 OpenClaw；前端不再提供扫码页面入口。
- `GET /api/v1/instances/pairing-sessions/{session_id}`：登录用户查询配对会话状态（`pending/attached/bound/expired/failed`）与已绑定实例摘要。
- `POST /api/v1/instances/pairing-sessions/{session_id}/attach`：免登录 attach 入口，OpenClaw 侧提交 `endpoint + gatewayToken (+instanceName)` 绑定到会话；后端完成校验并落库实例，状态推进为 `bound`。
- `POST /api/v1/instances/pairing-sessions/attach-by-code`：免登录短码 attach 入口，OpenClaw 侧仅持有 `short_code` 时也可提交 `endpoint + gatewayToken (+instanceName)` 完成绑定，避免用户暴露 `session_id`。
- `POST /api/v1/auth/register`：注册请求需包含 `username + email + password`，邮箱全局唯一。
- `POST /api/v1/auth/login`：登录请求支持 `identifier(用户名或邮箱) + password`。
- `PATCH /api/v1/auth/profile`：登录态下更新用户头像（`avatar_url`，`data:image/*;base64`）。
- `POST /api/v1/auth/password`：登录态下修改密码（校验 `current_password`，更新 `new_password`）。
- `GET /api/v1/instances/messages`：读取当前登录用户的消息中心列表（包含回执链接与确认状态）。
- `POST /api/v1/instances/messages/{message_id}/read`：将消息标记为已读。
- `POST /api/v1/instances/agent-mount/request`：免登录的 Agent 自助挂载申请，提交 `email + endpoint + gatewayToken`；后端按 email 定位用户并返回 `confirmation_url`，同时投递到用户消息中心。
- `POST /api/v1/instances/agent-unmount/request`：免登录的 Agent 自助卸载申请，提交 `email + instance_id`；后端校验实例归属并返回 `confirmation_url`，同时投递到用户消息中心。
- `POST /api/v1/instances/agent-receipts/{token}/confirm`：登录用户确认回执；需校验 token、TTL、一次性消费与“登录用户邮箱=回执目标邮箱”。
- 删除动作仅保留标准 `DELETE` 契约；不再提供 `POST .../delete` 兜底别名。
- v0.7 默认单看板，前端默认使用 `board_id=default`。
- 任务状态机最小集遵循 `queued/running/blocked_by_approval/failed/completed`。
- `session` 不作为任务主键来源，任务标识由 Linpo 侧生成并持久化。
- 实例文件接口必须做任务作用域校验：仅允许当前用户、当前实例、当前看板下任务关联路径，不开放任意绝对路径访问。
- Agent 文档接口必须只暴露 OpenClaw 白名单文件名：`AGENTS.md`、`SOUL.md`、`TOOLS.md`、`IDENTITY.md`、`USER.md`、`HEARTBEAT.md`、`BOOTSTRAP.md`、`MEMORY.md`、`memory.md`；Linpo 不自行接受任意路径输入。
- `flow.generate` 为流程页面分配专用 session：`planner:claw3`、`manager`、`execution` 前缀，用于流程拆解和任务调度链路。
- 流程拆解逻辑不在前端执行，统一由后端 `FlowDecompositionService` 通过 `claw3`（OpenClaw 实例）发起规划会话；若前端传入 planner agent，后端仅接受 `claw3` 并按该目标发起请求，不得静默回退到其他 agent。
- 流程规划消息流与图补丁共用独立 SSE 通道：前端在发送 `flow.generate` 前确定 `planner_session_key`，随后订阅 `/api/v1/boards/{board_id}/tasks/flow/planner-sse`；后端仅以 Linpo 持久化 planner session 为真源，找不到 session 时直接返回 `404`，不再从 OpenClaw `chat.history` 回填；对外推送 `planner_messages_updated`、`planner_nodes_patched`、`planner_snapshot_updated` 与 `planner_session_updated`。
- 流程创建入口由 `FlowEditorPanel` 左侧流程侧栏中的新建弹窗承接；`FlowEditorPanel` 底部悬浮对话框用于后续增量改图（同样调用 `flow.generate`）。
- 配对入口支持用户自有 OpenClaw（如 `claw2`）；Linpo 不要求用户先配置多页面，只需完成一次实例配对即可进入看板与流程主链。
- 调度策略：每次入队后立即从 `queued` 取一个“依赖满足”的任务投放执行；任务完成后再推进下一项。未完成任务保持 `running`，敏感终态进入 `blocked_by_approval`。
- 流程运行不再引入 `flow_instance_id` 多实例隔离；依赖判定键回归 `flow_id + flow_node`。
- v0.7 完成判定主路径采用 `task-run event callback`，`chat.history` 不参与主判定。

## 8. 后端分层冻结

唯一调用链：

`API -> Application -> Domain Contract -> Provider Adapter -> Infra/Persistence`

分层职责：

- API：路由、鉴权、参数校验、错误封装。
- Application：流程解析、调度与审批编排。
- Domain Contract：Flow/Task/Approval/Artifact canonical 契约。
- Provider Adapter：OpenClaw RPC 与事件映射。
- Infra/Persistence：实例配置、会话、审计、重试与超时。

### 8.1 拆解服务配置（claw3，必须显式配置）

- `FLOW_DECOMPOSITION_OPENCLAW_BASE_URL`：拆解服务网关地址（必填）。
- `FLOW_DECOMPOSITION_OPENCLAW_GATEWAY_TOKEN`：拆解服务 Token（必填）。
- `FLOW_DECOMPOSITION_OPENCLAW_ORIGIN`：拆解服务 Origin（必填）。
- 拆解服务 agent 固定为 `claw3`（不通过环境变量覆盖）。
- 以上配置不提供默认公网地址或默认 token；缺失时视为配置错误并阻断拆解链路。

### 8.2 任务事件回调配置

- `LINPO_TASK_EVENT_CALLBACK_BASE_URL`：写入任务投放提示词的回调基地址（建议显式配置）。
- 未显式配置 `LINPO_TASK_EVENT_CALLBACK_BASE_URL` 时，后端会根据实例 endpoint 推导公网回调地址（host 不变，端口默认 `8000`）；若无法推导候选回调地址，任务投放直接失败。
- `LINPO_TASK_EVENT_CALLBACK_PORT`：未显式配置回调基地址时，推导公网回调地址使用的端口（默认 `8000`）。
- `LINPO_TASK_RUN_STALE_SECONDS`：`running` 无 heartbeat 的超时阈值（默认 `900` 秒，最小 `60` 秒）。

### 8.3 Agent 自助挂载回执配置

- `LINPO_PAIRING_RECEIPT_TTL_SECONDS`：挂载/卸载回执有效期（默认 `1800` 秒）。
- 回执 token 必须一次性消费，确认成功后立即失效。
- 回执确认必须要求登录态；登录用户邮箱与回执目标邮箱不一致时必须拒绝确认。

## 9. Tauri 构建约束

- 前端打包产物可被 Tauri WebView 加载。
- 桌面端运行时沿用同一套 API 基地址注入机制。
- 新增 Tauri 配置时不破坏现有 Web 构建脚本。

## 10. 迁移纪律

- 多页 IA 相关入口在 v0.7 迁移后不再作为主路径维护。
- 旧页面能力如需保留，仅作为过渡代码，不作为产品契约。
- 文档与实现不一致时先修文档或修实现，禁止长期漂移。

## 11. 后端重构终局设计（2026-04）

### 11.1 终局目标

- 严格分层调用链保持为：`API -> Application -> Domain Contract -> Provider Adapter -> Infra/Persistence`。
- API 层只承担协议职责：鉴权、参数校验、错误映射、HTTP/SSE 序列化。
- Application 层承担业务编排，不依赖 `app/api/*`，不得返回 API schema 类型。
- Adapter 层只处理 Provider 协议与映射，不依赖 FastAPI 等 Web 框架类型。
- Domain Contract 保持框架无关，仅承载领域对象与跨层契约 DTO。

### 11.2 冻结约束

- 禁止 `app/services` 导入 `app/api/*`。
- 禁止 `app/adapters` 导入 FastAPI/Starlette 的请求或异常类型。
- API 层不得直接内嵌复杂调度状态机；复杂流程需下沉到 Application Service。
- 新增功能默认先在 Application 层设计输入输出 DTO，再由 API 做映射。
- 对外 API 命名规范统一为 `camelCase`；`tasks/flow` 相关请求与响应字段不再维护 `snake_case` 兼容别名。

### 11.3 模块重构落点

- 聚合链路：
  - 新增 `app/services/aggregate_models.py`（或同级契约模块）承载服务层 DTO。
  - `AggregateService` 返回服务层 DTO；`app/api/aggregate.py` 负责映射到 `app/api/schemas.py`。
- Provider 适配链路：
  - `app/adapters/openclaw_adapter.py` 仅抛 adapter/domain 错误类型。
  - API/Application 统一完成 `ProviderAdapterError -> HTTP` 的边界映射。
- 任务链路：
  - `app/api/tasks.py` 逐步拆分：`TaskDispatchService`、`TaskRunCallbackService`、`FlowRequirementService`。
  - 路由层仅保留请求/响应组装与调用编排入口。

### 11.4 分阶段推进

- Phase 1（立即执行）：修复跨层反向依赖、adapter 框架耦合、测试红线（全绿基线）。
- Phase 2（短期）：抽离任务调度/回调编排服务，缩减 `tasks.py` 职责密度。
- Phase 3（中期）：拆分超大服务（`observer_data`、`flow_planner_session_service`）为 repository/rules/publisher/mapper。

### 11.5 验收标准

- 架构验收：
  - 代码库中无 `service -> api` 导入；
  - adapter 层不出现 FastAPI 依赖；
  - 新增路由控制器保持薄层。
- 测试验收：
  - 后端 `pytest` 全绿；
  - 关键路径（auth/task/instance/realtime/provider）均有回归测试。
- 可维护性验收：
  - 关键模块职责单一，新增需求无需跨 3 层以上同时改动才能落地。

若文档冲突涉及产品边界、交互口径或成功标准，以 `docs/prd.md` 为准；若 `docs/prd.md` 未明示实现细节，则以 `docs/architecture.md` 为准；`docs/test-resources.md` 仅承载测试与联调资源，不单独覆盖前两者。
