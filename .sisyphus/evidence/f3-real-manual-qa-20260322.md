# F3 Real Manual QA - 2026-03-22

- Verdict: APPROVE with recorded risk
- Scope: deployed UI real manual QA on `http://175.178.213.10:5173`
- Path under test: `/overview -> /topology -> /kanban -> /session/:instanceId/:agentId`
- Cross-check sources: `.sisyphus/plans/ui-design-realignment-work-plan.md`, `.sisyphus/notepads/ui-design-realignment-work-plan/learnings.md`

## Test Fixture

- Manual QA user: `f3-manual-1774164083`
- Created instance: `claw1-f3-4083`
- Backend create result: `201 Created`
- Instance id: `82de9a95-f40d-4dc4-98c6-fac3b18d716a`
- Canonical drill-down used for verification: `/session/82de9a95-f40d-4dc4-98c6-fac3b18d716a/main`

## Screenshot Index

- Desktop overview: `f3-overview-desktop.png`
- Desktop topology: `f3-topology-desktop.png`
- Desktop kanban: `f3-kanban-desktop.png`
- Desktop session: `f3-session-desktop.png`
- Mobile overview: `f3-overview-mobile.png`
- Mobile session: `f3-session-mobile.png`

## Desktop Verification

### 1. `/overview`

| 步骤 | 观察 | 结论 |
| --- | --- | --- |
| 登录后打开 `/overview`，等待聚合数据返回，并检查 `overview-summary-strip` 与 `overview-agents-grid`。 | `overview-summary-strip` 可见，bbox `1319x30`；`overview-agents-grid` 可见，bbox `1319x886`；实例 `claw1-f3-4083` 可见；legacy 文案 `全部 agents` / `活跃中` / `值得巡视` count 均为 `0`；未发现 `overview-stats-grid` 或额外 sidebar。 | 通过：overview 主舞台仍是 agents-first grid，摘要条保持紧凑，旧 dashboard 结构未回流。 |
| 读取 overview 首个会话入口 href。 | 首个 drill-down href 为 `/session/82de9a95-f40d-4dc4-98c6-fac3b18d716a/main`。 | 通过：overview 保持 canonical drill-down。 |

### 2. `/topology`

| 步骤 | 观察 | 结论 |
| --- | --- | --- |
| 打开 `/topology`，检查 `topology-graph-canvas`、节点数量与 banned structures absence。 | `topology-graph-canvas` 可见；检测到 `2` 个 topology nodes；`技能关系` / `外接 ACP` heading count 均为 `0`；`配置实例 ...` button count 为 `0`；未检测到 detail/config/sidebar/panel testid。 | 通过：topology 主内容仍为 graph-only canvas，旧多面板/配置结构未回流。 |
| 按继承经验先读取 agent 节点 drill-down href，而不是直接点击 overlay 区域。 | 首个 topology drill-down href 为 `/session/82de9a95-f40d-4dc4-98c6-fac3b18d716a/main`。 | 通过：topology 保持 canonical drill-down，规避了 React Flow overlay click flake。 |

### 3. `/kanban`

| 步骤 | 观察 | 结论 |
| --- | --- | --- |
| 打开 `/kanban`，检查 `kanban-board` 与四列列头。 | `kanban-board` 可见，bbox `1319x852`；四列 `需关注` / `进行中` / `待巡视` / `已完成` count 均为 `1`；board 内 `article` count 为 `1`；实例 `claw1-f3-4083` 卡片落在 `进行中` 列。 | 通过：kanban 仍是多列 board 语言，不是 signal grid/dashboard 回退。 |
| 检查 board 内写语义与会话入口。 | 首个 board drill-down href 为 `/session/82de9a95-f40d-4dc4-98c6-fac3b18d716a/main`；`draggable/data-draggable/data-droppable` count 为 `0`；`kanban-signal-grid` count 为 `0`。 | 通过：observer-only 边界成立，无拖拽/写回语义泄漏。 |

### 4. Canonical `/session/:instanceId/:agentId` Desktop Shell

| 步骤 | 观察 | 结论 |
| --- | --- | --- |
| 直接进入 `/session/82de9a95-f40d-4dc4-98c6-fac3b18d716a/main`，检查 `session-stream-shell` 与 `session-input-shell`。 | URL 保持 canonical session path；`session-stream-shell` 可见，bbox `880x975`；`session-input-shell` 可见，bbox `848x52`；页面存在标题、消息流区域与底部输入区。 | 通过：session 桌面端维持 title/stream/input 三段式最小壳层。 |
| 检查桌面宽度 guardrail 与 banned structures absence。 | 宽度探针显示内容带宽度 `880px`，computed `max-width: 880px`；`tabs/sidebar/statusPanel/sessionList` count 均为 `0`。 | 通过：桌面端阅读带受限宽度成立，旧 sidebar/tabs/status panel 未回流。 |

## Mobile Verification

### 5. `/overview` at `390x844`

| 步骤 | 观察 | 结论 |
| --- | --- | --- |
| 调整 viewport 到 `390x844`，重新打开 `/overview`，检查单列退化。 | `overview-summary-strip` 可见，bbox `358x30`；`overview-agents-grid` 可见，bbox `358x666`；computed `gridTemplateColumns` 为 `358px`；实例 `claw1-f3-4083` 仍可见。 | 通过：overview 在移动端退化为单列卡片流，没有出现多列拥挤布局。 |

### 6. Canonical Session at `390x844`

| 步骤 | 观察 | 结论 |
| --- | --- | --- |
| 保持 viewport `390x844`，打开 canonical session，检查 title/stream/input 是否仍完整。 | 标题可见，title text 为 `会话`；`session-stream-shell` 可见，bbox `390x746`；`session-input-shell` 可见，bbox `366x48`；stream/input 均处于 viewport 内。 | 通过：移动端 session 仍保留 title/stream/input 三段式，无额外面板侵入。 |
| 检查移动端 banned structures absence。 | `tabs/sidebar/statusPanel` count 均为 `0`。 | 通过：移动端没有回流桌面侧栏/标签页/状态面板。 |

## Recorded Risk / Failure Context

### `/topology` console warning

- 观察到 `3` 条相同 warning：`[React Flow]: The React Flow parent container needs a width and a height to render the graph. Help: https://reactflow.dev/error#004`
- 该 warning 出现时，graph canvas 仍可见，instance/agent 两个节点可见，canonical drill-down href 也正确。
- 当前判定为 non-blocking risk，不阻断本次 UI manual QA 通过，但如果目标是 console-clean baseline，需要后续单独收敛该 warning。

## Final Conclusion

- 桌面四页主舞台 selector 均可见：`overview-summary-strip`、`overview-agents-grid`、`topology-graph-canvas`、`kanban-board`、`session-stream-shell`、`session-input-shell`。
- 桌面 banned structures absence 满足计划要求：未见 overview stats grid、topology detail/config/sidebar panel、kanban signal grid、session sidebar/tabs/status panel。
- 移动断点满足计划要求：overview 为单列退化；session 仍保留 title/stream/input。
- Canonical drill-down `/session/:instanceId/:agentId` 在 overview、topology、kanban 三处均指向同一实例/agent 路径。
- 本次 F3 真实手工验收结论：功能路径通过，记录一个 `/topology` React Flow console warning 风险项。
