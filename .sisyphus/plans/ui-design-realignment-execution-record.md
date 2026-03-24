# UI 设计重对齐执行记录

## 1. 文档目的与适用 plan

- 本文件是当前阶段唯一留痕载体，用于承接 `.sisyphus/plans/ui-design-realignment-work-plan.md` 要求的所有记录、写明、留痕、冻结内容。
- 适用 plan：`.sisyphus/plans/ui-design-realignment-work-plan.md`
- 适用范围：Task 2 至 Task 8 的参考锚点、提交 SHA、冲突裁决、路由替换、兼容策略、验收证据、时间戳、环境标识、豁免声明。
- 维护方式：仅追加，不回填伪造结论，不以聊天消息、口头说明、PR 描述或外部链接替代本文件。
- 当前状态：骨架模板，等待后续任务按节追加真实记录。

## 2. 使用规则

### 2.1 追加规则

- 只允许 append-only 追加记录，不覆盖既有事实，不删除既有证据。
- 每次追加必须写明追加时间、执行人或执行身份、适用环境。
- 未取得证据前，只能保留空模板或明确写“待后续追加真实证据”，不得伪造 SHA、截图路径、请求记录或验收结论。

### 2.2 证据记录规则

- 每条记录至少关联页面或模块名。
- 每条记录必须能让复审者独立定位参考对象、实现对象与验收证据。
- 若引用仓库外参考对象，必须写明仓库名、可定位页面或组件对象、来源说明、重定位说明。
- 每条证据必须附时间戳与适用环境，环境仅记录 `local` 或 `deployed`。
- 若声明 unauthorized 豁免或不可达，必须附客观证据模板，不得只写结论。

### 2.3 单条记录必填字段模板

- 页面/模块名：
- 参考仓库的可移植标识：
  - 仓库名：
  - 可定位页面/组件对象：
  - 来源说明：
  - 仓库外参考对象重定位说明：
- 对应 commit SHA：
- 若发生冲突：
  - 冲突点：
  - 裁决依据：
  - 最终替代方案：
- 若发生路由替换：
  - 旧语义：
  - 新语义：
  - 兼容策略：
- 验收证据位置：
  - 测试命令：
  - 截图：
  - 请求记录：
  - 仓库内报告路径：
- 证据时间戳：
- 适用环境：
- unauthorized 豁免或不可达声明证据：
  - 测试身份：
  - 目标页面：
  - 目标动作：
  - 预期受限路径：
  - 实际结果：
  - 时间戳：

## 3. 全局环境、样本与测试身份记录区

### 3.1 环境基线

| 项目 | 值 | 备注 |
| --- | --- | --- |
| 记录创建时间 |  |  |
| 当前阶段 | v0.6 UI 设计重对齐 |  |
| 前端部署地址 | `http://175.178.213.10:5173` |  |
| 后端部署地址 | `http://175.178.213.10:8000` |  |
| 健康检查地址 | `http://175.178.213.10:8000/health` |  |
| 本地工作区 | `/data/projects/linpo` |  |

### 3.2 测试身份与样本说明

| 记录项 | 内容 | 时间戳 | 备注 |
| --- | --- | --- | --- |
| 浏览器验收发起端 |  |  |  |
| 已登录用户身份说明 |  |  |  |
| unauthorized 样本身份说明 |  |  |  |
| session canonical 样本来源 |  |  |  |
| session 空工作区样本来源 |  |  |  |
| session 空会话样本来源 |  |  |  |
| 失败态样本来源 |  |  |  |

### 3.3 全局请求对账约定

| 项目 | 内容 | 备注 |
| --- | --- | --- |
| `request_id` 提取方式 |  |  |
| 已部署后端请求记录定位方式 |  |  |
| 截图命名约定 |  |  |
| 时间戳时区约定 |  |  |
| 仓库内报告路径约定 |  |  |

## 4. 冲突裁决记录区

> 每发生一次参考实现与当前文档、当前实现、当前环境之间的冲突，就在本节追加一条新记录。

### 4.1 冲突记录模板

- 记录编号：
- 页面/模块名：
- 关联任务：
- 冲突点：
- 冲突来源：
- 裁决依据：
- 最终替代方案：
- 是否影响验收口径：
- 关联证据：
- 时间戳：

## 5. 路由替换与兼容策略记录区

> 凡出现旧语义替换、新语义定稿、兼容入口保留或禁用规则，都在本节追加记录。

### 5.1 路由与兼容记录模板

- 记录编号：
- 页面/模块名：
- 旧语义：
- 新语义：
- canonical 路由：
- 兼容策略：
- 禁止路径或废弃入口：
- 负向样本说明：
- 关联请求证据：
- 时间戳：

## 6. 五页逐页记录模板

> 每页至少独立记录参考锚点、实现路径、SHA、截图、请求证据、状态验收、特殊说明。后续追加时，不得把五页混写成一条总记录。

### 6.1 overview 记录模板

#### 6.1.1 参考锚点

- 页面/模块名：`overview`
- 参考仓库名：`hoodini/llm-visuals`
- 可定位页面或组件对象：`packages/dashboard/src/app/page.tsx`、`packages/dashboard/src/components/metrics/metrics-panel.tsx`、`packages/dashboard/src/components/activity-feed.tsx`
- 来源说明：以 `LINPO-OVERVIEW-HOME-V1` 作为 overview 结构锚点。外部参考对象提供的是结构锚点，Linpo 当前需移植的是“顶部统计 + token 趋势主舞台 + 右侧常驻全局事件流”语义。
- 仓库外参考对象重定位说明：当前承载对象是 `frontend/src/components/OverviewPage.tsx` 中的 `OverviewPage`，且 `/overview` 当前指向该对象。local 结构证据已锁定其“三段式”语义，即顶部统计区 + 实例 token 主舞台 + 右侧全局事件 rail

#### 6.1.2 实现路径

- 前端实现路径：`frontend/src/components/OverviewPage.tsx`
- 当前页面对象：`OverviewPage`
- 当前路由事实：`/overview` 当前指向 `OverviewPage`
- 后端实现路径：`app/services/aggregate_service.py`、`app/api/schemas.py`，当前补录直接承接本文件第 11 节 Task 2.2 已落盘的 overview 聚合契约记录
- 测试路径：`frontend/src/components/OverviewPage.test.tsx`
- 相关报告路径：仓库内无独立 report 文件，本节即唯一留痕载体。本次 fresh local 验证命令为 `npm --prefix frontend run test -- OverviewPage` 与 `npm --prefix frontend run build`

#### 6.1.3 SHA

- 当前仓库提交 SHA：按任务要求本次未执行 git 命令，当前 SHA 待后续由编排者基于真实仓库状态补录
- 参考对象对应 SHA：`a3abca11ced052f554a0b84e43d51c4c32c8706d`

#### 6.1.4 截图

- 访问 URL：`http://175.178.213.10:5173/overview`
- 截图路径：当前无已登录 overview 结构截图。local 结构证据改由 `frontend/src/components/OverviewPage.tsx` 与 `frontend/src/components/OverviewPage.test.tsx` 承担
- 时间戳：已知 deployed 浏览器访问被登录门禁阻断，但仓库内没有对应截图时间戳或截图文件，本节不伪造

#### 6.1.5 请求证据

- 页面可见对账线索：成功态由 `OverviewRequestClues` 展示 `request_id / freshness / checked_at / diagnostics`，失败态由 `EnvelopeErrorSummary` 展示 `code / request_id / recoverable / next_step`
- `request_id`：local 成功态样本 `req-overview-1`，refresh 后样本 `req-overview-2`，failed/retry 样本 `req-overview-503 -> req-overview-recovered`，unauthorized 样本 `req-overview-401`
- 已部署后端请求记录：当前缺失。已知 deployed 浏览器访问在登录门禁前即被阻断，尚未取得 overview 已认证请求记录
- refresh 或时间范围切换前证据：`frontend/src/components/OverviewPage.test.tsx` 的 `re-reads aggregate overview when refresh is triggered from the successful state` 首次断言 `request_id · req-overview-1`
- refresh 或时间范围切换后证据：同一用例点击“刷新”后断言 `request_id · req-overview-2` 且 `mockGetAggregateOverview` 调用 2 次；`re-reads aggregate overview when retry is triggered from the failed state` 进一步证明 failed 态“重试”也再次调用 `getAggregateOverview` 并恢复为 `req-overview-recovered`

#### 6.1.6 状态验收

| 状态 | 结果 | 证据位置 | 时间戳 | 备注 |
| --- | --- | --- | --- | --- |
| loading | local 通过 | `frontend/src/components/OverviewPage.test.tsx` 的 `keeps the overview shell visible while aggregate overview is loading` | 无 | 保留标题、统计区、token 主舞台与事件 rail 的加载占位 |
| empty | local 通过 | `frontend/src/components/OverviewPage.test.tsx` 的 `keeps the overview skeleton when token groups and global events are empty` | `2026-03-22T12:00:00Z` | 时间来自 mocked `freshness.checked_at`，空数据仍保留主页骨架且不伪造 token 曲线 |
| partial_failure | local 通过 | `frontend/src/components/OverviewPage.test.tsx` 的 `keeps successful overview content while surfacing a partial failure notice from diagnostics` 与 `shows a partial failure notice when the payload is explicitly marked partial_failure` | `2026-03-22T12:00:00Z` | 同时覆盖 diagnostics 推导与 payload 显式标记两种来源 |
| failed | local 通过 | `frontend/src/components/OverviewPage.test.tsx` 的 `shows a readable failed state with request evidence when overview loading fails` | 无 | 保留失败摘要、`request_id` 与 retry 入口 |
| unauthorized | local 通过 | `frontend/src/components/OverviewPage.test.tsx` 的 `shows an explicit unauthorized state instead of a generic failure state` | 无 | 401 不伪装为空成功，显示 `request_id · req-overview-401` |
| stale | local 通过 | `frontend/src/components/OverviewPage.test.tsx` 的 `shows an explicit stale notice while keeping overview content visible` | `2026-03-22T11:40:00Z` | 时间来自 mocked `freshness.checked_at`，stale 提示与成功内容并存 |

#### 6.1.7 特殊说明

- 主链路样本记录：local 成功态结构由 `renders overview as stats topbar, token stage, and global event rail instead of agents grid` 与 `shows request clues for reconciliation in the successful overview state` 两个用例锁定；本次补录前 fresh local 验证命令 `npm --prefix frontend run test -- OverviewPage` 与 `npm --prefix frontend run build` 已在 `2026-03-23T22:02:20+08:00` 前完成并通过
- 负向样本记录：`frontend/src/components/OverviewPage.test.tsx` 明确断言 `overview-agents-grid` 不存在，说明 overview 已脱离旧 agents-first 主舞台；plan 要求的“顶部统计卡或仅实例维曲线点不得直接进入 session”当前尚无 deployed 已认证浏览器证据，本节不伪造
- unauthorized 豁免说明及证据：本页当前不做 unauthorized 豁免。local 组件测试已覆盖 unauthorized 页面态；已知 deployed 浏览器门禁事实为未登录浏览器直接访问 `http://175.178.213.10:5173/overview` 会被重定向到 `/login`，因此当前只有登录门禁阻断事实，没有已登录 overview 截图、已部署 `request_id` 或后端请求记录
- 其他补充：`OverviewPage` 当前真实结构已是顶部统计区 + 实例 token 主舞台 + 右侧全局事件 rail。`OverviewRequestClues` 提供 `request_id / freshness / checked_at / diagnostics`，refresh 与 failed 态 retry 都继续命中 `getAggregateOverview` 同一读链路，并由两次调用断言锁定

### 6.2 topology 记录模板

#### 6.2.1 参考锚点

- 页面/模块名：`topology`
- 参考仓库名：`sunbao/openclaw-gateway-routing-graph`
- 可定位页面或组件对象：`index.html`、`src/main.ts`、`src/routing-graph-app.ts`、`src/routing-graph.ts`、`src/routing-adapters.ts`、`src/routing-types.ts`
- 来源说明：以 Task 3.1 已冻结的 `sunbao/openclaw-gateway-routing-graph` 作为 topology 结构锚点。当前对齐语义是四泳道 routing graph 主舞台，不回退到旧 observer graph-only 画布。
- 仓库外参考对象重定位说明：当前本地承载对象是 `frontend/src/components/TopologyPage.tsx` 中的 `TopologyPage` 与 `frontend/src/components/InstanceTopology.tsx` 中的 `InstanceTopology`。`frontend/src/main.tsx` 证明 `/topology` 受 `ProtectedRoute` 保护并指向 `TopologyPage`，而 `TopologyPage` 当前只包装 `InstanceTopology`

#### 6.2.2 实现路径

- 前端实现路径：`frontend/src/main.tsx`、`frontend/src/components/TopologyPage.tsx`、`frontend/src/components/InstanceTopology.tsx`、`frontend/src/api/client.ts`、`frontend/src/api/types.ts`
- 后端实现路径：`app/api/aggregate.py`、`app/api/schemas.py`、`app/services/aggregate_service.py`
- 测试路径：`frontend/src/components/InstanceTopology.test.tsx`、`frontend/src/components/InstanceTopology.readonly.test.tsx`、`frontend/src/components/LoginPage.test.tsx`、`tests/integration/test_aggregate_api.py`
- 相关报告路径：仓库内无独立 topology report 文件，本节即唯一留痕载体。本次补录对应的 fresh local 验证命令为 `npm --prefix frontend run test -- InstanceTopology` 与 `npm --prefix frontend run build`

#### 6.2.3 SHA

- 当前仓库提交 SHA：按任务要求本次未执行 git 命令，当前 SHA 待后续由编排者基于真实仓库状态补录
- 参考对象对应 SHA：`737f7d7feb52441ae5219b8174662eaad1760e2c`

#### 6.2.4 截图

- 访问 URL：`http://175.178.213.10:5173/topology`
- 截图路径：当前无已登录 topology 结构截图。已知 deployed 浏览器未带认证访问 `/topology` 会被门禁重定向到 `/login`，因此当前没有可审计的 authenticated topology 截图文件
- 时间戳：当前仓库内没有 topology 已登录截图时间戳。未认证访问被 `/login` 门禁阻断的浏览器观察存在，但未形成仓库内截图文件，本节不伪造

#### 6.2.5 请求证据

- 页面可见对账线索：`frontend/src/components/InstanceTopology.tsx` 的 `requestClues` 面板固定展示 `request_id / freshness / checked_at / diagnostics`，并由 `frontend/src/components/InstanceTopology.test.tsx` 的 `renders routing-graph framing, request clues, and canvas controls` 与 `frontend/src/components/InstanceTopology.readonly.test.tsx` 的 `shows compact request clues instead of observer-only footer framing` 锁定
- `request_id`：local 成功态样本 `req-topology-1`，refresh 后样本 `req-topology-2`，empty 样本 `req-topology-empty`，failed/retry 样本 `req-topology-503 -> req-topology-recovered`，unauthorized 样本 `req-topology-401`，readonly 样本 `req-topology-readonly`
- 已部署后端请求记录：当前缺失。已知 deployed 浏览器在未认证状态访问 `http://175.178.213.10:5173/topology` 会被重定向到 `/login`，尚未取得 topology 已认证 `request_id` 或后端请求日志
- refresh / retry 同链路证据：`frontend/src/components/InstanceTopology.test.tsx` 的 `re-reads aggregate topology when refresh is triggered from the successful state` 与 `re-reads aggregate topology when retry is triggered from the failed state` 断言两次都继续调用 `getAggregateTopology`，`request_id` 分别从 `req-topology-1 -> req-topology-2`、`req-topology-503 -> req-topology-recovered`
- 进入规则证据：`frontend/src/components/InstanceTopology.test.tsx` 的 `shows explicit session entry rules for agent and session nodes` 断言智能体节点入口为 `/session/instance-alpha/agent-alpha`，会话节点入口为 `/session/instance-alpha/agent-alpha?session=agent%3Aagent-alpha%3Amain`；`frontend/src/components/InstanceTopology.readonly.test.tsx` 的 `shows explicit entry and disabled states without write controls` 再次锁定 agent 可进入、instance 禁用
- 禁用规则或负向样本证据：`frontend/src/components/InstanceTopology.test.tsx` 的 `shows fallback and disabled rules for tool and instance nodes` 断言 tool 节点只能回退到所属智能体、instance 节点不提供会话入口、孤儿 tool 显示“缺少可回退上下文”；`disables agent and session nodes when required context is missing` 覆盖缺少上下文时的 disabled 态；`does not render legacy skill or ACP nodes` 与 `frontend/src/components/InstanceTopology.readonly.test.tsx` 的 `does not expose destructive or write-operation controls` 锁定旧 `skill / ACP` 语义和写操作控件均不存在

#### 6.2.6 状态验收

| 状态 | 结果 | 证据位置 | 时间戳 | 备注 |
| --- | --- | --- | --- | --- |
| loading | local 通过 | `frontend/src/components/InstanceTopology.test.tsx` 的 `keeps the routing-stage shell visible while aggregate topology is loading` | 无 | 仍保留 `Routing Graph 主舞台` 壳层与单画布容器，加载文案明确说明继续通过 `getAggregateTopology` 同步路由关系 |
| empty | local 通过 | `frontend/src/components/InstanceTopology.test.tsx` 的 `keeps the topology shell and shows an explicit empty state when the aggregate payload has no graph data` | `2026-03-22T12:05:00Z` | 聚合读取成功但 `instances / agents / sessions / tools / edges` 全空，壳层与请求线索仍保留，不伪装为成功有图 |
| partial_failure | local 通过 | `frontend/src/components/InstanceTopology.test.tsx` 的 `keeps successful topology content visible while surfacing partial failure diagnostics` | `2026-03-22T12:05:00Z` | 当前证据来自 diagnostics 推导出的部分失败提示，受影响实例显示为 `empty-instance`，成功内容继续可见，未额外伪造 payload 显式 `partial_failure=true` 样本 |
| failed | local 通过 | `frontend/src/components/InstanceTopology.test.tsx` 的 `surfaces aggregate request failures with error envelope` 与 `provides retry button on error` | 无 | failed 态显示 `code / request_id / recoverable / next_step`，并保留显式 `重试` 入口，失败样本 `request_id` 为 `req-topology-503` |
| unauthorized | local 通过 | `frontend/src/components/InstanceTopology.test.tsx` 的 `shows an explicit unauthorized state instead of a generic failed state` | 无 | 401 被单独展示为“当前无权查看拓扑”，不混同 generic failed；deployed 未认证浏览器访问 `/topology` 还会先被前端门禁重定向到 `/login` |
| stale | local 通过 | `frontend/src/components/InstanceTopology.test.tsx` 的 `shows an explicit stale notice while keeping topology content visible` | `2026-03-22T11:20:00Z` | stale 提示与拓扑节点并存，`freshness · stale` 明确可见，不替换成功内容 |

#### 6.2.7 特殊说明

- 主链路样本记录：`frontend/src/components/InstanceTopology.test.tsx` 的 `renders routing-graph framing, request clues, and canvas controls`、`shows explicit session entry rules for agent and session nodes`、`renders tool nodes connected via edges from backend`，以及 `tests/integration/test_aggregate_api.py` 的 `test_topology_returns_four_lane_relationships_with_sessions_and_tools` 共同锁定 topology 当前主链路为四泳道 `实例 / 智能体 / 会话 / 工具`、圆形节点、单画布主舞台，以及后端 `instances / agents / sessions / tools / edges` 聚合契约
- 负向样本记录：`frontend/src/components/InstanceTopology.test.tsx` 的 `keeps topology as a single routing stage without sidebar or detail panels`、`does not render legacy skill or ACP nodes`，以及 `frontend/src/components/InstanceTopology.readonly.test.tsx` 的 `renders a routing-graph stage shell without sidebar or detail panels`、`does not expose destructive or write-operation controls` 共同证明 topology 没有 sidebar/detail/config 工作台回流，也没有旧 `skill / ACP` 语义或写操作控件
- unauthorized 豁免说明及证据：本页当前不做 unauthorized 豁免。`app/api/aggregate.py` 在未认证时对 `/aggregate/topology` 返回 `401 unauthorized`，`frontend/src/main.tsx` 与 `frontend/src/components/LoginPage.test.tsx` 证明 `/topology` 属于 `ProtectedRoute`，未认证访问会被导向 `/login`；真实 deployed 浏览器观察也确认访问 `http://175.178.213.10:5173/topology` 未带登录态时会跳转 `/login`，因此当前只有门禁阻断事实，没有已登录 topology 截图、已部署 `request_id` 或后端请求记录
- 其他补充：`TopologyPage -> InstanceTopology` 仍是唯一本地承载链路；`app/services/aggregate_service.py` 从 `topology_snapshot` 组装 `sessions / tools / edges`，`frontend/src/components/InstanceTopology.tsx` 用 `buildNodeSessionAction` 明确区分 `enter / fallback / disabled`，refresh 与 retry 都继续命中 `getAggregateTopology`，未引入旁路读取

### 6.3 kanban 记录模板

#### 6.3.1 参考锚点

- 页面/模块名：`kanban`
- 参考仓库名：`abhi1693/openclaw-mission-control`
- 可定位页面或组件对象：`frontend/src/app/boards/[boardId]/page.tsx`、`frontend/src/components/organisms/TaskBoard.tsx`、`frontend/src/components/molecules/TaskCard.tsx`、`frontend/src/api/generated/tasks/tasks.ts`、`backend/app/api/tasks.py`
- 来源说明：plan 当前 literal 写法是 `openclaw/mission-control`，但本次公开直查未解析到可直接审计的同名仓库对象，因此不能把该 literal 直接记成已定位事实。结合公开检索结果与对象可达性，本次以 `abhi1693/openclaw-mission-control` 作为可移植参考锚点，因为它同时具备显式 `OpenClaw + mission-control` 命名、可审计的 board 页面对象、`TaskBoard / TaskCard` 前端对象，以及生成的 tasks API client 与 `backend/app/api/tasks.py` 后端任务路由。
- 仓库外参考对象重定位说明：当前本地 `/kanban` 仍由 `frontend/src/main.tsx` 路由到 `frontend/src/components/CollabPage.tsx`。`CollabPage` 当前已经是派生 task board 表达，不再沿用旧 agent signal board 文案，但其数据来源仍是 `getAggregateOverview` 返回的 `AggregateOverviewAgentItem`，再归并到 `needs_attention / in_progress / pending_review / completed` 四列，并通过 `drilldown_path` 承接 session 入口；因此它是基于 overview 聚合读链路派生出的任务板，而不是 mission-control 语义下“每卡一个后端 task 对象”的任务板。

#### 6.3.2 实现路径

- 前端实现路径：`frontend/src/main.tsx`、`frontend/src/components/CollabPage.tsx`
- 后端实现路径：当前本地未见独立 kanban task-board 后端对象，本页仍经 `getAggregateOverview` 复用 overview 聚合读链路，尚未落到任务板专属 tasks API，也不能如实记成已存在本地 `tasks.py` 对应实现
- 测试路径：`frontend/src/components/CollabPage.test.tsx`
- 相关报告路径：仓库内无独立 kanban report 文件，本节与本文件末尾 Task 4.1 追加记录共同构成当前唯一留痕

#### 6.3.3 SHA

- 当前仓库提交 SHA：按任务要求本次未执行 git 命令，当前 SHA 待后续由编排者基于真实仓库状态补录
- 参考对象对应 SHA：`6a66e463c438bc73ebb3d5cd2cf61df9cf63e045`

#### 6.3.4 截图

- 访问 URL：`http://175.178.213.10:5173/kanban`
- 截图路径：当前无 authenticated kanban 截图。已知 deployed 浏览器在未登录状态访问 `/kanban` 会被前端门禁重定向到 `/login`，因此当前没有可审计的已登录 kanban 截图文件
- 时间戳：当前仓库内没有 kanban 已登录截图时间戳。现有事实只有“未带认证访问 `http://175.178.213.10:5173/kanban` 会跳转 `/login`”这一浏览器观察，本节不伪造截图时间或截图路径

#### 6.3.5 请求证据

- 页面可见对账线索：`frontend/src/components/CollabPage.tsx` 的 `KanbanRequestClues` 固定展示 `request_id / freshness / checked_at / diagnostics`，并由 `frontend/src/components/CollabPage.test.tsx` 的 `shows request clues for reconciliation in successful and partial-success states` 锁定成功态与 partial-success 态都可见
- `request_id`：local 成功态样本 `req-kanban`，refresh 后样本 `req-kanban-2`，failed/retry 样本 `req-kanban-503 -> req-kanban-recovered`，unauthorized 样本 `req-kanban-401`
- 已部署后端请求记录：当前缺失。已知 deployed 浏览器未登录访问 `http://175.178.213.10:5173/kanban` 会先被门禁重定向到 `/login`，尚未取得 kanban 已认证 `request_id` 或后端请求日志
- 任务上下文或 session 承接证据：`frontend/src/components/CollabPage.test.tsx` 的 `keeps task context entry separate from session workspace jump` 断言卡片先通过“进入任务上下文”展开 `任务上下文锚点`，再由有效 `drilldown_path` 渲染 `进入 session 工作区` 链接，样本链接为 `/session/instance-context/agent-context`
- 负向样本证据：`frontend/src/components/CollabPage.test.tsx` 的 `shows disabled session fallback when task card lacks a valid session entry path` 断言空 `drilldown_path` 会渲染 disabled 的“进入 session 工作区”按钮，并显示回退提示 `需先在 topology / team / session 确认可用会话入口`
- refresh / retry 同链路证据：`frontend/src/components/CollabPage.test.tsx` 的 `re-reads aggregate overview when refresh is triggered from the successful state` 与 `re-reads aggregate overview when retry is triggered from the failed state` 共同锁定两种动作都继续调用 `getAggregateOverview`，没有引入旁路读取

#### 6.3.6 状态验收

| 状态 | 结果 | 证据位置 | 时间戳 | 备注 |
| --- | --- | --- | --- | --- |
| loading | local 通过 | `frontend/src/components/CollabPage.test.tsx` 的 `keeps the board shell visible while aggregate overview is loading` | 无 | 加载中仍保留标题、状态 notice、四列板面壳层与列标题，不把 kanban 主舞台整体替换掉 |
| empty | local 通过 | `frontend/src/components/CollabPage.test.tsx` 的 `keeps the board shell visible with explicit empty-state language when no tasks can be derived` | `2026-03-22T12:10:00Z` | 时间来自 mocked `freshness.checked_at`，空态仍保留四列板面与 `去 topology 核对入口`，不伪装为成功有卡 |
| partial_failure | local 通过 | `frontend/src/components/CollabPage.test.tsx` 的 `shows request clues for reconciliation in successful and partial-success states`、`prioritizes failed diagnostics into attention tasks instead of active signal cards` | `2026-03-22T12:10:00Z` | 成功内容继续可见，同时显示 `部分数据不可用`、`diagnostics · 2 total / 1 failed`，失败实例优先落入 `needs_attention` |
| failed | local 通过 | `frontend/src/components/CollabPage.test.tsx` 的 `shows a readable failed state with request evidence and retry` | 无 | failed 态展示 `code / request_id / recoverable / next_step` 与显式 `重试`，失败样本 `request_id` 为 `req-kanban-503` |
| unauthorized | local 通过 | `frontend/src/components/CollabPage.test.tsx` 的 `shows an explicit unauthorized state instead of a generic failure state` | 无 | 401 被单独展示为“当前无权查看任务板”，不混同 generic failed；deployed 未登录浏览器访问 `/kanban` 还会先被门禁重定向到 `/login` |
| stale | local 通过 | `frontend/src/components/CollabPage.test.tsx` 的 `shows an explicit stale notice while keeping task-board content visible` | `2026-03-22T11:40:00Z` | stale 提示与任务板内容并存，`freshness · 数据滞后` 明确可见，不替换成功内容 |

#### 6.3.7 特殊说明

- 主链路样本记录：`frontend/src/main.tsx` 明确 `/kanban` 当前受 `ProtectedRoute` 保护并路由到 `CollabPage`；`frontend/src/components/CollabPage.tsx` 明确当前页面通过 `getAggregateOverview` 读取 overview 聚合响应，再按 agent 状态与 instance diagnostics 派生四列任务卡；`frontend/src/components/CollabPage.test.tsx` 的 `renders task-board summary and stage framing instead of a read-only signal board`、`renders task cards with intent, ownership context and an explicit action row`、`keeps task context entry separate from session workspace jump` 进一步锁定当前 post-4.5 口径已经是派生 task board、卡片级任务上下文展开与有效 session 进入样本
- 负向样本记录：`frontend/src/components/CollabPage.test.tsx` 的 `shows disabled session fallback when task card lacks a valid session entry path` 证明 invalid 或 empty `drilldown_path` 不会伪装成可点击 session 入口，而是 disabled 按钮加回退提示；同时，当前本地 kanban 仍以 `AggregateOverviewAgentItem` 为派生卡片对象，没有单任务详情、任务移动、审批、评论、依赖管理或本地后端 tasks API，因此不能把现状写成 mission-control 的后端任务板
- unauthorized 豁免说明及证据：本页当前不做 unauthorized 豁免。`frontend/src/main.tsx` 已锁定 `/kanban` 属于 `ProtectedRoute`，真实 deployed 浏览器观察也确认未登录访问 `http://175.178.213.10:5173/kanban` 会跳转 `/login`；因此当前只有登录门禁阻断事实，没有已登录 kanban 截图、已部署 `request_id` 或后端请求记录
- 其他补充：当前 kanban 的真实形态是基于 overview 聚合读链路派生出的任务板，而不是旧 gap 描述里的只读 signal board 文案，也不是 mission-control 那种由独立 task 对象驱动的完整任务板。refresh 与 failed 态 retry 都继续命中 `getAggregateOverview` 同一读链路，卡片则用 `任务上下文锚点` + `进入 session 工作区` 两段式动作区承接当前真实能力边界

### 6.4 team 记录模板

#### 6.4.1 参考锚点

- 页面/模块名：`team`
- 参考仓库名：`TianyiDataScience/openclaw-control-center`
- 可定位页面或组件对象：`src/ui/server.ts` 中的 `section=team` / `label: "Staff"`、`src/ui/server.ts` 中 `renderStaffOverviewCards` 相关区域、`test/office-roster.test.ts`、`test/ui-render-smoke.test.ts`、`docs/assets/staff-en.png`、`docs/assets/staff-zh.png`
- 来源说明：plan literal 当前写法是 `openclaw/center`，但本次 public direct lookup 无法把该 literal 解析成可直接审计的公开仓库对象，因此不能把 `openclaw/center` 直接记成已定位事实。本次冻结的可移植参考对象改记为 `TianyiDataScience/openclaw-control-center`，因为它公开可达，且同时提供 `Staff` section、`renderStaffOverviewCards`、Staff 相关测试与中英文截图素材，能够支撑后续 `team` 页面语义锁定与实现委派。
- 仓库外参考对象重定位说明：当前本地承载对象已落到 `frontend/src/components/TeamPage.tsx` 中的 `TeamPage`，并由 `frontend/src/main.tsx` 的受保护 `/team` 路由与 `frontend/src/components/Layout.tsx` 的 team 导航入口承接。当前真实页面已不是缺页 gap，而是 staff-like 的 persistent agent cards 主舞台；它复用 `overview -> listSessions -> previewSessions` 读链路沉淀团队席位，不额外伪造 team roster API。

#### 6.4.2 实现路径

- 前端实现路径：`frontend/src/main.tsx`、`frontend/src/components/Layout.tsx`、`frontend/src/components/TeamPage.tsx`
- 后端实现路径：当前本地仍未见 `team` 专属 roster API。`frontend/src/components/TeamPage.tsx` 当前通过 `getAggregateOverview` 读取 agent 主体，再按 agent + instance 继续调用 `listSessions` 与 `previewSessions` 补齐最近会话时间、会话开头与 session 进入样本，因此本页属于前端聚合派生承载，不应误记成独立 team 后端实现
- 测试路径：`frontend/src/components/TeamPage.test.tsx`
- 相关报告路径：仓库内无独立 `team` report 文件，本节即当前唯一留痕载体。本次补录以 `frontend/src/main.tsx`、`frontend/src/components/Layout.tsx`、`frontend/src/components/TeamPage.tsx`、`frontend/src/components/TeamPage.test.tsx` 为主证据

#### 6.4.3 SHA

- 当前仓库提交 SHA：按任务要求本次未执行 git 命令，当前 SHA 待后续由编排者基于真实仓库状态补录
- 参考对象对应 SHA：`473f42bb412f3dc70ac6c6f33f59a8b53fa6cf8b`（当前 main head）、`d002386bc220e1d5ac26283b761ad476ed805e24`（initial/core staff entry）、`bdeb045dba0e81e48b206b95b3ba9982ba423b98`（staff card/avatar related major refactor）

#### 6.4.4 截图

- 访问 URL：`http://175.178.213.10:5173/team`
- 截图路径：当前无 authenticated team 截图。已知 deployed 浏览器在未登录状态访问 `http://175.178.213.10:5173/team` 会被前端门禁重定向到 `/login`，因此当前没有可审计的已登录 team 截图文件
- 时间戳：当前仓库内没有 team 已登录截图时间戳，也没有可补录的截图路径。现有 deployed 浏览器事实只有“未带认证访问 `/team` 被重定向到 `/login`”，本节不伪造截图时间或截图文件

#### 6.4.5 请求证据

- 页面可见对账线索：`frontend/src/components/TeamPage.tsx` 的 `TeamRequestClues` 在成功态展示 `request_id / freshness / checked_at / diagnostics`，并额外把当前真实读链路写成 `read_chain · overview -> listSessions -> previewSessions`；`frontend/src/components/TeamPage.test.tsx` 的 `shows request clues and a partial-failure notice while keeping successful team cards visible` 锁定该组线索可见
- `request_id`：local 成功态样本 `req-team-1`，refresh 后样本 `req-team-2`，failed/retry 样本 `req-team-503 -> req-team-recovered`，unauthorized 样本 `req-team-401`
- 已部署后端请求记录：当前缺失。已知 deployed 浏览器未登录访问 `http://175.178.213.10:5173/team` 会先被前端门禁重定向到 `/login`，尚未取得 authenticated team `request_id` 或后端请求日志
- persistent agent card 样本：`frontend/src/components/TeamPage.test.tsx` 的 `renders persistent agent cards with the frozen minimum fields from truthful frontend reads` 锁定卡片最小字段为头像、agent 名称、instance 名称、状态、最后会话时间、会话开头。样本包括 `Alpha Agent / alpha-instance / 运行中 / 2024-03-24 07:59 / Alpha kickoff opened...`，以及 `Beta Agent / beta-instance / 空闲 / 2024-03-24 00:00 / Beta review started...`
- session 进入样本：`frontend/src/components/TeamPage.test.tsx` 的 `uses the latest session as the default landing when the card or primary CTA is activated` 锁定最近会话优先样本为 `/session/instance-alpha/agent-alpha?session=session-alpha-2`；`keeps the minimum fields visible with truthful empty-session fallbacks when an agent has no sessions` 锁定无历史会话时的默认工作区回退样本为 `/session/instance-alpha/agent-alpha`
- 负向样本证据：`frontend/src/components/TeamPage.test.tsx` 的 `disables session entry when the basic agent context is missing` 锁定缺少 `instance_id` 或 `agent_id` 时入口 badge 为“入口不可用：缺少基础上下文”，主 CTA 变成 disabled 的“当前不可进入 session 工作区”，且不会继续触发 `listSessions` / `previewSessions`
- refresh / retry 同链路证据：`frontend/src/components/TeamPage.test.tsx` 的 `re-reads the same overview and session chain when refresh is triggered from the successful state` 与 `shows a readable failed state with request evidence and retries the same truthful read chain` 共同锁定 refresh 与 retry 都继续命中同一条 `overview -> listSessions -> previewSessions` 读链路，而不是旁路 team API

#### 6.4.6 状态验收

| 状态 | 结果 | 证据位置 | 时间戳 | 备注 |
| --- | --- | --- | --- | --- |
| loading | local 通过 | `frontend/src/components/TeamPage.test.tsx` 的 `keeps the team shell visible while aggregate overview is loading` | 无 | 保留团队标题、`Persistent Agent Cards` 壳层、加载文案与卡片占位，不把 team 主舞台整体替换掉 |
| empty | local 通过 | `frontend/src/components/TeamPage.test.tsx` 的 `keeps the team stage shell visible with explicit empty language when no team cards can be derived` | `2026-03-24T08:00:00Z` | 时间来自 mocked `freshness.checked_at`，空态仍保留 team stage 壳层与 `request_id · req-team-1`，不伪装成成功有卡 |
| partial_failure | local 通过 | `frontend/src/components/TeamPage.test.tsx` 的 `shows request clues and a partial-failure notice while keeping successful team cards visible` 与 `surfaces derived read failures instead of disguising them as empty sessions or generic openings` | `2026-03-24T08:00:00Z` | 同时覆盖 overview diagnostics 失败与派生读取失败两类样本。成功卡片继续可见，并补充部分失败说明，不把问题伪装为空态 |
| failed | local 通过 | `frontend/src/components/TeamPage.test.tsx` 的 `shows a readable failed state with request evidence and retries the same truthful read chain` 与 `shows an explicit failed state when the overview payload freshness itself is failed` | `2026-03-24T07:30:00Z` | 同时覆盖请求失败与 payload `freshness = failed` 两种 failed 口径，前者保留 `code / request_id / recoverable / next_step` 与 retry，后者显式提示当前返回的团队聚合结果已标记为失败 |
| unauthorized | local 通过 | `frontend/src/components/TeamPage.test.tsx` 的 `shows an explicit unauthorized state instead of a generic failure state` | 无 | 401 被单独展示为“当前无权查看团队页”，并显示 `request_id · req-team-401`；deployed 未登录浏览器访问 `/team` 还会先被门禁重定向到 `/login` |
| stale | local 通过 | `frontend/src/components/TeamPage.test.tsx` 的 `shows an explicit stale notice while keeping team cards visible` | `2026-03-24T07:40:00Z` | stale 提示与 team cards 并存，`freshness · 数据滞后` 明确可见，不替换成功内容 |

#### 6.4.7 特殊说明

- 主链路样本记录：`frontend/src/main.tsx` 已锁定 `/team` 属于 `ProtectedRoute` 下的一页；`frontend/src/components/Layout.tsx` 的 `PRIMARY_NAV_ITEMS` 已把 `团队` 纳入一级导航；`frontend/src/components/TeamPage.tsx` 与 `frontend/src/components/TeamPage.test.tsx` 共同锁定当前页面已经是 staff-like persistent agent cards 主舞台，不再是 5.1 时代的缺页 gap
- 负向样本记录：当前 team 的真实能力边界仍是前端派生页，而不是独立团队管理后台。`frontend/src/components/TeamPage.tsx` 只复用 `getAggregateOverview + listSessions + previewSessions`，没有 team 自有 roster API；同时 `frontend/src/components/TeamPage.test.tsx` 已锁定缺少基础上下文时禁用 session 入口，避免把无效卡片伪装成可点击样本
- unauthorized 豁免说明及证据：本页当前不做 unauthorized 豁免。local 组件测试已经覆盖 401 页面态；已知 deployed 浏览器事实是未登录访问 `http://175.178.213.10:5173/team` 会被重定向到 `/login`，因此当前只有登录门禁阻断事实，没有 authenticated team 截图、已部署 `request_id` 或后端请求记录
- 其他补充：team 当前真实结构已经能独立说明锚点、本地实现路径、请求线索、persistent card 最小字段、最近会话优先进入样本、默认工作区回退样本、disabled 负向样本与状态矩阵结果。refresh 与 retry 继续复用 overview 派生读链路，后续若要补充更细的团队管理能力，必须先在文档中明确是否引入新的后端契约

### 6.5 session 记录模板

#### 6.5.1 参考锚点

- 页面/模块名：`session`
- 参考仓库名：待后续补充真实可审计参考对象
- 可定位页面或组件对象：当前未锁定到仓库外可审计参考对象；本次先把 plan literal `LINPO-SESSION-WORKSPACE-V1` 绑定到本地可复核承载对象 `frontend/src/components/SessionPage.tsx` 的 `SessionPage` 与 `frontend/src/components/AgentWorkspace.tsx` 的 `AgentWorkspace`
- 来源说明：truth docs 已冻结 `LINPO-SESSION-WORKSPACE-V1` 的目标语义为 agent header、左侧渠道区、左侧会话区、当前会话主区、输入发送区五块同时成立的会话工作区；但当前真实代码仍未落到 `/session/:agentId/:channelKey/:sessionKey`。`SessionPage` 现仍导出 `buildCanonicalSessionPath(instanceId, agentId, search?)` 与 `buildSessionEntryPath({ instanceId, agentId, preferredSessionKey, search })`，其 helper 真相仍是旧 `/session/:instanceId/:agentId` 入口，再通过 `session` query 传递 `preferredSessionKey`
- 仓库外参考对象重定位说明：当前没有足够证据把 `LINPO-SESSION-WORKSPACE-V1` 直接绑定到某个仓库外页面对象或公开样本，也没有可审计外部 SHA；本次只冻结本地承载对象与当前 helper/route 事实，仓库外参考对象待后续补充真实可审计证据

#### 6.5.2 实现路径

- 前端实现路径：`frontend/src/main.tsx`、`frontend/src/components/SessionPage.tsx`、`frontend/src/components/AgentWorkspace.tsx`
- 后端实现路径：`app/api/agents.py`。当前 `AgentWorkspace` 仍通过 `/agents/{agent_id}`、`/chat/sessions`、`/chat/sessions/preview` 读取 agent detail、session list 与 session preview；本次只记录现有读链路，不把这些接口误记成已完成 `agentId / channelKey / sessionKey` canonical 语义
- 测试路径：`frontend/src/components/SessionPage.test.tsx`、`frontend/src/components/AgentWorkspace.readonly.test.tsx`
- 相关报告路径：仓库内无独立 session report 文件，本节即当前唯一留痕载体
- 当前本地承载对象事实：`frontend/src/main.tsx` 仍只注册 `/session`、`/session/:instanceId`、`/session/:instanceId/:agentId` 到 `SessionPage`；`SessionPage` 负责旧 drill-down 壳层、实例 fallback 与 `session` query 透传，`AgentWorkspace` 负责在 `instanceId + agentId + preferredSessionKey` 上下文下读取会话列表与预览消息
- 当前结构差距说明：`AgentWorkspace` 当前仍是 session selector + message preview + `observer-only` disclosure 的只读承载，没有 truth docs 要求的左侧渠道区，也未把当前 URL 真源切换成 `/session/:agentId/:channelKey/:sessionKey`

#### 6.5.3 SHA

- 当前仓库提交 SHA：按任务要求本次未执行 git 命令，当前 SHA 待后续由编排者基于真实仓库状态补录
- 参考对象对应 SHA：当前无可审计仓库外参考对象，待后续补充真实参考对象与对应 SHA；不能仅凭 `LINPO-SESSION-WORKSPACE-V1` literal 伪造外部 SHA

#### 6.5.4 截图

- 访问 URL：local canonical 样本 `'/session/main/agent/agent%3Aagent-alpha%3Amain?instanceId=inst-2'`，local 空工作区 fallback 样本 `'/session/main/__none__/__new__?instanceId=inst-2'`；deployed 未登录门禁检查当前只确认 session canonical URLs 访问会被重定向到 `/login`
- 截图路径：当前无 authenticated session 工作区截图。已知 deployed 未登录浏览器访问 session canonical URLs 会被前端门禁重定向到 `/login`，因此当前只有登录门禁样本，没有可审计的 authenticated screenshot 文件
- 时间戳：`2026-03-24T05:39:49+08:00` 为本次补录时间；local 结构证据改由 `frontend/src/components/SessionPage.test.tsx` 与 `frontend/src/components/AgentWorkspace.readonly.test.tsx` 承担，deployed 门禁观察当前无仓库内截图时间戳，本节不伪造

#### 6.5.5 请求证据

- 页面可见对账线索：`frontend/src/components/AgentWorkspace.readonly.test.tsx` 的 `shows request clues and an explicit empty workspace state when no sessions are available` 与 `truthfully marks stale state from aged preview timestamp instead of inventing aggregate freshness` 锁定 `AgentWorkspace` 当前固定展示 `read chain · getAgentDetail -> listSessions -> previewSessions (+ realtime after selection)`、`request_id`、推断 `freshness` 与 `diagnostics`
- `request_id`：local unauthorized 样本 `req-session-401`；非错误 local 样本当前明确显示 `request_id · 当前真实读链路未返回 aggregate request_id`，因此不能伪造 deployed request_id
- 已部署后端请求记录：当前缺失。已知 deployed 未登录浏览器访问 session canonical URLs 会先被前端门禁重定向到 `/login`，尚未取得 authenticated session `request_id` 或后端请求日志
- 渠道切换证据：当前 local 只验证 truthful canonical/fallback route 形态与 route context handoff。`frontend/src/components/SessionPage.test.tsx` 的 `buildSessionEntryPath upgrades truthful session context into the new canonical shape` 锁定 `/session/main/agent/agent%3Aagent-alpha%3Amain?instanceId=inst-2`，`frontend/src/components/SessionPage.tsx` 的 `buildSessionEntryPath` 明写存在 `resolvedChannelKey` 但不存在 `preferredSessionKey` 时会落到 `/:channelKey/__new__`，因此当前只有 route 级切换样本，没有 deployed 已登录渠道切换截图
- 会话切换证据：`frontend/src/components/AgentWorkspace.test.ts` 的 `keeps explicit preferred session ahead of the current valid server-backed selection`、`falls back to the first current valid server session when no explicit session exists` 与 `frontend/src/components/SessionPage.test.tsx` 的 `passes preferred session key from canonical params to AgentWorkspace` 共同锁定当前显式 precedence 为 `preferredSessionKey > 当前仍存在于 listSessions 的会话 > sessions[0]`
- 输入或发送证据：`frontend/src/components/AgentWorkspace.readonly.test.tsx` 的 `renders input/send area with readonly explanation`、`shows collapsed disclosure and hides destructive session controls`、`shows an explicit unauthorized state and keeps the input zone readonly with a visible reason` 共同证明当前 UI 只保留输入区结构、readonly disclosure 与 unauthorized 禁用原因；本次记录 pass 没有 authenticated deployed 发送截图、发送成功证据或 send request_id

#### 6.5.6 状态验收

| 状态 | 结果 | 证据位置 | 时间戳 | 备注 |
| --- | --- | --- | --- | --- |
| loading | local 通过 | `frontend/src/components/AgentWorkspace.readonly.test.tsx` 的 `shows a loading state while the session shell is still fetching` | 无 | 加载中仍保留 session shell，可见 `session-stream-shell` 与 `加载中...`，不把工作区直接替换成空白页 |
| empty | local 通过 | `frontend/src/components/AgentWorkspace.readonly.test.tsx` 的 `shows request clues and an explicit empty workspace state when no sessions are available` | `2026-03-24T05:30:00Z` | 空工作区保留 request clues，并明确显示 `request_id · 当前真实读链路未返回 aggregate request_id` 与 `diagnostics · getAgentDetail ok · listSessions empty(0) · previewSessions skipped` |
| partial_failure | local 通过 | `frontend/src/components/AgentWorkspace.readonly.test.tsx` 的 `surfaces downstream list failure as partial failure instead of swallowing it into an empty state` 与 `surfaces downstream preview failure with the selected session still visible` | 无统一时间戳 | 同时覆盖 `listSessions` 下游失败与 `previewSessions` 下游失败，两者都保留真实失败线索，不伪装为空工作区 |
| failed | local 通过 | `frontend/src/components/AgentWorkspace.readonly.test.tsx` 的 `shows an explicit failed state when the core agent shell cannot be established` | 无 | `getAgentDetail` 建壳失败时显式进入 failed，显示 `getAgentDetail 失败：agent snapshot unavailable` 与 `诊断状态 · failed` |
| unauthorized | local 通过 | `frontend/src/components/AgentWorkspace.readonly.test.tsx` 的 `shows an explicit unauthorized state and keeps the input zone readonly with a visible reason` | 无 | 401 单独展示 `request_id · req-session-401`、`diagnostic_reason · 当前账号缺少 session 读取权限`，输入区保持只读并提示原因 |
| stale | local 通过 | `frontend/src/components/AgentWorkspace.readonly.test.tsx` 的 `truthfully marks stale state from aged preview timestamp instead of inventing aggregate freshness` | `2026-03-24T05:31:00Z` | stale 文案明确写成 `freshness · inferred stale from previewSessions.ts`，并说明当前 session 没有 aggregate freshness，只根据最近一次 list/preview ts 推断 |

#### 6.5.7 样本记录位

##### canonical session 样本

- 访问 URL：local canonical 样本 `'/session/main/agent/agent%3Aagent-alpha%3Amain?instanceId=inst-2'`
- 样本来源：`frontend/src/components/SessionPage.test.tsx` 的 `buildSessionEntryPath upgrades truthful session context into the new canonical shape`、`upgrades legacy /session/:instanceId/:agentId into the new canonical route`、`passes preferred session key from canonical params to AgentWorkspace`
- 截图：当前无 authenticated screenshot；local canonical 证据由 route/context 测试断言承担
- `request_id`：当前真实读链路未返回 aggregate request_id
- 请求记录：local request clues 固定展示 `getAgentDetail -> listSessions -> previewSessions (+ realtime after selection)`；当前 record pass 无 deployed authenticated 请求对账记录
- 状态验收结果：local canonical route handoff 通过，且 canonical params 会透传到 `AgentWorkspace`；deployed 未登录浏览器访问 session canonical URLs 仍会被重定向到 `/login`
- 时间戳：`2026-03-24T05:39:49+08:00`

##### 空工作区 canonical 样本

- 访问 URL：local 空工作区样本 `'/session/main/__none__/__new__?instanceId=inst-2'`
- 样本来源：`frontend/src/components/SessionPage.test.tsx` 的 `upgrades legacy /session/:instanceId to empty workspace canonical route and preserves query string` 与 `frontend/src/components/AgentWorkspace.readonly.test.tsx` 的 `shows request clues and an explicit empty workspace state when no sessions are available`
- 截图：当前无 authenticated screenshot；local 空工作区证据由 route upgrade + empty-state 测试承担
- `request_id`：当前真实读链路未返回 aggregate request_id
- 请求记录：`diagnostics · getAgentDetail ok · listSessions empty(0) · previewSessions skipped`
- 状态验收结果：local 空工作区样本通过，request clues 与 explicit empty language 同时可见，不伪装成成功有会话或 generic failed
- 时间戳：`2026-03-24T05:30:00Z`

##### 空会话 canonical 样本

- 访问 URL：local 空会话 canonical 形态 `'/session/main/agent/__new__?instanceId=inst-2'`
- 样本来源：Task 6.3 已验证空会话 fallback `/session/:agentId/:channelKey/__new__` 存在；`frontend/src/components/SessionPage.tsx` 的 `buildSessionEntryPath` 进一步明写存在 `resolvedChannelKey` 且不存在 `preferredSessionKey` 时返回 `/:channelKey/__new__`
- 截图：当前无 authenticated screenshot，也没有本次补录范围内的独立 empty-session browser screenshot
- `request_id`：当前无独立 empty-session request_id 样本；真实读链路非 aggregate，本节不伪造
- 请求记录：当前只有 local helper / route-shape 证据，本次 record pass 没有 authenticated preview/read screenshot 与 deployed log
- 状态验收结果：空会话 fallback 形态已在本地 helper 与既有 Task 6.3 验证中冻结；当前没有单独 deployed 已登录 empty-session 验收样本
- 时间戳：`2026-03-24T05:39:49+08:00`

##### unauthorized 样本

- 测试身份：local unauthorized 组件样本 + deployed 未登录浏览器门禁样本
- 访问 URL：local 401 页面态由 `frontend/src/components/AgentWorkspace.readonly.test.tsx` 直接构造；deployed 门禁样本当前只确认 `http://175.178.213.10:5173/session/main/__none__/__new__` 等 session canonical URLs 会被重定向到 `/login`
- 目标动作：建立 session workspace shell、查看 request clues、观察输入区可用性
- 预期受限路径：401 样本进入 explicit unauthorized 页面态；未登录浏览器访问 deployed session URLs 时跳转 `/login`
- 实际结果：local 401 样本显示 `当前无权查看该会话工作区`，并保留只读输入区原因；deployed 未登录浏览器检查当前只有门禁跳转事实，没有 authenticated workspace 画面
- 截图：当前无 authenticated screenshot；未登录门禁观察也没有仓库内截图文件
- `request_id`：`req-session-401`
- 请求记录：local error envelope 样本包含 `diagnostic_reason · 当前账号缺少 session 读取权限` 与 `next_step = 重新登录后重试`
- 时间戳：`2026-03-24T05:39:49+08:00`

##### 失败态样本

- 访问 URL：local failed 页面态由 `frontend/src/components/AgentWorkspace.readonly.test.tsx` 直接构造；当前无独立 deployed failed URL 样本
- 触发条件：`getAgentDetail` 建壳阶段失败，样本错误文案为 `agent snapshot unavailable`
- 实际结果：页面进入 explicit failed，显示 `会话工作区暂时不可用`、`getAgentDetail 失败：agent snapshot unavailable` 与 `诊断状态 · failed`
- 截图：当前无 authenticated screenshot，也没有仓库内 failed browser screenshot
- `request_id`：当前 core failed 样本未返回 request_id，本节不伪造
- 请求记录：local failed 样本当前只锁定 `getAgentDetail` error text；下游 `listSessions` / `previewSessions` 失败另在状态矩阵里作为 partial_failure 样本单列记录
- 时间戳：`2026-03-24T05:39:49+08:00`

#### 6.5.8 特殊说明

- 主链路样本记录：当前 local 主链路由 `frontend/src/components/SessionPage.test.tsx`、`frontend/src/components/AgentWorkspace.readonly.test.tsx` 与 `frontend/src/components/AgentWorkspace.test.ts` 共同锁定。`SessionPage + AgentWorkspace` 已冻结为当前 carrier；五块结构 `agent header / channel area / session area / conversation area / input shell` 存在；canonical 路由 `/session/:agentId/:channelKey/:sessionKey` 与 truthful fallback `/session/:agentId/__none__/__new__`、`/session/:agentId/:channelKey/__new__` 已存在；会话选择 precedence 也已显式写成 `preferredSessionKey > 当前仍存在于 listSessions 的会话 > sessions[0]`
- 失效 URL 上下文负向样本：`frontend/src/components/SessionPage.test.tsx` 的 `upgrades legacy /session/:instanceId to empty workspace canonical route and preserves query string` 与 `upgrades legacy /session/:instanceId/:agentId into the new canonical route` 证明旧 drill-down URL 当前会 truthfully 升级到 canonical/fallback 形态；`resolveSessionPageInstanceId keeps explicit URL instance ahead of stored memory` 与 `resolveSessionPageInstanceId falls back to stored memory only when URL has no instance context` 则锁定实例上下文 precedence 为 `URL query/legacy route > stored instance`
- unauthorized 不可豁免说明：本页当前不做 unauthorized 豁免。local 401 样本已经提供 `req-session-401` 与 readonly 输入区原因；但 deployed 浏览器检查在未登录状态访问 session canonical URLs 仍会先被重定向到 `/login`，因此当前没有 authenticated session screenshot、authenticated send evidence、deployed request_id 或后端请求记录可补
- 其他补充：本次补录只写入已验证事实。当前 session request clues 必须继续使用真实 local 文案或真实 error-envelope `request_id`，不能把 aggregate-style `request_id`、authenticated screenshot 或发送成功样本补成想象值；输入区当前只能诚实记成“结构存在、observer-only disclosure 可见、unauthorized 时有禁用原因”，不能记成已完成已登录发送链路

## 7. 共享契约记录区

### 7.1 聚合读链路共享字段

| 契约字段 | 页面范围 | 证据位置 | 时间戳 | 备注 |
| --- | --- | --- | --- | --- |
| `request_id` | overview / topology / kanban / team / session | overview 见 6.1.5 `frontend/src/components/OverviewPage.tsx` `OverviewRequestClues` 与 `frontend/src/components/OverviewPage.test.tsx`；topology 见 6.2.5 `frontend/src/components/InstanceTopology.tsx` `requestClues` 与 `frontend/src/components/InstanceTopology.test.tsx`；kanban 见 6.3.5 `frontend/src/components/CollabPage.tsx` `KanbanRequestClues` 与 `frontend/src/components/CollabPage.test.tsx`；team 见 6.4.5 `frontend/src/components/TeamPage.tsx` `TeamRequestClues` 与 `frontend/src/components/TeamPage.test.tsx`；session 见 6.5.5 `frontend/src/components/AgentWorkspace.readonly.test.tsx` 的 `request_id · 当前真实读链路未返回 aggregate request_id` 与 unauthorized 样本 `req-session-401` | `2026-03-24T05:45:50+08:00` | 前四页直接承接 aggregate-style `request_id`，session 只展示真实可得线索，成功态明确写“当前真实读链路未返回 aggregate request_id”，失败或 unauthorized 才复用真实 error envelope `request_id` |
| `freshness` | overview / topology / kanban / team / session | overview 见 6.1.5 / 6.1.6 的 `OverviewRequestClues` 与 stale/fresh 样本；topology 见 6.2.5 / 6.2.6 的 `requestClues` 与 stale 样本；kanban 见 6.3.5 / 6.3.6 的 `KanbanRequestClues`；team 见 6.4.5 / 6.4.6 的 `TeamRequestClues` 与 payload failed 样本；session 见 6.5.5 / 6.5.6 `frontend/src/components/AgentWorkspace.readonly.test.tsx` 的 `freshness · inferred fresh from listSessions.ts`、`freshness · inferred stale from previewSessions.ts` 与 `诊断状态 · failed` | `2026-03-24T05:45:50+08:00` | 前四页显示的是 aggregate payload `freshness.status + checked_at`，session 没有 aggregate freshness，只根据 `listSessions.ts / previewSessions.ts` 推断 fresh 或 stale，并在 `getAgentDetail` 建壳失败时如实进入 failed |
| `partial_failure` | overview / topology / kanban / team / session | overview 见 6.1.6 `keeps successful overview content while surfacing a partial failure notice from diagnostics` 与 `shows a partial failure notice when the payload is explicitly marked partial_failure`；topology 见 6.2.6 `keeps successful topology content visible while surfacing partial failure diagnostics`；kanban 见 6.3.6 `shows request clues for reconciliation in successful and partial-success states` 与 `prioritizes failed diagnostics into attention tasks instead of active signal cards`；team 见 6.4.6 `shows request clues and a partial-failure notice while keeping successful team cards visible` 与 `surfaces derived read failures instead of disguising them as empty sessions or generic openings`；session 见 6.5.6 `surfaces downstream list failure as partial failure instead of swallowing it into an empty state` 与 `surfaces downstream preview failure with the selected session still visible` | `2026-03-24T05:45:50+08:00` | overview / topology / kanban / team 暴露的是 aggregate-style `partial_failure` 语义，team 还会把派生失败并入说明；session 没有后端 payload boolean，`partial_failure` 通过下游 `listSessions / previewSessions` 失败诊断 truthful 呈现，而不是伪装成空成功 |
| `diagnostics` | overview / topology / kanban / team / session | overview 见 6.1.5 `diagnostics · 2 total / 1 failed`；topology 见 6.2.5 `diagnostics · 2 sources`；kanban 见 6.3.5 `diagnostics · 2 total / 1 failed`；team 见 6.4.5 `diagnostics · 2 overview / 1 failed` 与 `diagnostics · 2 overview / 0 failed / 2 derived`，并额外显示 `read_chain · overview -> listSessions -> previewSessions`；session 见 6.5.5 `read chain · getAgentDetail -> listSessions -> previewSessions (+ realtime after selection)`，以及 `diagnostics · getAgentDetail ok · listSessions empty(0) · previewSessions skipped / failed` | `2026-03-24T05:45:50+08:00` | 前四页里的 `diagnostics` 仍以 aggregate diagnostics summary 为主，team 在 summary 上追加 derived 计数；session 的 `diagnostics` 不是 aggregate source summary，而是逐步展开真实读链路结果，用来替代不存在的统一 session 聚合数组 |

### 7.2 freshness 细分记录

| 状态值 | 页面或样本 | 证据位置 | 时间戳 | 备注 |
| --- | --- | --- | --- | --- |
| fresh | overview 成功态样本 `req-overview-1`；session 空工作区样本 | overview 见 6.1.5 / 6.1.6 `frontend/src/components/OverviewPage.test.tsx` 的 `shows request clues for reconciliation in the successful overview state`；session 见 6.5.5 / 6.5.6 `frontend/src/components/AgentWorkspace.readonly.test.tsx` 的 `shows request clues and an explicit empty workspace state when no sessions are available`，文案为 `freshness · inferred fresh from listSessions.ts` | overview `2026-03-22T12:00:00Z`；session `2026-03-24T05:30:00Z` | 用同一行并列记录 aggregate fresh 与 derived fresh，避免把 session 推断 freshness 误记成与前四页同构的 payload 字段 |
| stale | overview stale 样本；team stale 样本；session inferred stale 样本 | overview 见 6.1.6 `shows an explicit stale notice while keeping overview content visible`；team 见 6.4.6 `shows an explicit stale notice while keeping team cards visible`；session 见 6.5.6 `truthfully marks stale state from aged preview timestamp instead of inventing aggregate freshness` | overview `2026-03-22T11:40:00Z`；team `2026-03-24T07:40:00Z`；session `2026-03-24T05:31:00Z` | 前两者来自 aggregate payload `freshness = stale`，session 则明确写成 `inferred stale from previewSessions.ts`，证据链不同但页面都保留可见 freshness clue |
| failed | team payload failed 样本 `req-team-failed-payload`；session core shell failed 样本 | team 见 6.4.6 `frontend/src/components/TeamPage.test.tsx` 的 `shows an explicit failed state when the overview payload freshness itself is failed`；session 见 6.5.6 `frontend/src/components/AgentWorkspace.readonly.test.tsx` 的 `shows an explicit failed state when the core agent shell cannot be established` | team `2026-03-24T07:30:00Z`；session 本次记录补录时间 `2026-03-24T05:39:49+08:00` | team 的 failed 是 aggregate payload freshness 失败，session 的 failed 是 `getAgentDetail` 建壳失败。两者都 truthful 暴露失败，但不能据此声称 session 已拥有统一 aggregate failed contract |

### 7.3 共享契约补充说明

- 字段映射说明：overview / topology / kanban / team 四页当前都以 aggregate response 为主映射 `request_id / freshness / partial_failure / diagnostics`，其中 team 虽然还追加 `overview -> listSessions -> previewSessions` 派生读取，但顶层对账字段仍锚在 overview 聚合响应；session 则不走这套 payload 映射，而是把 `getAgentDetail -> listSessions -> previewSessions (+ realtime after selection)` 的真实结果投影成同名 clue 位。
- 兼容处理说明：当前五页仍统一保留 `request_id / freshness / partial_failure / diagnostics` 这四个页面可见槽位，方便 IA 级对账与状态比较；但复审口径必须区分“字段名兼容”和“后端契约同构”不是一回事。前四页可按 aggregate-style contract 理解，session 只能按 derived truthful clue contract 理解。
- 差异点说明：前四页是 aggregate-style contract，session 是 derived truthful clue contract。session `request_id` 在成功态可缺失并明确写成“当前真实读链路未返回 aggregate request_id”；session `freshness` 来自 `listSessions.ts / previewSessions.ts` 的推断；session `partial_failure` 由 downstream failure diagnostics 表达，不存在 backend payload boolean 字段；session `diagnostics` 记录的是链路步骤结果，不是与 overview / topology / kanban / team 完全同构的聚合 diagnostics 数组。team 与 session 的 truthful 映射也不同，team 仍以 overview 聚合字段为主，再补派生失败摘要，session 则从一开始就没有 aggregate session contract 可复用。

## 8. 浏览器验收与健康检查记录区

### 8.1 必跑验证记录

| 验证项 | 命令或动作 | 结果 | 证据位置 | 时间戳 | 备注 |
| --- | --- | --- | --- | --- | --- |
| 前端测试 | `npm --prefix frontend run test` | 通过，`158 passed` | 本轮 fresh session 验证结果，另可回看本文件 6.1 ~ 6.5 的页面级前端测试证据 | `2026-03-24T05:53:27+08:00` | local 验证，作为本轮统一代码级放行证据之一 |
| 后端测试 | `/data/projects/linpo/.venv/bin/pytest` | 通过，`131 passed, 2 skipped` | 本轮 fresh session 验证结果，后端聚合与健康接口证据另见本文件 6.1、6.2 与 7.1 | `2026-03-24T05:53:27+08:00` | local 验证，显式使用仓库内 `.venv/bin/pytest` |
| 前端构建 | `npm --prefix frontend run build` | 通过 | 本轮 fresh session 验证结果 | `2026-03-24T05:53:27+08:00` | local 构建成功，无额外已登录浏览器证据 |
| 质量门 | `make quality` | 通过，覆盖 pytest + basedpyright + frontend build | 本轮 fresh session 验证结果 | `2026-03-24T05:53:27+08:00` | local 统一质量门通过 |
| 健康检查 | `curl -i http://175.178.213.10:8000/health` | 通过，返回 `HTTP/1.1 200 OK` 与 `{"status":"ok"}` | 本文件 8.2 | `2026-03-24T05:53:27+08:00` | deployed 后端健康接口可达 |
| 已部署浏览器验收 | 从 `ravin` 发起 | 仅完成未登录门禁观察，authenticated 验收未完成 | 本文件 8.3 | `2026-03-24T05:53:27+08:00` | 当前远端浏览器上下文未登录，`overview / topology / kanban / team` 的 Playwright `goto` 返回 `ERR_ABORTED`，session canonical URL 只确认最终落到 `/login` |

### 8.2 健康检查记录

- 请求时间：`2026-03-24T05:53:27+08:00`
- 响应摘要：`HTTP/1.1 200 OK`，body 为 `{"status":"ok"}`
- 结果判定：deployed 后端健康接口可达且返回健康状态，本轮健康检查通过
- 证据位置：本文件 8.1 `健康检查` 行，本轮 fresh session `curl -i http://175.178.213.10:8000/health` 结果

### 8.3 五页浏览器验收记录

| 页面 | 访问 URL | 截图 | `request_id` 或同等标识 | 已部署后端请求记录 | 时间戳 | 备注 |
| --- | --- | --- | --- | --- | --- | --- |
| overview | `http://175.178.213.10:5173/overview` | 当前无 authenticated screenshot | 无，未进入已登录页面态 | 当前缺失 | `2026-03-24T05:53:27+08:00` | 从 `ravin` 发起的 Playwright `goto` 在当前未认证远端浏览器上下文返回 `ERR_ABORTED`；只能如实记录为未登录门禁或重定向现象，不能记成已登录验收通过 |
| topology | `http://175.178.213.10:5173/topology` | 当前无 authenticated screenshot | 无，未进入已登录页面态 | 当前缺失 | `2026-03-24T05:53:27+08:00` | 从 `ravin` 发起的 Playwright `goto` 在当前未认证远端浏览器上下文返回 `ERR_ABORTED`；现阶段仅能证明登录门禁存在，不能补写 authenticated 拓扑请求证据 |
| kanban | `http://175.178.213.10:5173/kanban` | 当前无 authenticated screenshot | 无，未进入已登录页面态 | 当前缺失 | `2026-03-24T05:53:27+08:00` | 从 `ravin` 发起的 Playwright `goto` 在当前未认证远端浏览器上下文返回 `ERR_ABORTED`；只能记为未登录门禁或重定向现象 |
| team | `http://175.178.213.10:5173/team` | 当前无 authenticated screenshot | 无，未进入已登录页面态 | 当前缺失 | `2026-03-24T05:53:27+08:00` | 从 `ravin` 发起的 Playwright `goto` 在当前未认证远端浏览器上下文返回 `ERR_ABORTED`；当前没有 team 已登录浏览器验收材料 |
| session canonical | `http://175.178.213.10:5173/session/main/agent/agent%3Aagent-alpha%3Amain?instanceId=inst-2` | 当前无 authenticated screenshot | 最终 URL 落到 `/login` | 当前缺失 | `2026-03-24T05:53:27+08:00` | 已确认当前 deployed 未登录浏览器访问 session canonical URL 会落到 `/login`；这只是门禁事实，不是 authenticated session 验收 |
| session 空工作区 canonical | `http://175.178.213.10:5173/session/main/__none__/__new__?instanceId=inst-2` | 当前无 authenticated screenshot | 最终 URL 落到 `/login` | 当前缺失 | `2026-03-24T05:53:27+08:00` | 当前远端未登录浏览器上下文下，仅确认空工作区 canonical 入口同样被门禁导向 `/login` |
| session 空会话 canonical | `http://175.178.213.10:5173/session/main/agent/__new__?instanceId=inst-2` | 当前无 authenticated screenshot | 最终 URL 落到 `/login` | 当前缺失 | `2026-03-24T05:53:27+08:00` | 当前远端未登录浏览器上下文下，仅确认空会话 canonical 入口同样被门禁导向 `/login` |

### 8.4 refresh、retry 与负向样本记录

| 页面 | 动作类型 | 前证据 | 后证据 | 时间戳 | 备注 |
| --- | --- | --- | --- | --- | --- |
| overview | refresh、retry 与负向样本验证 | 本文件 6.1.5 的 `re-reads aggregate overview when refresh is triggered from the successful state`，前证据为 `request_id · req-overview-1` | 同节同用例点击刷新后得到 `request_id · req-overview-2`；retry 见 6.1.5 `re-reads aggregate overview when retry is triggered from the failed state`，负向样本见 6.1.7 `frontend/src/components/OverviewPage.test.tsx` 的 `shows an explicit unauthorized state instead of a generic failure state` | `2026-03-24T05:53:27+08:00` | refresh 与 retry 都继续命中 `getAggregateOverview`，未引入旁路读取 |
| topology | 进入规则、refresh 或 retry 与禁用规则验证 | 本文件 6.2.5 的 `shows explicit session entry rules for agent and session nodes` 与 `re-reads aggregate topology when refresh is triggered from the successful state` | 同节 `re-reads aggregate topology when retry is triggered from the failed state`、`shows fallback and disabled rules for tool and instance nodes`、`disables agent and session nodes when required context is missing`、`does not render legacy skill or ACP nodes` | `2026-03-24T05:53:27+08:00` | 8.4 对 refresh、retry 与负向样本都回链到 6.2 已冻结证据 |
| kanban | session 承接、refresh 或 retry 与负向样本验证 | 本文件 6.3.5 的 `keeps task context entry separate from session workspace jump` 与 `re-reads aggregate overview when refresh is triggered from the successful state` | 同节 `re-reads aggregate overview when retry is triggered from the failed state` 与 `shows disabled session fallback when task card lacks a valid session entry path` | `2026-03-24T05:53:27+08:00` | 卡片 session 承接继续只信任有效 `drilldown_path`，无效入口不伪装成可点击跳转 |
| team | agent 卡进入、refresh 或 retry 与负向样本验证 | 本文件 6.4.5 的 `uses the latest session as the default landing when the card or primary CTA is activated` 与 `re-reads the same overview and session chain when refresh is triggered from the successful state` | 同节 `shows a readable failed state with request evidence and retries the same truthful read chain`、`keeps the minimum fields visible with truthful empty-session fallbacks when an agent has no sessions`、`disables session entry when the basic agent context is missing` | `2026-03-24T05:53:27+08:00` | team 的 refresh / retry 继续复用 `overview -> listSessions -> previewSessions` 真实链路 |
| session | 读取、切换、输入、unauthorized 或失败态验证 | 本文件 6.5.5 / 6.5.7 的 `buildSessionEntryPath upgrades truthful session context into the new canonical shape`、`passes preferred session key from canonical params to AgentWorkspace` 与 `shows request clues and an explicit empty workspace state when no sessions are available` | 本文件 6.5.5 / 6.5.6 的 `truthfully marks stale state from aged preview timestamp instead of inventing aggregate freshness`、`shows an explicit unauthorized state and keeps the input zone readonly with a visible reason`、`shows an explicit failed state when the core agent shell cannot be established`、`renders input/send area with readonly explanation` | `2026-03-24T05:53:27+08:00` | 读取、切换、输入区、unauthorized 与 failed 证据均来自 local truthful 测试；deployed 浏览器当前只有 `/login` 门禁事实 |

- 当前放行判断：本轮 fresh 代码级验证已通过，`npm --prefix frontend run test` 为 `158 passed`，`/data/projects/linpo/.venv/bin/pytest` 为 `131 passed, 2 skipped`，`npm --prefix frontend run build` 成功，`make quality` 成功，`curl -i http://175.178.213.10:8000/health` 返回 `HTTP/1.1 200 OK` 与 `{"status":"ok"}`。
- 浏览器验收限制：当前从 `ravin` 发起的已部署浏览器检查仍处于未登录上下文，`overview / topology / kanban / team` 的 Playwright `goto` 返回 `ERR_ABORTED`，session canonical URLs 只确认最终落到 `/login`，因此缺少 authenticated 五页浏览器验收证据。
- 诚实结论：当前只能给出“实现/测试通过，远端登录态验收待补”的放行判断，不能把 8.3 记成已完成 authenticated 浏览器验收。

## 9. 证据索引表

| 证据编号 | 页面或模块 | 证据类型 | 路径或定位方式 | `request_id` | 时间戳 | 环境 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  |  |  |

## 10. 追加记录日志

| 追加时间 | 追加人或执行身份 | 变更范围 | 备注 |
| --- | --- | --- | --- |
|  |  | 初始骨架创建 |  |
| 2026-03-24T00:38:23+08:00 | Codex | Task 5.1 `team` 参考锚点与当前实现缺口补录 | 未执行 git 命令，当前仓库 SHA 仍待后续补录 |
| 2026-03-24T05:39:49+08:00 | Codex | Task 6.6 `session` 记录模板 6.5.4 ~ 6.5.8 补录 | 仅补写 execution record 与 notepad；如实区分 local 样本、deployed 未登录门禁样本，以及当前无 authenticated 截图/发送样本的限制 |
| 2026-03-24T05:45:50+08:00 | Codex | Task 7 `共享契约记录区` 7.1 ~ 7.3 补录 | 明确冻结前四页 aggregate-style contract 与 session derived truthful clue contract 的差异，只补写 execution record 与 notepad |
| 2026-03-24T05:53:27+08:00 | Codex | Task 8 `浏览器验收与健康检查记录区` 8.1 ~ 8.4 补录 | 如实区分 local 统一验证、deployed health 通过，以及当前远端未登录浏览器上下文下 only-gate evidence 的限制 |

## 11. Task 2.2 overview 追加记录

- 追加时间：2026-03-23T21:24:58+08:00
- 追加人或执行身份：Codex
- 页面/模块名：`overview`
- 关联任务：Task 2.2
- 实现路径：`frontend/src/components/OverviewPage.tsx`、`frontend/src/api/types.ts`、`app/api/schemas.py`、`app/services/aggregate_service.py`
- 测试路径：`frontend/src/components/OverviewPage.test.tsx`、`tests/integration/test_aggregate_api.py`
- gap closure：`OverviewPage` 已不再以 agents grid 作为主舞台，现改为顶部统计区 + 实例 token stage + 右侧全局事件列表；旧 `summary strip + agents grid` 差距已在当前承载对象上收敛。
- 契约补充：overview 聚合响应新增 `stats / token_groups / global_events`。其中 `global_events` 来自实例根节点真实事件聚合；当前无 usage 数据时，`token_groups[*].samples` 返回空数组、`total_tokens` 返回 `null`，前端据此显示“暂无 token 数据”，不伪造 token 曲线。
- 验证证据：`npm --prefix frontend run test -- OverviewPage`、`/data/projects/linpo/.venv/bin/pytest tests/integration/test_aggregate_api.py -k overview_returns_aggregated_agents_with_request_id_freshness_and_diagnostics`
- 适用环境：local

## 12. Task 3.1 topology 追加记录

- 追加时间：2026-03-23T22:13:07+08:00
- 追加人或执行身份：Codex
- 页面/模块名：`topology`
- 关联任务：Task 3.1
- 参考仓库的可移植标识：`sunbao/openclaw-gateway-routing-graph`
- literal 标识说明：plan 文本当前写的是 `openclaw/geteway-routing-graph`。本次任务上下文已给出该 literal identifier 的公开查询不可解析结论，因此本记录只锁定可审计、可移植的外部锚点 `sunbao/openclaw-gateway-routing-graph`，不把未解析 literal 记成已证事实。
- 可定位参考对象路径：`index.html`、`src/main.ts`、`src/routing-graph-app.ts`、`src/routing-graph.ts`、`src/routing-adapters.ts`、`src/routing-types.ts`
- 当前本地实现路径：`frontend/src/components/TopologyPage.tsx`、`frontend/src/components/InstanceTopology.tsx`
- 相关测试路径：`frontend/src/components/InstanceTopology.test.tsx`
- 当前本地承载对象事实：`TopologyPage` 当前仅包装 `InstanceTopology`；`InstanceTopology` 当前使用 ReactFlow + dagre 构建拓扑画布，并在 `TopologyNodeData` 与 `nodeTypes` 中明确建模 `instance / agent / skill / external_acp` 四类节点。
- 当前仓库提交 SHA：按任务要求本次未执行 git 命令，当前 SHA 待后续由编排者基于真实仓库状态补录。
- 参考对象对应 SHA：`737f7d7feb52441ae5219b8174662eaad1760e2c`
- 当前差距说明：当前本地 topology 仍是 `instance / agent / skill / external_acp` 的节点语义，尚未对齐目标四泳道 `实例 / 智能体 / 会话 / 工具`，因此本次只完成参考锚点锁定与可定位对象冻结，不声称已完成拓扑语义重构。
- 验证依据：`frontend/src/components/TopologyPage.tsx` 证明 `/topology` 当前承载对象是 `TopologyPage -> InstanceTopology`；`frontend/src/components/InstanceTopology.tsx` 证明当前节点语义仍为 `instance / agent / skill / external_acp`；`frontend/src/components/InstanceTopology.test.tsx` 进一步锁定当前测试口径仍覆盖 instance、agent、skill、external ACP 节点与 graph-only 画布约束。
- 适用环境：local

## 13. Task 4.1 kanban 追加记录

- 追加时间：2026-03-23T23:41:21+08:00
- 追加人或执行身份：Codex
- 页面/模块名：`kanban`
- 关联任务：Task 4.1
- plan literal 标识说明：当前 plan literal 是 `openclaw/mission-control`，但本次公开直查未解析到可直接定位的同名参考仓库对象，因此本记录保留 literal 与公开可审计事实之间的差异，不把 literal 误写成已定位仓库
- 参考仓库的可移植标识：`abhi1693/openclaw-mission-control`
- 可定位参考对象路径：`frontend/src/app/boards/[boardId]/page.tsx`、`frontend/src/components/organisms/TaskBoard.tsx`、`frontend/src/components/molecules/TaskCard.tsx`、`frontend/src/api/generated/tasks/tasks.ts`、`backend/app/api/tasks.py`
- 当前本地实现路径：`frontend/src/main.tsx`、`frontend/src/components/CollabPage.tsx`
- 相关测试路径：`frontend/src/components/CollabPage.test.tsx`
- 当前本地承载对象事实：`frontend/src/main.tsx` 证明 `/kanban` 当前直接挂到 `CollabPage`；`CollabPage` 通过 `getAggregateOverview` 读取 overview 聚合数据，把 `AggregateOverviewAgentItem` 归并到状态列，并保留 agent `drilldown_path` 作为进入会话 CTA
- 当前仓库提交 SHA：按任务要求本次未执行 git 命令，当前 SHA 待后续由编排者基于真实仓库状态补录
- 参考对象对应 SHA：`6a66e463c438bc73ebb3d5cd2cf61df9cf63e045`
- 当前差距说明：当前本地 kanban 仍是 overview-agent signal board，不是 mission-control task board。它按 agent 信号聚合列展示工作状态，每张卡承载的是 agent 摘要与会话 drilldown，不是一个独立 task；因此尚未对齐“每卡一个任务、围绕任务 API 与任务后端对象组织板面”的目标语义
- 验证依据：公开检索 `"openclaw/mission-control" GitHub` 未返回可直接审计的同名仓库对象；公开可达的 `abhi1693/openclaw-mission-control` 在 SHA `6a66e463c438bc73ebb3d5cd2cf61df9cf63e045` 下可定位 `page.tsx`、`TaskBoard.tsx`、`TaskCard.tsx`、`tasks.ts` 与 `tasks.py`；本地 `frontend/src/main.tsx`、`frontend/src/components/CollabPage.tsx`、`frontend/src/components/CollabPage.test.tsx` 则共同证明当前 `/kanban` 仍是 agent signal board 口径
- 适用环境：local + public web lookup

## 14. Task 5.1 team 追加记录

- 追加时间：2026-03-24T00:38:23+08:00
- 追加人或执行身份：Codex
- 页面/模块名：`team`
- 关联任务：Task 5.1
- plan literal 标识说明：当前 plan literal 是 `openclaw/center`，但本次 public direct lookup 未把该 literal 解析成可直接审计的公开仓库对象，因此本记录保留 literal 与可审计参考仓库之间的差异，不把 `openclaw/center` 误记成已定位仓库
- 参考仓库的可移植标识：`TianyiDataScience/openclaw-control-center`
- 可定位参考对象路径：`src/ui/server.ts` 中的 `section=team` / `label: "Staff"`、`src/ui/server.ts` 中 `renderStaffOverviewCards` 相关区域、`test/office-roster.test.ts`、`test/ui-render-smoke.test.ts`、`docs/assets/staff-en.png`、`docs/assets/staff-zh.png`
- 当前本地实现路径：`frontend/src/main.tsx`、`frontend/src/components/Layout.tsx`
- 当前本地承载对象事实：`frontend/src/main.tsx` 当前没有 `/team` 路由，`frontend/src/components/Layout.tsx` 的 `PRIMARY_NAV_ITEMS` 也没有 team 入口；`frontend/src/components` 下当前未见 Team/Staff 页面承载对象，因此还不能把任何本地页面记成 `openclaw/center` 的 `Staff` 对位实现
- 当前仓库提交 SHA：按任务要求本次未执行 git 命令，当前 SHA 待后续由编排者基于真实仓库状态补录
- 参考对象对应 SHA：`473f42bb412f3dc70ac6c6f33f59a8b53fa6cf8b`（current main head）、`d002386bc220e1d5ac26283b761ad476ed805e24`（initial/core staff entry）、`bdeb045dba0e81e48b206b95b3ba9982ba423b98`（staff card/avatar related major refactor）
- 当前差距说明：README 当前已把 `/team` 冻结为 IA 第三页 persistent agent cards 主舞台，并要求从 agent card 进入 session 工作区；但当前仓库仍缺 `/team` 路由、team 导航项、Team/Staff 页面组件、team 专属测试，以及 team 的浏览器契约与 session 承接证据。本次只完成参考锚点与缺口锁定，不声称 team 已开始实现
- 验证依据：`README.md` 冻结了 `team` 的 IA 角色与目标语义；`frontend/src/main.tsx` 证明当前受保护路由仍只有 `/overview`、`/topology`、`/kanban`、`/session`；`frontend/src/components/Layout.tsx` 证明主导航当前只有 `总览 / 拓扑 / 看板`；当前 public web lookup 则可审计地指向 `TianyiDataScience/openclaw-control-center` 的 `Staff` section 与相关对象，而 `openclaw/center` literal 仍未直接解析
- 适用环境：local + public web lookup
