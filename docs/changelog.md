# Linpo 文档变更记录

## 2026-04-01

- PRD/Architecture 补充看板列高度口径：未折叠列按内部卡片自然包裹，超出页面高度后仅列内列表滚动，不再把所有列统一拉满高度。
- PRD/Architecture 补充看板列折叠交互：支持双击列头折叠/展开列，折叠态收敛为半透明窄列并移除列头，仅在顶部展示纵向省略号与渐隐背景。
- PRD/Architecture 调整导航 IA：`实例文件` 入口从账户下拉迁移到顶部导航，主导航改为 `看板/流程/文件`。
- PRD/Architecture 补充提示词约束：流程拆解与任务投放提示词新增“路径不可访问兜底”口径，要求回传实际产物路径与回退原因。
- PRD/Architecture 新增“实例文件页”能力：新增受保护路由 `/instance-files`，并从账户下拉菜单提供“实例文件”入口。
- PRD/Architecture 明确实例文件访问边界：仅允许访问任务关联产物路径（`artifact` / `temp_output_path` 等），不开放任意系统路径浏览。
- Architecture 补充实例文件接口契约：`GET /instances/{instance_id}/files`、`GET /instances/{instance_id}/files/preview`、`GET /instances/{instance_id}/files/download`。

## 2026-03-31

- 后端下线看板 board websocket 通道：移除 `WS /ws/boards/{board_id}/tasks` 路由与集成测试，仅保留 `GET /sse/boards/{board_id}/tasks` 作为唯一看板实时通道。
- 看板页 realtime 主链路由 board websocket 切换为 board SSE：`CollabPage` 改为订阅 `GET /sse/boards/{board_id}/tasks`，前端移除 `createBoardTasksRealtimeClient` 残留实现，统一使用 SSE 增量更新任务列表与卡片基础信息。
- PRD/Architecture 调整账户下拉交互：新增“实例”菜单项并弹窗展示实例列表/实例详情；移除“用户信息”菜单项，改为点击下拉顶部用户名弹窗展示用户基本信息与会员充值入口。
- Architecture 补充账户弹窗组件口径：新增 `UserProfileModal` 与 `InstanceListModal`，并明确 `MessageCenterModal` 通过 portal 渲染与层级修复要求。
- PRD/Architecture 细化“账户”弹窗能力：支持改用户名、改密码、换头像（真实后端流程），并保留会员充值渠道占位。
- PRD/Architecture 细化“账户”弹窗布局：改为“侧边栏 tabs（基本信息/修改密码/会员）+ 展示区”，并明确头像与用户名编辑入口位于基本信息页。
- PRD/Architecture 调整实例入口：导航栏移除“实例”主入口，实例管理迁移到 `/profile` 的“实例列表”视图；`/pairing` 仅保留兼容路由。
- PRD/Architecture 重构用户信息页：新增“用户信息/实例列表”侧边栏结构；用户信息改为弹窗式头像/密码/会员操作，实例列表支持展开详情与拓扑树并内置三种挂载方式弹窗。
- Architecture 补充消息中心弹窗渲染口径：`MessageCenterModal` 使用 portal 挂载，避免层级遮挡导致弹窗不可见。
- PRD/Architecture 新增“用户信息”能力：导航栏账户下拉新增“用户信息”入口，新增 `/profile` 页面并定义头像更新、密码修改与会员充值渠道占位口径。
- Architecture 补充认证接口契约：新增 `PATCH /auth/profile`（头像更新）与 `POST /auth/password`（改密）标准登录态流程。
- PRD/Architecture 升级 Agent 自助挂载契约：由 `request -> email code confirm` 改为 `request -> receipt link -> login confirm`，目标用户通过 email 唯一定位，不再要求 request 阶段提交 username。
- PRD/Architecture 新增消息中心口径：导航栏账户菜单提供“消息”入口，承载回执链接消息列表与详情查看。
- PRD/Architecture 补充回执确认接口：新增消息读取/已读与回执确认契约（登录态邮箱匹配校验 + 一次性 token）。
- PRD/Architecture 修正配对链路死锁：`/pairing/tutorial` 调整为匿名可访问路由，不再依赖登录态。
- PRD/Architecture 强化验证码投递口径：新增 `LINPO_PAIRING_CHALLENGE_DELIVERY + LINPO_SMTP_*` 配置，challenge 创建需以邮件投递成功为前置。
- PRD/Architecture 扩展配对教程页：新增“可直接转发给 OpenClaw 的纯文本指引模板”，覆盖自助挂载/自助卸载两条链路并支持复制。
- PRD/Architecture 细化接入交互：`/pairing` 新建配对改为三标签（Token/配对码/教程链接）；`/pairing/tutorial` 改为 Markdown 静态页承载指引正文。
- PRD/Architecture 修正教程直连口径：OpenClaw 应使用 `/pairing/tutorial.md`（纯 Markdown 静态文件）作为读取入口，避免 HTML 页面语法噪音。
- PRD/Architecture 增加后缀漏写兼容：访问 `/pairing/tutorial` 时自动重定向到 `/pairing/tutorial.md`，不显示中间提示文案。
- 流程编辑页节点状态同步链路由 board websocket 切换为 board SSE：新增 `GET /sse/boards/{board_id}/tasks`，前端 `FlowPage` 改为 SSE 增量更新，降低 ws 不稳定导致的状态滞后。
- 流程画布连线交互调整：默认不展示删除按钮；点击连线后选中，再显示单一删除按钮执行删除。
- PRD/Architecture 补充看板任务 realtime 契约：新增 `WS /ws/boards/{board_id}/tasks` 通道，任务列表与弹窗基础信息改为事件驱动增量同步，减少手动刷新依赖。
- PRD/Architecture 补充流程编辑页节点状态同步口径：编辑页订阅 board realtime，节点状态随任务事件实时更新。
- PRD/Architecture 补充看板“按流程分列”列头交互：展示流程状态并提供主动作（`中断流程/继续流程/运行流程`），删除流程仍遵循“先中断后删除”。
- PRD/Architecture 补充实例页详情口径：已配对实例需展示 `实例 -> Agent -> Session` 树形拓扑，并定义空态/失败态提示与刷新交互。
- PRD/Architecture 新增“Agent 自助挂载/卸载”口径：支持免登录 `request -> email code confirm` 双阶段实例绑定与解绑。
- PRD/Architecture 调整认证契约：注册改为 `username + email + password`，登录支持 `identifier(用户名或邮箱) + password`。

## 2026-03-30

- PRD/Architecture 收敛流程运行模型：移除“流程实例面板/flow_instance_id 多实例”口径，改为“单流程即单实例”。
- PRD/Architecture 调整编辑页主按钮状态机：`运行 -> 中断 -> 继续 -> 运行`；运行中冻结编辑，阻塞态允许编辑未执行节点并回写看板。
- Architecture 补充流程级接口：新增 `POST /tasks/requirements/{requirement_id}/continue` 与 `POST /tasks/requirements/{requirement_id}/sync`。
- PRD/Architecture 调整看板分列口径：`按需求分列` 更名为 `按流程分列`；流程列头新增“中断流程/删除流程（先中断后删除）”动作。
- PRD/Architecture 补充状态列要求：按状态分列新增“阻塞”列，用于展示被中断/阻断节点。
- PRD/Architecture 收敛任务控制按钮策略：仅 `running` 节点展示“中断”，其他状态按可用动作显示不同按钮组。
- Architecture 补充多实例调度隔离：同一流程多次运行采用 `flow_instance_id` 分隔依赖判定，避免跨实例串联。
- PRD/Architecture 调整流程导航行为：导航栏点击“流程”优先回到上次访问的流程路由（缓存），仅在无缓存或缓存为列表页时进入 `/flow`。
- PRD/Architecture 移除流程编辑冻结态口径：编辑页始终可编辑，“运行”仅创建新的流程实例并触发调度。
- PRD/Architecture 新增编辑页实例观察能力：工具栏右上展示当前流程实例统计（运行中/历史）与实例列表。
- PRD/Architecture 调整任务详情默认页签：弹窗默认展示“基本信息”，终态不再自动跳转“任务产出”。
- PRD/Architecture 扩展阻塞态控制：`blocked_by_approval` 节点在“基本信息”页新增“继续”动作，并补充后端 `POST /tasks/{task_id}/continue` 契约。
- PRD/Architecture 补充流程拆解并行策略：`flow.generate` 提示词明确鼓励把可独立子任务拆成并行分支，并在节点描述中给出 subagent 并行委派建议。
- PRD/Architecture 扩展任务详情“基本信息”页契约：提供任务控制按钮（含`中断`）并新增后端任务中断接口约束。
- PRD/Architecture 同步任务详情弹窗新契约：采用 `基本信息/执行流程/任务产出` 三标签页，降低信息拥挤。
- PRD/Architecture 曾补充终态交互约束：任务进入 `completed/failed/blocked_by_approval` 后默认切到“任务产出”标签页（同日后续已调整为默认停留“基本信息”）。
- PRD/Architecture 新增任务产出能力口径：文本按 Markdown 渲染，文件支持格式化预览与下载；后端新增任务范围受限的产出预览/文件流接口。
- PRD/Architecture 细化任务产出预览：前端按 MIME 做专用渲染（JSON 折叠树、图片/PDF/音视频内嵌），其余类型保留下载兜底。
- PRD/Architecture 调整任务详情交互：弹窗改为 `基本信息/执行流程/任务产出` 三标签页（终态默认页签后续已统一为“基本信息”）。
- PRD/Architecture 收敛任务产出来源：仅展示 Agent 显式上报的 `artifact` 交接文件，不再从普通消息文本推断路径。

## 2026-03-29

- PRD/Architecture 升级流程编辑画布契约：移除底部输入框，改为 ComfyUI 风格直编画布（双击画布建节点、双击节点编辑、四向连接点连线）。
- PRD/Architecture 明确泳道布局重构：泳道按列展示且顶部冻结标题行，支持双击顶部空白创建泳道、双击泳道标题编辑名称与委派 Agent。
- PRD/Architecture 明确不再手工编辑 L1~Lx；提交流程前由拓扑算法动态计算 `layer` 并完成节点到 Agent 的分配。
- PRD/Architecture 补充节点间数据交换约束：统一采用临时文件通道。
- PRD/Architecture 明确流程创建入口迁移：从流程编辑页底部输入迁移到流程列表页“新建流程”弹窗（需求可空；有需求时先生成再跳转编辑页）。
- PRD/Architecture 细化流程画布交互：节点支持详细描述、连接改为连接点拖拽并按最短接入点渲染、节点可跨泳道拖拽迁移；提交流程前草稿节点不再展示 `queued` 标签。
- PRD/Architecture 补充“所有流程”页布局与交互约束：移除顶部标题说明区，工具栏承载筛选/排序与“新建流程”，流程卡片提供“开始流程/重命名流程/删除流程”编辑动作。
- PRD/Architecture 调整“所有流程”与“编辑流程”交互：流程列表编辑弹窗移除“开始流程”，卡片主体直接进入编辑页；编辑页主按钮文案由“提交流程”改为“运行”；流程新建拆解 Agent 固定为 `claw3`（后续通过配置切换）。
- PRD 进一步统一工作台视觉：看板/流程列表/流程编辑工具栏统一为贴顶扁平风格；流程列表卡片布局恢复多列网格。
- PRD/Architecture 补充看板任务详情弹窗契约：新增 `详情/消息流` 标签页，消息流复用 session 历史接口展示任务执行过程。
- PRD/Architecture 收敛节点消息流原则：每个任务节点绑定唯一 `execution_session_key`，看板弹窗消息流改为“history 首屏 + realtime 增量订阅”，移除轮询刷新。
- PRD/Architecture 调整流程编辑交互：恢复底部悬浮指令对话框（无消息流面板），支持 `Enter` 发送、`Shift+Enter` 换行；发送中禁用画布编辑并显示“正在规划...”。
- PRD/Architecture 扩展 `flow.generate` 契约：支持携带当前 `nodes/edges` 与 `planner_session_key`，用于在已编辑流程上增量改图。
- PRD/Architecture 补充 OpenClaw 接入能力：新增 `/pairing` 配对管理页与 `/pairing/tutorial` 教程页，支持用户自有实例（如 `claw2`）最短路径接入。
- PRD/Architecture 调整接入 IA：`接入` 页面统一命名为 `实例` 页面，并改为“左侧实例列表 + 右侧详情/新建配对工作区”。
- PRD/Architecture 新增双配对方式口径：`Token 配对` 与 `配对码配对`，并补充后端 `instances/pair-code` 契约。
- PRD 同步流程页交互收敛：移除消息流面板，仅保留底部悬浮对话框。
- PRD 补充流程页键盘契约：`Enter` 发送、`Shift+Enter` 换行；发送中按钮禁用并显示“规划中...”。
- PRD 补充“每次发送附带当前工作流上下文”的增量改图口径。
- PRD 补充流程画布改为“横向多泳道 + 左侧冻结执行 Agent 列”布局约束。
- PRD/Architecture 补充流程编辑能力约束：流程画布支持节点与连接的人工增删改，确认入板以当前画布为准。
- 流程页编辑交互增强：支持拖拽改层级/泳道、框选多节点与 `Delete/Backspace` 快捷删除。
- 流程导航与路由分层重构：`/flow` 改为“所有流程”目录页，原流程页面迁移为 `/flow/edit/:flow_id` 编辑页。
- 编辑页新增“我的流程 / 当前流程名”目录工具栏交互，支持流程重命名与“提交流程/停止流程”状态切换。

## 2026-03-28

- PRD/Architecture/Test-Resources 同步新增“流程拆解服务化”口径：需求到流程节点由后端统一调用 `claw3` 完成。
- Architecture 增补 `FlowDecompositionService` 边界与 `FLOW_DECOMPOSITION_*` 运行时变量说明。
- 测试资源文档补充 `claw3` 作为流程拆解默认实例的联调约束。
- 流程编排链路调整为“两段式”：`flow.generate` 仅生成草图，`flow.confirm` 确认后入队；任务默认 `queued`，由后端队列调度器串行拉取执行并按结果流转 `running/completed/blocked_by_approval/failed`。
- 任务执行判定从 `chat.history` 轮询主链升级为 `task-run event callback` 主链，并新增低频 stale 补偿巡检；补充回调契约与 `LINPO_TASK_EVENT_CALLBACK_BASE_URL` / `LINPO_TASK_RUN_STALE_SECONDS` 配置口径。
- 看板新增“按需求分列 + 按需求筛选 + 删除需求节点”能力：后端补充 `requirement_id/requirement_title` 元数据写入与 `DELETE /tasks/{task_id}`、`DELETE /tasks/requirements/{requirement_id}` 接口，并提供 `POST .../delete` 兼容兜底。
- 看板停止读取历史 `localStorage(flow_tasks)` 作为渲染数据源，统一只展示后端真实 Task，避免需求分列被旧节点缓存污染。
- 看板工具栏移除“新增任务”入口及其弹窗逻辑；左侧改为需求数量统计，需求筛选展示改为桌面端 20 字截断、移动端 `…`。
- 前端同步移除未使用的 `createKanbanTask` API 与 `KanbanTaskCreateRequest` 类型定义，消除与当前交互模型不一致的死代码。
- 看板工具栏交互再次调整：移除“需求筛选”下拉，主动作改为 `➕任务`；点击后弹窗输入需求并指派 Agent，提供“创建任务（直接入队）/创建流程（跳转流程页）”双按钮。
- 前端恢复 `createKanbanTask` API 与 `KanbanTaskCreateRequest` 类型以承载看板快捷建任务入口。
- 流程页结构升级为“画布全屏 + 顶部悬浮操作条 + 底部悬浮对话框”：移除原顶部标题/返回/清空按钮区。
- 导航栏新增与看板并列的“流程”入口。
- 流程页新增“流程选择下拉（单行省略）+ 流程加入看板”能力；切换流程后即刻刷新画布与对话历史。
- 流程页对话框动作收敛为单按钮“发送信息”；“流程加入看板”动作上收至顶部悬浮操作条。
- 流程页交互收敛：移除“规划/管理/执行 Agent”选择控件，规划固定 `claw3(main)`，管理默认与执行同 Agent；“流程加入看板”新增二次确认弹窗。
- 任务投放提示词新增“候选回调地址链”与强约束：未显式配置回调基地址时，优先推导实例公网 host 作为回调地址并附带本地地址兜底，要求 agent 在拿到 `accepted=true` 后再继续执行，降低回调地址不可达导致的卡住风险。

## 2026-03-27

- 产品方向升级为 v0.7：主界面收敛为 `kanban + toolbar`，不再维护多页 IA 作为主产品契约。
- 文档结构改为平铺：新增 `docs/prd.md`、`docs/architecture.md`、`docs/test-resources.md`、`docs/openclaw-api-catalog.md`。
- 治理规则与 README 引用链切换到平铺路径，移除版本化文档路径。
- PRD 明确 v0.7 闭环：`一句话需求 -> 流程图 -> DAG 任务队列 -> 并行执行 -> 统一审批 -> 产出预览/调试`。
- PRD 明确 v0.8 延后项：模板市场、agent 消耗统计、agent 拓扑配置。
- Architecture 增补 Tauri 构建约束与 `claw1` 默认联调边界。
- PRD 路由口径补充 `/landing`，并新增品牌区点击跳转落地页约束（`LP/灵盘`）。
- 看板交互补充：列宽固定并支持横向滚动；agent 视图新增“新增 Agent”入口列。
- 落地页口径补充：`/landing` 支持游客直达访问，页面需突出优势并预留 Image 占位区。

## 2026-03-26

- 导航口径更新：移动端 `overview` 入口改为 IA 内 icon，移除顶部品牌栏占位；桌面端保留品牌 icon 入口。
- 导航口径追加：移动端用户信息入口并入 IA 最后一项，移除悬浮账户入口。
- PRD 补充“页面借鉴源（设计参考口径）”：明确 `overview/topology/kanban/team` 与跨页契约分别对应的 OpenClaw 参考仓库映射，统一后续设计与改造参考基线。
- 测试资源文档新增“参考项目卖点与侵入性结论（精简）”表，统一 `openclaw` 相关 5 个参考仓库的使用边界认知。
- PRD/Architecture 补充 Topology 对标约束：以 `openclaw-gateway-routing-graph` 为基线，要求骨架常显、链路高亮、业务视图与技术明细并存，并保持 Linpo 现有 realtime 链路。

## 2026-03-25

- 文档目录收敛为 `docs/` 唯一权威来源。
- 移除独立计划目录，执行约束并入 PRD 与 Architecture。
- 移除旧版与废弃文档，避免并行口径。
- 文档目录入口统一回收到 `README.md`。
- 补回关键联调资源：`ravin` 地址、OpenClaw `claw1/2/3` Token、运行时环境变量前置条件、保留字稳定转义规则。

## 维护规则

- 只记录“文档结构与治理口径”的关键变化。
- 业务功能变更仍以代码提交历史为主，不在此做流水账。
