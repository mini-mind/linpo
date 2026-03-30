# Linpo 文档变更记录

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
