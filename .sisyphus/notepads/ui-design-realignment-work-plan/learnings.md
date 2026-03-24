# Learnings

- Task 1.5 已建立唯一留痕载体骨架，按全局规则、冲突裁决、路由兼容、五页逐页模板、共享契约、验收门禁与证据索引分区，便于后续任务只做 append-only 补证。

## [2026-03-23T20:50:06+08:00] Task 1.5

`.sisyphus/plans/ui-design-realignment-execution-record.md` 已建立为当前阶段唯一留痕载体骨架，覆盖五页模板、共享契约、路由兼容、浏览器验收与验收证据索引结构。后续 Task 2-8 可基于该骨架按 append-only 方式持续补录真实锚点与证据。

## [2026-03-23T20:53:34+08:00] Task 1.2

审计 `.sisyphus/plans/ui-design-realignment-work-plan.md` 后，确认旧四页术语、旧入口语义与旧门禁表述当前仅作为失效条款、禁止项、阻断项或替换说明存在，不再作为后续执行依赖。本次无需修改 plan，仅补记判断结果。

## [2026-03-23T20:56:39+08:00] Task 1.3

审计 `.sisyphus/plans/ui-design-realignment-work-plan.md` 后，确认 `settings / profile` 已在第 1 节、第 3.2 节、第 8.4 节、第 12.3-12.5 节与第 13 节形成闭环约束：它们当前仍为 out-of-scope / 暂缓，不属于有效 IA 页面集合、当前阶段完成定义或五页主链路浏览器验收，也不得以“补充页面”方式重新进入导航、状态矩阵或完成标准。本次无需改动 plan，仅按 append-only 方式补记审计结论。

## [2026-03-23T21:00:42+08:00] Task 1.4

审计 `.sisyphus/plans/ui-design-realignment-work-plan.md` 后，确认旧 `/session/:instanceId/:agentId` 路由、旧四页状态矩阵、旧四页验证清单、旧放行/阻断规则与旧完成标准，已分别被第 6.2 节、第 10 节、第 12 节与第 13 节的新五页口径接管。当前 plan 不存在真实 wording gap，本次无需改动 plan，仅按 append-only 方式补记审计结论。

## [2026-03-23T21:10:39+08:00] Task 2.1

已在 `.sisyphus/plans/ui-design-realignment-execution-record.md` 的 overview 小节锁定 `LINPO-OVERVIEW-HOME-V1`，明确外部参考来自 `hoodini/llm-visuals`，并将 `OverviewPage` 记录为当前最接近的现有承载对象。同步补记当前差距，说明 overview 仍停留在 summary strip + agents grid，尚未形成“顶部统计 + token 趋势主舞台 + 右侧常驻全局事件流”三块同时成立的对齐对象。

## [2026-03-23T21:24:58+08:00] Task 2.2

为避免伪造 token 语义，overview 聚合契约本次只最小新增 `stats / token_groups / global_events` 三块：`global_events` 直接来自实例数据源的真实根节点事件聚合；`token_groups` 在当前 OpenClaw 聚合链路尚无 usage 数据时显式返回空 samples 与 `total_tokens = null`，由前端主舞台真实展示“暂无 token 数据”而不是伪曲线。前端 `OverviewPage` 已从 `summary strip + agents grid` 重构为顶部统计、实例 token 主舞台与右侧事件栏三段式布局。

## [2026-03-23T21:34:33+08:00] Task 2.3

已将 `frontend/e2e/v0.6-overview-topology-session.spec.ts` 的 overview 验收口径从旧 watchlist/dashboard 语义切换到三段式结构：正向断言统一指向 `overview-stats-panel`、`overview-token-stage`、`overview-global-events`，并将 `overview-agents-grid` 收敛为禁止结构。针对降级场景，overview mock payload 已补齐 `stats / token_groups / global_events` 最小结构以对齐 `AggregateOverviewResponse`，同时移除对 overview 首页 agent drill-down 入口的遗留依赖，保持本任务仅清理 overview 口径、不触碰 session 路由迁移。

## [2026-03-23T21:45:02+08:00] Task 2.4

`OverviewPage` 现已把状态矩阵拆成页面壳层承接：loading 保留标题、统计区、token 主舞台与事件 rail 的加载占位；partial failure 在 `partial_failure=true` 或 diagnostics 呈现部分失败时继续保留成功内容并显示“部分数据不可用”；unauthorized 与 generic failed 分离展示；stale 额外给出显式滞后提示。对应前端测试已扩展到 loading / empty / partial_failure / failed / unauthorized / stale 全覆盖，用于锁定该状态表现。

## [2026-03-23T21:55:53+08:00] Task 2.5

Overview 的 refresh / retry 统一继续调用 `getAggregateOverview`，不引入旁路读取；成功态额外展示 `request_id / freshness / checked_at / diagnostics` 的紧凑对账线索，失败态保留 envelope 证据并提供显式重试入口。对应前端测试用两次调用断言锁定 refresh 与 retry 都命中同一真实读链路。

## [2026-03-23T22:13:07+08:00] Task 3.1

锁定 topology 外部锚点时，要把 plan 中的参考 literal 和可审计的公开仓库事实分开记录。当前可移植参考应记为 `sunbao/openclaw-gateway-routing-graph`，同时明确说明 plan 文字仍写 `openclaw/geteway-routing-graph` 且该 literal 公开不可解析；本地承载对象则继续以 `TopologyPage -> InstanceTopology` 和现有 `instance / agent / skill / external_acp` 节点语义为准，避免把未完成的四泳道对齐写成既成事实。

## [2026-03-23T22:20:00+08:00] Task 3.2

Topology 的 3.2 收口应把“graph-only 极简页”测试口径改成“routing graph 主舞台”：允许紧凑标题、读链路线索和画布控制组成前景壳层，但必须继续把 ReactFlow 单画布保留为绝对主舞台，并显式禁止 sidebar / detail / config 一类工作台面板提前回流。

## [2026-03-23T22:44:07+08:00] Task 3.3

Topology 四泳道的最小真实切片可直接复用现有聚合读链路：`session` 节点从 OpenClaw snapshot 的 `health.agents[].sessions.recent[]` 提取稳定 `session_key`，`tool` 节点只在 snapshot 暴露 `bindings.tools` 时落成真实工具节点，否则保持空数组；前端则用固定四列泳道 + 圆形节点承接 `instances / agents / sessions / tools / edges`，无需回退到旧 `skill / ACP` 语义或提前做 3.4 进入规则裁决。

## [2026-03-23T23:08:06+08:00] Task 3.4

Topology 节点显式进入规则落到 ReactFlow custom node 时，测试环境需要给节点补固定 `initialWidth / initialHeight`，否则节点会因未完成尺寸初始化保持 hidden，出现“文本可查到但 `getByRole('link')` 查不到入口链接”的假阴性。对多节点共享状态文案的断言也应收敛到具体节点容器内做 `within(...)` 查询，避免把真实重复状态误判成实现问题。

## [2026-03-23T23:20:19+08:00] Task 3.5

Topology 状态矩阵与读链路收口时，应把 `loading / empty / failed / unauthorized` 都放进同一个 routing-stage shell 内承接，避免通过整页早退把主舞台替换掉；同时，`partial_failure` 与 `stale` 只追加 notice，不替换成功内容。组合运行多个 ReactFlow 相关测试文件时，状态提示往往先于节点挂载完成，断言节点存在需要额外 `waitFor(...)`，否则会把异步布局时序误判成状态回归。

## [2026-03-23T23:41:21+08:00] Task 4.1

锁定 kanban 外部锚点时，要把 plan literal 和公开可审计仓库对象拆开记。当前应保留 `openclaw/mission-control` 这个 plan literal，同时明确说明它公开直查未解析；真正可移植、可定位的参考对象应冻结为 `abhi1693/openclaw-mission-control` 及其 `page.tsx / TaskBoard.tsx / TaskCard.tsx / tasks.ts / tasks.py`。本地现状则要如实写成 `main.tsx -> CollabPage` 的 overview-agent signal board，不能把 agent 分桶卡片误记成 mission-control 的单任务卡。

## [2026-03-23T23:52:20+08:00] Task 4.2

Kanban 的 4.2 语义切换可继续完全复用 `getAggregateOverview`：前端先把每个 `AggregateOverviewAgentItem` 与同实例 `diagnostic` 合成为派生任务卡，再把标题、摘要、CTA、列标题与空态统一改成“动作 + 任务状态”语言，就能把页面读感从 agent signal board 收口到 task board，而无需提前伪造独立 tasks API。

## [2026-03-24T00:00:22+08:00] Task 4.3

Kanban 要去掉“只读信号板”读感，不必引入假拖拽或伪任务 API；继续坚持 `getAggregateOverview` 单一读链路，同时把能力感落在三层可见结构上即可：板头给出任务总数 / 当前焦点 / 刷新入口，列头补足阶段说明，卡片则拆成任务意图、任务摘要、责任/实例元数据和操作条。这样既能保持当前能力真实，又能把页面语义稳定收口到 task board。

## [2026-03-24T00:09:54+08:00] Task 4.4

Kanban 任务卡要把“任务上下文”和“session 工作区”拆成两类入口：前者可在卡内用展开式上下文锚点承接，明确 why-this-task / 当前判断；后者仍只信任 `overview` 返回的 `drilldown_path`，且仅当其是有效 `/session/` 路径时才渲染跳转入口，否则显式禁用并提示需先去 topology / team / session 确认可用会话入口，避免把缺失上下文误装成可点击直达。

## [2026-03-24T00:20:37+08:00] Task 4.5

Kanban 的状态矩阵收口可以直接复用 overview 的可见契约模式：成功/部分成功态单独暴露 `request_id / freshness / checked_at / diagnostics` 对账线索，`partial_failure` 与 `stale` 只追加 notice 并保留真实任务板内容；`loading` 与 `empty` 则继续保留 board shell，不要因为状态切换把列结构整体替换掉。这样既能保持 `getAggregateOverview` 单一读链路，也能避免 unauthorized 被 generic failed 或空成功伪装掉。

## [2026-03-24T00:38:23+08:00] Task 5.1

锁定 team 外部锚点时，要把 plan literal 和公开可审计仓库对象拆开记。当前应保留 `openclaw/center` 这个 plan literal，同时明确说明它公开直查未解析；真正可移植、可定位的参考对象应冻结为 `TianyiDataScience/openclaw-control-center` 及其 `src/ui/server.ts` 的 `Staff` section、`renderStaffOverviewCards`、相关测试与中英文截图素材。本地现状则要如实写成 `frontend/src/main.tsx` 与 `frontend/src/components/Layout.tsx` 仍缺 `/team` 路由和导航入口，且 `frontend/src/components` 下尚无 Team/Staff 页面承载对象，不能把 docs 目标语义误记成已实现事实。

## [2026-03-24T00:52:30+08:00] Task 5.2

把 team 接入 IA 的最小前端切片时，最好把验证拆成三层：`appRoutes.test.tsx` 锁定 `/team` 是一级路由，独立导航测试同时覆盖 desktop / mobile，`TeamPage.test.tsx` 只锁定“persistent agent cards 主舞台 + 团队入口”文案与禁止词。这样既能用 TDD 先落 route/nav，再用第二个 red-green 周期收口页面语义，也能避免为未完成的卡片字段伪造数据。

## [2026-03-24T01:07:58+08:00] Task 5.3

Team 的 persistent agent cards 可先坚持真实前端可达读链路：用 `getAggregateOverview` 提供 agent/instance/status 主体，再按 agent + instance 继续读取 `listSessions` 选最近会话，并用 `previewSessions` 提取首条可见消息文本做开头截断；头像则由现有名字派生为确定性字母 avatar。这样无需伪造 team roster API，也能把 staff-like 卡片最小字段一次补齐，同时把 5.4 的 session 进入规则继续留在卡片脚注层而不提前过度承诺。

## [2026-03-24T01:18:40+08:00] Task 5.4

Team persistent agent cards 的 5.4 收口可以继续诚实复用当前 `SessionPage` 入口 helper，而不提前伪装成 Task 6 的 canonical 路由已完成：当 `listSessions` 能读到最近会话时，用当前 `buildSessionEntryPath` + `preferredSessionKey` 让 AgentWorkspace 默认落到该会话；没有具体会话但 `instance_id + agent_id` 仍成立时，明确文案为“进入默认工作区”；若这组基础上下文本身缺失，则直接禁用入口并阻止额外的 sessions / preview 读取，避免把无效卡片伪装成可安全进入的 session 入口。

## [2026-03-24T01:43:40+08:00] Task 5.5

Team 的状态矩阵不能只看 `getAggregateOverview` 顶层成功/失败：未授权或失败态若继续渲染空卡片舞台，会把错误伪装成空成功；而 `listSessions` / `previewSessions` 的下游失败若直接吞掉，也会把真实读链歪成“暂无会话”或默认工作区。较稳妥的收口方式是继续把 `request_id / freshness / checked_at / diagnostics` 锚在 overview 聚合请求上，但额外把派生读失败并入 diagnostics 摘要与 partial-failure notice，同时保留既有卡片布局与入口规则，只把失败文案改成明确的“读取失败，待重试 / 临时落点：默认工作区”。

## [2026-03-24T04:31:54+08:00] Task 6.1

锁定 `session` 锚点时，要先把 truth-doc literal、当前本地承载对象、当前 helper 语义拆开记。若仓库内拿不到可审计的仓库外参考对象与 SHA，就应明确写“待后续补充真实可审计参考对象”，同时把本地事实老实冻结为 `SessionPage + AgentWorkspace`，并指出当前仍复用 `buildSessionEntryPath`、`preferredSessionKey` 与旧 `/session/:instanceId/:agentId` 入口语义，不能提前把 Task 6 的 canonical 路由写成既成事实。

## [2026-03-24T04:53:00+08:00] Task 6.2

`AgentWorkspace` 已从单列极简 preview shell 重构为五块工作区结构：顶部 agent header、左侧渠道区（上）、左侧会话区（下）、主会话区、底部输入发送区。测试通过断言 DOM 顺序锁定"渠道在上，会话在下"的左侧栏结构要求。渠道区当前阶段作为 truthful placeholder 存在，复用现有 `listSessions` / `previewSessions` 与 realtime preview 能力，不新增后端契约。测试层面，`vi.restoreAllMocks()` 会破坏模块级 mock 的持久性，导致同一 describe block 内后序测试无法正确加载 agent 数据；改用 `vi.clearAllMocks()` 即可保持 mock 实现的稳定性。

## [2026-03-24T05:10:00+08:00] Task 6.3

当当前聚合或跨页入口只知道 `instanceId + agentId`、但拿不到真实 `channelKey/sessionKey` 时，6.3 的 truthful canonical fallback 应落到 `/session/:agentId/__none__/__new__?instanceId=...`；只有显式拿到 `sessionKey` 且能从它稳定导出 channel 前缀时，才升级成 `/session/:agentId/:channelKey/:sessionKey`，避免继续把旧 `/session/:instanceId/:agentId` 伪装成 canonical。

## [2026-03-24T05:22:00+08:00] Task 6.4

Session 入口的实例裁决最好在 `SessionPage` 显式收口成 `URL query/legacy route > stored instance`，不要依赖下游 API helper 隐式回退；会话裁决则继续在 `AgentWorkspace` 明写成 `preferredSessionKey > 当前仍存在于 listSessions 的会话 > sessions[0]`，这样 `__new__` 路由也能 truthfully 落到服务端当前仍有效的会话。

## [2026-03-24T05:37:00+08:00] Task 6.5

Session 还没有 aggregate-style contract 时，状态矩阵要直接锚在 `getAgentDetail -> listSessions -> previewSessions` 的逐步结果上：`request_id` 只复用真实 error envelope，`freshness` 只根据 `listSessions.ts / previewSessions.ts` 做显式“推断”文案，而下游读取失败必须保留为 partial failure/unauthorized 线索，不能再吞成“暂无会话/暂无消息”。

## [2026-03-24T05:39:49+08:00] Task 6.6

补录 session execution record 时，要把三类证据拆开写清楚：local 测试样本负责结构、route fallback、state matrix 与真实 request clue 文案，deployed 未登录浏览器样本只负责证明 canonical URLs 会被门禁重定向到 `/login`，而 authenticated 截图、发送成功证据与 deployed request_id 在当前没有就必须明确写缺失，不能拿推断值补空。

## [2026-03-24T05:45:50+08:00] Task 7

共享契约留痕要把“同名字段”与“同构后端契约”分开写：overview / topology / kanban / team 仍是 aggregate-style 字段，session 只是在相同 clue 槽位里投影 `getAgentDetail -> listSessions -> previewSessions (+ realtime after selection)` 的真实结果，尤其不能把 session 的 `partial_failure` 误记成后端 boolean 字段。

## [2026-03-24T05:53:27+08:00] Task 8

统一放行记录要把 local 质量门、deployed 健康检查和未登录浏览器门禁现象拆开写。代码级验证全绿，不等于已拿到 authenticated 五页浏览器验收证据。
