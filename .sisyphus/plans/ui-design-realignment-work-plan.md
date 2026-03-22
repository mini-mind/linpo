# Linpo v0.6 UI Design Realignment

## TL;DR
> **Summary**: Re-align the four observer pages so each page has a sharply different interface role: `overview` becomes an agents-first watchlist, `topology` becomes a pure auto-laid-out graph canvas, `kanban` becomes a mission-control-style read-only board, and `session` becomes a minimal message view.
> **Deliverables**:
> - Freeze the visual/interaction truth in docs
> - Rebuild `overview`, `topology`, `kanban`, `session` to the confirmed design
> - Preserve canonical drill-down routes and existing observer-only product boundaries
> - Re-run frontend/backend/Playwright verification with new selectors and evidence
> **Effort**: Large
> **Parallel**: YES - 2 waves
> **Critical Path**: 1 → 2 → 3/4/5/6 → 7

## Context
### Original Request
- 用户在验收时指出“页面跟设计完全不一致”，并明确要求纠正信息架构、视觉风格、交互方式、内容表达。

### Interview Summary
- `overview`: 必须以 agents 卡片列表为主舞台；次要信息与摘要只能缩到顶部或侧边的极小区域，不能挤占列表。
- `topology`: 必须是更图形化的 graph 关系图，并带自动布局；页面内容只保留关系图，不混入配置详情、统计摘要或运行控制。
- `kanban`: 必须参照 `../openclaw-mission-control` 的看板界面，且对齐强度是“近似复刻”结构、列节奏、卡片层级，只替换为 Linpo 语义。
- `session`: 默认可见内容只保留极简标题、消息流、底部输入区；不要多标签页、状态区、侧栏；PC 端必须控制消息流宽度并保留左右留白。

### Confirmed Design Decisions
- `overview`: 主舞台固定为 agents roster/watchlist；summary strip 仅能放 aggregate freshness、实例/异常数、轻量筛选这类极小辅助信息。
- `topology`: 页面内容原则上只有 graph 关系图；允许的外围 UI 仅限极简标题区与 fit/reset 级别画布控件。
- `kanban`: 近似复刻 Mission Control `TaskBoard` 的列节奏、卡片层级和 board 语言；Linpo 语义为只读观察，不复制拖拽写回或审批语义。
- `session`: 页面默认只保留极简标题、单列消息流、底部输入区；桌面端中心阅读带最大宽度固定 `880px`。

### Metis Review (gaps addressed)
- Guardrail incorporated: 这是 UI hierarchy / visual language correction，不是 IA 重写，也不是功能扩展。
- Guardrail incorporated: `kanban` 只借鉴任务板语言，不复制 Mission Control 的拖拽写操作；Linpo 仍是 observer-only。
- Guardrail incorporated: 每页都必须覆盖 `loading / empty / error / partial / retry` 中适用的状态矩阵，避免只“看起来像”。
- Defaults applied: `topology` 允许极少量浮层，仅限 loading overlay、error overlay、fit/reset 控件；不允许详情侧栏、配置侧栏、统计卡。
- Defaults applied: `session` 桌面端阅读带最大宽度固定为 `880px`，输入区与消息流共用同一宽度基线。

## Work Objectives
### Core Objective
- 在不改变 v0.6 observer-only 产品边界的前提下，把四个主页面改造成与用户确认设计一致的界面体系，并让文档、组件测试、Playwright 验收和现有 canonical 路由保持一致。

### Deliverables
- README / PRD / architecture 中补足 UI 设计真源与 guardrails
- 新的 `overview` agents-first 列表页
- 新的 `topology` graph-only 关系图页（自动布局）
- 新的 `kanban` mission-control-style read-only 看板页
- 新的 `session` 极简消息页
- 更新后的页面测试、Playwright 场景与 evidence

### Definition of Done (verifiable conditions with commands)
- `npm --prefix frontend run test -- src/components/OverviewPage.test.tsx src/components/InstanceTopology.test.tsx src/components/CollabPage.test.tsx src/components/SessionPage.test.tsx`
- `npm --prefix frontend run build`
- `PLAYWRIGHT_BASE_URL=http://175.178.213.10:5173 npm --prefix frontend run e2e -- --grep "ui-realignment|v0.6"`
- `make quality`

### Must Have
- `overview` 第一视觉区是 agents 卡片列表，摘要区只占极小区域。
- `topology` 页面主内容只有 graph 关系图，并带自动布局。
- `kanban` 保持多列板式结构、卡片节奏与列主次关系，接近 Mission Control 的 `TaskBoard` 语言。
- `session` 页面只保留极简标题、消息流、底部输入区，且桌面端内容宽度受限。
- 所有页面继续使用 canonical session 路径 `/session/:instanceId/:agentId`。
- 所有页面继续保留 observer-only 边界，不新增控制面写操作。

### Must NOT Have (guardrails, AI slop patterns, scope boundaries)
- 不新增 tabs / sidebar / status panel 到 `session`。
- 不在 `topology` 中回引配置表单、详情面板、实例摘要卡或运行控制按钮。
- 不把 `overview` 做成 dashboard 式统计首页。
- 不把 `kanban` 做成单列列表页，也不引入拖拽保存、列内排序写回、审批流写操作。
- 不新增后端 API 字段、后端写能力或 observer 范围外的新功能。
- 不复用一套模板化页面壳导致四页看起来只是文案不同。

## Verification Strategy
> ZERO HUMAN INTERVENTION — all verification is agent-executed.
- Test decision: tests-after + existing `vitest` page tests + existing Playwright + final `make quality`
- QA policy: Every task has agent-executed scenarios
- Evidence: `.sisyphus/evidence/task-{N}-{slug}.{ext}`

## Execution Strategy
### Parallel Execution Waves
> Target: 5-8 tasks per wave. <3 per wave (except final) = under-splitting.
> Extract shared dependencies as Wave-1 tasks for max parallelism.

Wave 1: 1 docs/truth-source freeze, 2 shared page-shell/test-id contract, 3 overview redesign, 6 session simplification
Wave 2: 4 topology graph canvas, 5 kanban board rebuild, 7 verification + evidence refresh

### Dependency Matrix (full, all tasks)
- 1 blocks 2, 3, 4, 5, 6, 7
- 2 blocks 3, 4, 5, 6, 7
- 3 blocks 7
- 4 blocks 7
- 5 blocks 7
- 6 blocks 7

### Agent Dispatch Summary (wave → task count → categories)
- Wave 1 → 4 tasks → `writing`, `visual-engineering`
- Wave 2 → 3 tasks → `visual-engineering`, `unspecified-high`

## TODOs
> Implementation + Test = ONE task. Never separate.
> EVERY task MUST have: Agent Profile + Parallelization + QA Scenarios.

- [x] 1. 冻结 UI 设计真源与页面 guardrails

  **What to do**: 更新 `README.md`、`docs/prd/2026-03-15-linpo-v0.1-observer-prd.md`、`docs/architecture/2026-03-15-observer-architecture.md`，把已确认的四页设计定位正式落盘：`overview` 是 agents-first watchlist、`topology` 是 graph-only canvas、`kanban` 近似 Mission Control 看板、`session` 是极简消息页；同时补充 observer-only guardrails，明确 `kanban` 不引入拖拽写回、`topology` 不再承担配置块、`session` 不允许 tabs/sidebar/status。
  **Must NOT do**: 不改产品 IA，不新增功能范围，不把设计说明写成抽象口号；必须写出页面主舞台、次要区域、禁止项。

  **Recommended Agent Profile**:
  - Category: `writing` — Reason: 这是设计真源冻结任务，核心是把口头决策落成文档约束。
  - Skills: [`superpowers/writing-plans`] — 用于保持文档表达精确、一致。
  - Omitted: [`frontend-ui-ux`] — 此任务不直接改前端实现。

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: 2, 3, 4, 5, 6, 7 | Blocked By: none

  **References** (executor has NO interview context — be exhaustive):
  - Pattern: `README.md` — 当前仓库入口与页面职责摘要位置。
  - Pattern: `docs/prd/2026-03-15-linpo-v0.1-observer-prd.md` — 当前 v0.6 页面边界与 observer-only 范围真源。
  - Pattern: `docs/architecture/2026-03-15-observer-architecture.md` — 当前 IA、页面职责与验收边界真源。
  - Pattern: `.sisyphus/plans/ui-design-realignment-work-plan.md:24` — 本计划已内嵌逐屏确认的设计决策，可直接作为执行真源。

  **Acceptance Criteria** (agent-executable only):
  - [ ] `rg --line-number "agents-first|watchlist|graph|Mission Control|极简标题|底部输入区|observer-only" README.md docs/prd/2026-03-15-linpo-v0.1-observer-prd.md docs/architecture/2026-03-15-observer-architecture.md` 命中新的 UI 设计真源。
  - [ ] `rg --line-number "tabs|sidebar|status panel|拖拽写回|配置面板" README.md docs/prd/2026-03-15-linpo-v0.1-observer-prd.md docs/architecture/2026-03-15-observer-architecture.md` 只出现禁止项/排除项描述。

  **QA Scenarios** (MANDATORY — task incomplete without these):
  ```
  Scenario: Design truth-source freeze
    Tool: Bash
    Steps: Run `rg --line-number "overview|topology|kanban|session" README.md docs/prd docs/architecture`
    Expected: Matches explicitly describe the new four-page visual/interaction roles rather than generic page summaries
    Evidence: .sisyphus/evidence/task-1-ui-truth-source.txt

  Scenario: Scope guardrail freeze
    Tool: Bash
    Steps: Run `rg --line-number "拖拽|sidebar|tabs|配置面板|控制" README.md docs/prd docs/architecture`
    Expected: Matches show these items are excluded from the wrong pages or constrained to observer-only behavior
    Evidence: .sisyphus/evidence/task-1-ui-truth-source-error.txt
  ```

  **Commit**: YES | Message: `docs: 冻结四页 UI 设计真源与边界` | Files: [`README.md`, `docs/prd/2026-03-15-linpo-v0.1-observer-prd.md`, `docs/architecture/2026-03-15-observer-architecture.md`]

- [x] 2. 建立共享页面骨架、test id 合约与视觉 guardrails

  **What to do**: 先提取一个最小共享 UI 约束层，统一四页的背景、标题区、主舞台边距、桌面最大宽度与稳定 test id。新增或整理适合复用的轻量 page-shell / token helper（可放在 `frontend/src/components/` 或 `frontend/src/lib/` 下），并为每页定义稳定 test id：`overview-summary-strip`、`overview-agents-grid`、`topology-graph-canvas`、`kanban-board`、`session-stream-shell`、`session-input-shell`。同时清理 `Layout.tsx` 中过强的模板化页面观感，保留导航职责但避免统一页面壳挤压四页差异。
  **Must NOT do**: 不创建新的设计系统工程，不引入复杂主题切换；不把四页重新拉平为统一 dashboard 模板。

  **Recommended Agent Profile**:
  - Category: `visual-engineering` — Reason: 这是后续四页改造的共享基础与结构 contract。
  - Skills: [`frontend-ui-ux`] — 用于压住模板化复用，保留页面差异。
  - Omitted: [`playwright`] — 本任务先以组件结构与 build 为主。

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: 3, 4, 5, 6, 7 | Blocked By: 1

  **References** (executor has NO interview context — be exhaustive):
  - Pattern: `frontend/src/components/Layout.tsx:7` — 当前主导航结构与页面背景/字体/主区域壳层。
  - Pattern: `frontend/src/main.tsx:30` — 当前四页路由挂载位置。
  - Pattern: `frontend/src/components/OverviewPage.tsx:61` — 当前页面根容器与 header/stats/summary 的旧结构。
  - Pattern: `frontend/src/components/SessionPage.tsx:138` — 当前桌面双栏布局，是本次需要削减的典型反例。

  **Acceptance Criteria** (agent-executable only):
  - [ ] `npm --prefix frontend run test -- src/components/Layout.test.tsx src/components/OverviewPage.test.tsx src/components/SessionPage.test.tsx` 通过。
  - [ ] `rg --line-number "overview-summary-strip|overview-agents-grid|topology-graph-canvas|kanban-board|session-stream-shell|session-input-shell" frontend/src/components frontend/src/lib` 命中新引入的稳定选择器。

  **QA Scenarios** (MANDATORY — task incomplete without these):
  ```
  Scenario: Shared page-shell contract
    Tool: Bash
    Steps: Run `rg --line-number "overview-summary-strip|topology-graph-canvas|kanban-board|session-stream-shell" frontend/src`
    Expected: Each page exposes a stable, unique main-stage test id and no two pages share the same main-stage selector
    Evidence: .sisyphus/evidence/task-2-page-shell.txt

  Scenario: Layout guardrail
    Tool: Bash
    Steps: Run `npm --prefix frontend run build`
    Expected: Shared shell changes preserve route mounting and build output while allowing pages to diverge visually
    Evidence: .sisyphus/evidence/task-2-page-shell-error.txt
  ```

  **Commit**: YES | Message: `refactor: 提取四页 UI 骨架与选择器约束` | Files: [`frontend/src/components/Layout.tsx`, `frontend/src/main.tsx`, `frontend/src/components/*`, `frontend/src/lib/*`]

- [x] 3. 重建 overview 为 agents-first watchlist 页面

  **What to do**: 重写 `frontend/src/components/OverviewPage.tsx` 及测试，使页面首屏 80% 以上注意力集中在 agents 卡片列表。顶部只保留极薄的 summary strip，包含 2-4 个紧凑信息块（推荐：aggregate freshness、实例数、异常实例数、一个轻量筛选入口）；删除当前大体量 stats grid 与诊断大卡区，把 diagnostics 缩到 summary strip 或卡片级信号。每个 agent 卡片固定包含：agent 名称、实例名、当前状态、最近活动、一个最关键的诊断/提醒、进入会话入口。空态应把用户送往 `/topology`，而不是展示大型 dashboard 提示。
  **Must NOT do**: 不保留当前 stats grid / diagnostics grid 主舞台；不把 topology 信息、事件历史、实例配置入口塞回 overview；不新增控制按钮。

  **Recommended Agent Profile**:
  - Category: `visual-engineering` — Reason: 这是主页面层级重构，视觉和信息优先级最关键。
  - Skills: [`frontend-ui-ux`] — 用于压强 agents 列表主舞台并缩小次要摘要。
  - Omitted: [`playwright`] — 本任务先用组件测试锁结构。

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: 7 | Blocked By: 1, 2

  **References** (executor has NO interview context — be exhaustive):
  - Pattern: `frontend/src/components/OverviewPage.tsx:61` — 当前 overview 由 header + stats + summary + diagnostics + list 组成，需要反转主次。
  - Test: `frontend/src/components/OverviewPage.test.tsx:160` — 当前测试已验证 canonical drill-down，可保留行为断言、重写结构断言。
  - Pattern: `frontend/src/components/Layout.tsx:7` — overview 位于主导航第一个入口。
  - Truth source: `.sisyphus/plans/ui-design-realignment-work-plan.md:24` — 已确认 overview 是 agents roster/watchlist，summary 只能占极小区域。

  **Acceptance Criteria** (agent-executable only):
  - [ ] `npm --prefix frontend run test -- src/components/OverviewPage.test.tsx` 通过。
  - [ ] `npm --prefix frontend run build` 通过。

  **QA Scenarios** (MANDATORY — task incomplete without these):
  ```
  Scenario: Overview cards-first hierarchy
    Tool: Playwright
    Steps: Open `/overview`; assert `[data-testid="overview-summary-strip"]` is visible; assert `[data-testid="overview-agents-grid"]` is the largest visible content region; open at least one `进入会话` link
    Expected: Summary strip remains compact while the agents list dominates the page and drill-down still targets `/session/:instanceId/:agentId`
    Evidence: .sisyphus/evidence/task-3-overview-cards-first.png

  Scenario: Overview degraded state remains secondary
    Tool: Vitest
    Steps: Run `npm --prefix frontend run test -- src/components/OverviewPage.test.tsx --reporter=verbose`
    Expected: Diagnostics/freshness appear as compact signals and do not reintroduce a full-width diagnostics section
    Evidence: .sisyphus/evidence/task-3-overview-cards-first-error.txt
  ```

  **Commit**: YES | Message: `feat: 重建 overview 为 agents-first 列表页` | Files: [`frontend/src/components/OverviewPage.tsx`, `frontend/src/components/OverviewPage.test.tsx`]

- [x] 4. 重建 topology 为 graph-only 自动布局画布

  **What to do**: 为 `frontend` 引入明确的 graph/auto-layout 依赖：`@xyflow/react` 作为图形画布，`@dagrejs/dagre` 作为自动布局算法。重写 `frontend/src/components/InstanceTopology.tsx` 和必要测试，把页面收敛为单一 graph 画布；节点类型至少包括 instance、agent、skill、external_acp，且必须用不同视觉权重区分。页面只允许极简标题区与画布控制（推荐：fit、reset），不再展示实例详情面板、配置按钮、诊断大卡、未暴露 section 文案列表。`skills` / `external_acps` 为空时显示为空节点集或空图层，不用单独渲染大块 fallback 区。保持 agent 节点可直接 drill-down 到 canonical session。
  **Must NOT do**: 不复用现有 `WorkbenchPanel` 多面板模式；不弹出 `InstanceFormModal`；不在 graph 外再放列表、统计、配置区。

  **Recommended Agent Profile**:
  - Category: `visual-engineering` — Reason: 这是图形化画布重构，涉及依赖引入、画布布局和可视层级。
  - Skills: [`frontend-ui-ux`] — 用于控制节点层级与画布可读性。
  - Omitted: [`playwright`] — 组件与 build 先锁定结构，Playwright 在任务 7 统一覆盖。

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: 7 | Blocked By: 1, 2

  **References** (executor has NO interview context — be exhaustive):
  - Pattern: `frontend/package.json:12` — 当前没有 graph 依赖，必须显式新增。
  - Pattern: `frontend/src/components/InstanceTopology.tsx:21` — 当前 `WorkbenchPanel` 多视图结构是需要删除的旧设计。
  - Test: `frontend/src/components/InstanceTopology.test.tsx:139` — 当前测试围绕按钮/配置/未暴露 section，需要重写为 graph canvas 断言。
  - Wrapper: `frontend/src/components/TopologyPage.tsx:3` — topology 页面外层很薄，可保留。

  **Acceptance Criteria** (agent-executable only):
  - [ ] `npm --prefix frontend run test -- src/components/InstanceTopology.test.tsx` 通过。
  - [ ] `npm --prefix frontend run build` 通过。

  **QA Scenarios** (MANDATORY — task incomplete without these):
  ```
  Scenario: Pure graph canvas
    Tool: Playwright
    Steps: Open `/topology`; assert `[data-testid="topology-graph-canvas"]` is visible; assert no config/detail/sidebar selectors exist; click one agent node drill-down link
    Expected: The page presents a graph canvas as the only main content and still reaches `/session/:instanceId/:agentId`
    Evidence: .sisyphus/evidence/task-4-topology-graph.png

  Scenario: Auto-layout stability
    Tool: Vitest
    Steps: Run `npm --prefix frontend run test -- src/components/InstanceTopology.test.tsx --reporter=verbose`
    Expected: Tests verify graph renders with empty skill/acp layers without falling back to old panels, and layout code handles at least one instance+agent graph and an empty graph
    Evidence: .sisyphus/evidence/task-4-topology-graph-error.txt
  ```

  **Commit**: YES | Message: `feat: 重建 topology 图形关系画布` | Files: [`frontend/package.json`, `frontend/src/components/InstanceTopology.tsx`, `frontend/src/components/InstanceTopology.test.tsx`, `frontend/src/components/TopologyPage.tsx`]

- [x] 5. 重建 kanban 为 Mission Control 风格的只读看板

  **What to do**: 重写 `frontend/src/components/CollabPage.tsx` 与测试，使 `kanban` 接近 `openclaw-mission-control` 的 `TaskBoard` 板式语言：多列布局、列头数量提示、紧凑卡片节奏、横向工作流感。Linpo 语义固定为只读 observer board，列定义统一为：`需关注`（error/failed diagnostics/watchlist）、`进行中`（running 且 active）、`待巡视`（idle / inactive）、`已完成`（finished）。每张卡片主信息固定为标题、实例、状态、最近活动，次要信息为轻量 diagnostics/tag。禁止拖拽持久化、禁止列内写回、禁止新增任务操作；只保留 drill-down 进入 session。
  **Must NOT do**: 不复制 Mission Control 的审批、拖拽写回、review bucket、onTaskMove 等交互语义；不退化成单列 signal grid。

  **Recommended Agent Profile**:
  - Category: `visual-engineering` — Reason: 需要强参考对齐，同时保持 observer-only 语义。
  - Skills: [`frontend-ui-ux`] — 用于在贴近 reference 的同时替换业务语义。
  - Omitted: [`playwright`] — 统一在任务 7 做浏览器级收口。

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: 7 | Blocked By: 1, 2

  **References** (executor has NO interview context — be exhaustive):
  - Pattern: `frontend/src/components/CollabPage.tsx:63` — 当前看板仍是 summary + signal grid，不是 board。
  - Test: `frontend/src/components/CollabPage.test.tsx:38` — 当前测试只锁定标题与单个链接，需要重写为列与卡片断言。
  - Reference: `/data/projects/openclaw-mission-control/frontend/src/components/organisms/TaskBoard.tsx:43` — reference board columns, density, counts, and card grouping language.
  - Reference: `/data/projects/openclaw-mission-control/frontend/src/components/organisms/TaskBoard.tsx:362` — reference board uses grid-based board shell and column headers.

  **Acceptance Criteria** (agent-executable only):
  - [ ] `npm --prefix frontend run test -- src/components/CollabPage.test.tsx` 通过。
  - [ ] `npm --prefix frontend run build` 通过。

  **QA Scenarios** (MANDATORY — task incomplete without these):
  ```
  Scenario: Read-only board language
    Tool: Playwright
    Steps: Open `/kanban`; assert `[data-testid="kanban-board"]` is visible; assert four column headers `需关注` `进行中` `待巡视` `已完成`; open a card drill-down link
    Expected: The page reads as a multi-column board, not a dashboard or card grid, and drill-down remains canonical
    Evidence: .sisyphus/evidence/task-5-kanban-board.png

  Scenario: No write semantics leak in
    Tool: Bash
    Steps: Run `rg --line-number "draggable|onTaskMove|drop|review bucket|approval" frontend/src/components/CollabPage.tsx frontend/src/components/CollabPage.test.tsx`
    Expected: No Mission Control drag/write semantics are copied into Linpo kanban implementation
    Evidence: .sisyphus/evidence/task-5-kanban-board-error.txt
  ```

  **Commit**: YES | Message: `feat: 重建 kanban 为只读看板视图` | Files: [`frontend/src/components/CollabPage.tsx`, `frontend/src/components/CollabPage.test.tsx`]

- [x] 6. 极简化 session 页面与 AgentWorkspace 主舞台

  **What to do**: 重构 `frontend/src/components/SessionPage.tsx` 与 `frontend/src/components/AgentWorkspace.tsx`，让桌面与移动端默认只呈现极简标题、消息流、底部输入区。删除/隐藏现有实例列表侧栏、状态面板、tabs、日志/files/status 分区和任何非必要控制提示；保留 canonical route 处理与最小空态，但把未选中实例空态收缩成轻提示。桌面端将消息流容器与输入区包裹在同一个 `max-width: 880px` 的中心内容带内，两侧留白；移动端全宽但维持同一三段式信息层级。若当前 `AgentWorkspace` 仍保留只读提示或低频控制说明，默认收纳为折叠 disclosure，不得占用主舞台。
  **Must NOT do**: 不保留 `InstanceList` 左栏，不新增右栏或标签页，不把状态/节点/日志板块继续放在默认页面上。

  **Recommended Agent Profile**:
  - Category: `visual-engineering` — Reason: 这是最明显的结构收缩任务，涉及父页面和工作区共同改造。
  - Skills: [`frontend-ui-ux`] — 用于让消息阅读路径更稳定、克制。
  - Omitted: [`playwright`] — 组件测试先锁结构，浏览器级在任务 7 统一验证。

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: 7 | Blocked By: 1, 2

  **References** (executor has NO interview context — be exhaustive):
  - Pattern: `frontend/src/components/SessionPage.tsx:138` — 当前桌面双栏（实例列表 + workspace）布局需要删除。
  - Pattern: `frontend/src/components/AgentWorkspace.tsx:28` — 当前引用 `SessionActions` / `SessionList`，是本次极简化的关键入口。
  - Pattern: `frontend/src/components/SessionActions.tsx` — 当前只读提示文本“当前阶段仅保留观察与进入能力”已存在，可改为折叠提示而非主内容。
  - Test: `frontend/src/components/SessionPage.test.tsx:120` — 当前测试锁定实例列表与 canonical route，需要保留路由行为、替换结构断言。

  **Acceptance Criteria** (agent-executable only):
  - [ ] `npm --prefix frontend run test -- src/components/SessionPage.test.tsx src/components/AgentWorkspace.readonly.test.tsx src/components/SessionActions.readonly.test.tsx` 通过。
  - [ ] `npm --prefix frontend run build` 通过。

  **QA Scenarios** (MANDATORY — task incomplete without these):
  ```
  Scenario: Minimal session shell
    Tool: Playwright
    Steps: Open one canonical `/session/:instanceId/:agentId`; assert `[data-testid="session-stream-shell"]` and `[data-testid="session-input-shell"]` are visible; assert no sidebar/tabs/status-panel selectors exist
    Expected: Session presents only title + stream + input and keeps canonical route intact
    Evidence: .sisyphus/evidence/task-6-session-minimal.png

  Scenario: Desktop width guardrail
    Tool: Playwright
    Steps: View the same session at desktop viewport; inspect content container width
    Expected: Message stream wrapper max-width resolves to `880px` (or less due to viewport), with visible left/right whitespace
    Evidence: .sisyphus/evidence/task-6-session-minimal-error.png
  ```

  **Commit**: YES | Message: `feat: 极简化 session 消息主舞台` | Files: [`frontend/src/components/SessionPage.tsx`, `frontend/src/components/AgentWorkspace.tsx`, `frontend/src/components/SessionPage.test.tsx`, `frontend/src/components/AgentWorkspace.readonly.test.tsx`, `frontend/src/components/SessionActions.readonly.test.tsx`]

- [x] 7. 刷新测试、Playwright 场景与最终证据闭环

  **What to do**: 在页面实现稳定后，系统性更新 Playwright 与组件测试，确保它们验证的是新的结构，而不是旧 dashboard / panel / sidebar 布局。新增或更新 e2e 场景，覆盖桌面 `overview` 主次层级、`topology` graph-only、`kanban` board-only、`session` minimal shell，以及至少一个移动断点验证。保留现有 canonical drill-down、instanceId 约束与 observer-only 行为断言。最后运行 `make quality` 与部署 Playwright，刷新 evidence。
  **Must NOT do**: 不保留依赖旧 DOM 结构的脆弱选择器；不使用“人工看起来正确”作为完成标准；不把 Mission Control 的交互测试照搬进 Linpo。

  **Recommended Agent Profile**:
  - Category: `unspecified-high` — Reason: 这是多页面、多层验证与证据收口任务。
  - Skills: [`playwright`, `superpowers/verification-before-completion`] — 用于浏览器验收和基于真实输出的收口。
  - Omitted: [`frontend-ui-ux`] — 该任务聚焦验证，不是设计发散。

  **Parallelization**: Can Parallel: NO | Wave 2 | Blocks: none | Blocked By: 2, 3, 4, 5, 6

  **References** (executor has NO interview context — be exhaustive):
  - Test: `frontend/src/components/OverviewPage.test.tsx` — 需保留 agent drill-down 行为断言。
  - Test: `frontend/src/components/InstanceTopology.test.tsx` — 需替换掉旧按钮/未暴露 section 断言。
  - Test: `frontend/src/components/CollabPage.test.tsx` — 需替换成列/卡片层级断言。
  - Test: `frontend/src/components/SessionPage.test.tsx` — 需保留 canonical route 行为、删除实例侧栏依赖。
  - E2E base: `frontend/playwright.config.ts` — 现有 Playwright 入口。
  - Existing flow: `frontend/e2e/v0.6-overview-topology-session.spec.ts` — 现有 v0.6 浏览器验收脚本入口，可扩展为 UI realignment 验收。

  **Acceptance Criteria** (agent-executable only):
  - [ ] `npm --prefix frontend run test -- src/components/OverviewPage.test.tsx src/components/InstanceTopology.test.tsx src/components/CollabPage.test.tsx src/components/SessionPage.test.tsx` 通过。
  - [ ] `PLAYWRIGHT_BASE_URL=http://175.178.213.10:5173 npm --prefix frontend run e2e -- --grep "ui-realignment|v0.6"` 通过。
  - [ ] `make quality` 通过。

  **QA Scenarios** (MANDATORY — task incomplete without these):
  ```
  Scenario: Desktop four-page UI verification
    Tool: Playwright
    Steps: Run the deployed flow through `/overview` → `/topology` → `/kanban` → `/session/:instanceId/:agentId`
    Expected: Each page exposes the new main-stage selector and none of the banned structures (dashboard stats grid, topology panels, kanban signal grid, session sidebar) remain
    Evidence: .sisyphus/evidence/task-7-ui-realignment.txt

  Scenario: Mobile minimal regression
    Tool: Playwright
    Steps: Run one mobile viewport scenario across `/overview` and `/session/:instanceId/:agentId`
    Expected: Overview degrades to a single-column card flow and session remains title + stream + input with no extra panels
    Evidence: .sisyphus/evidence/task-7-ui-realignment-error.txt
  ```

  **Commit**: YES | Message: `test: 刷新 UI 重对齐验收与证据` | Files: [`frontend/src/components/*.test.tsx`, `frontend/e2e/*.spec.ts`, `.sisyphus/evidence/*`]

## Final Verification Wave (4 parallel agents, ALL must APPROVE)
- [x] F1. Plan Compliance Audit — oracle
- [x] F2. Code Quality Review — unspecified-high
- [x] F3. Real Manual QA — unspecified-high (+ playwright if UI)
- [x] F4. Scope Fidelity Check — deep

## Commit Strategy
- 先提交 docs 真源冻结，再提交共享 shell/test-id contract。
- `overview`、`topology`、`kanban`、`session` 各自独立提交，避免视觉回滚边界混杂。
- graph 依赖引入与 topology 重构放在同一个提交，避免依赖半引入状态。
- 最终测试与 evidence 刷新单独提交。

## Success Criteria
- 四个页面一眼可辨，不能再呈现模板化复用观感。
- `overview` 的主舞台是 agents 卡片列表，摘要仅占极小区域。
- `topology` 页面主内容只有自动布局 graph。
- `kanban` 看起来是板式工作流界面，而不是 signal grid 或 dashboard。
- `session` 页面默认只保留极简标题、消息流、底部输入区，且桌面端宽度受限。
- 所有 drill-down 继续走 canonical `/session/:instanceId/:agentId`，所有 observer-only 边界仍成立。

## Final Closure
- 本计划已完成最终收口状态同步。Task1-7 与 Final Verification Wave 的 F1-F4 已按当前证据落盘状态完成勾选，不再保留未收口模板态。
- 最终验收主证据见 `.sisyphus/evidence/task-7-ui-realignment.txt`。其中已记录部署环境 Playwright `ui-realignment|v0.6` 验收结果为 `3 passed`，并记录 `make quality` 结果为 `passed`，包含 pytest、basedpyright 与 frontend build 全链路通过。
- 四类最终审计证据已落盘：`.sisyphus/evidence/f1-plan-compliance-20260322.md`、`.sisyphus/evidence/f2-code-quality-20260322.md`、`.sisyphus/evidence/f3-real-manual-qa-20260322.md`、`.sisyphus/evidence/f4-scope-fidelity-20260322.md`。
- 本次收口同步只更新计划文档状态，不改动业务代码、测试代码与证据文件。若需追踪 F2、F3、F4 中记录的残余风险或条件说明，以各证据文件原文为准。
