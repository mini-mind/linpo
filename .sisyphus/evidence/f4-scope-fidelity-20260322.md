# F4 Scope Fidelity Check - 2026-03-22

- Verdict: 有条件通过
- Core conclusion: 当前实现整体符合“UI hierarchy correction, not IA rewrite”；主路由与四页职责未被重写，但 `topology` 仍有 2 处边界残留需要收口。
- Scope checked against: `README.md:114`, `docs/prd/2026-03-15-linpo-v0.1-observer-prd.md:247`, `docs/architecture/2026-03-15-observer-architecture.md:88`, `.sisyphus/plans/ui-design-realignment-work-plan.md:24`

## Fresh Verification Evidence

### Commands run now

```bash
npm --prefix frontend run test -- src/components/OverviewPage.test.tsx src/components/InstanceTopology.test.tsx src/components/CollabPage.test.tsx src/components/SessionPage.test.tsx
npm --prefix frontend run build
npm --prefix frontend run test -- src/components/InstanceTopology.readonly.test.tsx
```

### Observed summary

- Four-page component suite: 4 files passed, 46 tests passed.
- Frontend build: `tsc --noEmit && vite build` passed.
- LSP diagnostics: no diagnostics on `frontend/src/components/OverviewPage.tsx`, `frontend/src/components/InstanceTopology.tsx`, `frontend/src/components/CollabPage.tsx`, `frontend/src/components/SessionPage.tsx`, `frontend/src/components/AgentWorkspace.tsx`, `frontend/src/main.tsx`.
- Extra check outside plan DoD: `frontend/src/components/InstanceTopology.readonly.test.tsx` currently fails; it still asserts the pre-realignment detail-modal path and has a stale `useCurrentInstance` mock.

## Constraint -> Implementation Matrix

| Constraint | Source freeze | Implementation mapping | Result |
| --- | --- | --- | --- |
| `overview` 不回到 dashboard 主舞台 | `README.md:115`, `docs/prd/2026-03-15-linpo-v0.1-observer-prd.md:249`, `docs/architecture/2026-03-15-observer-architecture.md:90`, `.sisyphus/plans/ui-design-realignment-work-plan.md:19` | `frontend/src/components/OverviewPage.tsx:67` 保留紧凑 summary strip，`frontend/src/components/OverviewPage.tsx:94` 以 `overview-agents-grid` 为主体；`frontend/src/components/OverviewPage.test.tsx:181`、`frontend/src/components/OverviewPage.test.tsx:196` 防回退到 stats/diagnostics 大面板；`frontend/e2e/v0.6-overview-topology-session.spec.ts:137` 再次校验旧 dashboard 文案不存在 | 通过 |
| `topology` 必须 graph-only，不能回引详情/配置侧栏 | `README.md:116`, `docs/prd/2026-03-15-linpo-v0.1-observer-prd.md:250`, `docs/architecture/2026-03-15-observer-architecture.md:91`, `.sisyphus/plans/ui-design-realignment-work-plan.md:20`, `.sisyphus/plans/ui-design-realignment-work-plan.md:26`, `.sisyphus/plans/ui-design-realignment-work-plan.md:57`, `.sisyphus/plans/ui-design-realignment-work-plan.md:65` | `frontend/src/components/TopologyPage.tsx:3` 只包一层 `InstanceTopology`；`frontend/src/components/InstanceTopology.tsx:317` 到 `frontend/src/components/InstanceTopology.tsx:355` 主体为 ReactFlow 画布；`frontend/src/components/InstanceTopology.test.tsx:144` 明确 sidebar/detail/config panel 不存在；`frontend/e2e/v0.6-overview-topology-session.spec.ts:157` 到 `frontend/e2e/v0.6-overview-topology-session.spec.ts:164` 也断言旧 panel/button 不再出现 | 有偏差 |
| `topology` 不应出现拖拽写回/编辑语义 | `README.md:116`, `docs/prd/2026-03-15-linpo-v0.1-observer-prd.md:250`, `docs/architecture/2026-03-15-observer-architecture.md:91`, `.sisyphus/plans/ui-design-realignment-work-plan.md:34` | `frontend/src/components/InstanceTopology.tsx:173` 到 `frontend/src/components/InstanceTopology.tsx:176` 使用 `useNodesState/useEdgesState`；`frontend/src/components/InstanceTopology.tsx:343` 到 `frontend/src/components/InstanceTopology.tsx:344` 仍把 `onNodesChange/onEdgesChange` 交给 ReactFlow；各节点继续暴露 `Handle`，见 `frontend/src/components/InstanceTopology.tsx:77`, `frontend/src/components/InstanceTopology.tsx:97`, `frontend/src/components/InstanceTopology.tsx:125`, `frontend/src/components/InstanceTopology.tsx:141` | 有歧义 |
| `kanban` 只读，不含 drag/write/审批语义 | `README.md:117`, `docs/prd/2026-03-15-linpo-v0.1-observer-prd.md:251`, `docs/architecture/2026-03-15-observer-architecture.md:92`, `.sisyphus/plans/ui-design-realignment-work-plan.md:21`, `.sisyphus/plans/ui-design-realignment-work-plan.md:27`, `.sisyphus/plans/ui-design-realignment-work-plan.md:67` | `frontend/src/components/CollabPage.tsx:177` 到 `frontend/src/components/CollabPage.tsx:217` 是固定多列 board；`frontend/src/components/CollabPage.tsx:283` 只保留 drill-down；对 `frontend/src/components/CollabPage.tsx` 与 `frontend/src/components/CollabPage.test.tsx` 运行 `rg "draggable|onTaskMove|drop|review bucket|approval|审批|拖拽"` 无命中；`frontend/src/components/CollabPage.test.tsx:38` 到 `frontend/src/components/CollabPage.test.tsx:176` 验证列头、分栏与 canonical drill-down | 通过 |
| `session` 极简壳 + desktop 880px + canonical route | `README.md:118`, `docs/prd/2026-03-15-linpo-v0.1-observer-prd.md:252`, `docs/architecture/2026-03-15-observer-architecture.md:93`, `.sisyphus/plans/ui-design-realignment-work-plan.md:22`, `.sisyphus/plans/ui-design-realignment-work-plan.md:28`, `.sisyphus/plans/ui-design-realignment-work-plan.md:35`, `.sisyphus/plans/ui-design-realignment-work-plan.md:59`, `.sisyphus/plans/ui-design-realignment-work-plan.md:60`, `.sisyphus/plans/ui-design-realignment-work-plan.md:64` | `frontend/src/components/SessionPage.tsx:11` 固定 `DESKTOP_MAX_WIDTH = 880`；`frontend/src/components/SessionPage.tsx:13` 到 `frontend/src/components/SessionPage.tsx:18` 与 `frontend/src/components/SessionPage.tsx:61` 到 `frontend/src/components/SessionPage.tsx:65` 实现 canonical route builder + compatibility redirect；`frontend/src/components/SessionPage.tsx:124` 到 `frontend/src/components/SessionPage.tsx:168` 为桌面三段式 shell；`frontend/src/components/AgentWorkspace.tsx:595` 到 `frontend/src/components/AgentWorkspace.tsx:675` 为消息流 + 输入区；`frontend/src/components/SessionPage.test.tsx:102` 到 `frontend/src/components/SessionPage.test.tsx:150` 和 `frontend/src/components/AgentWorkspace.readonly.test.tsx:77` 到 `frontend/src/components/AgentWorkspace.readonly.test.tsx:123` 锁定 canonical route / 无 tabs / 无列表面板 | 通过（有轻微歧义） |
| 是否仍是 UI hierarchy correction，而非 IA rewrite | `.sisyphus/plans/ui-design-realignment-work-plan.md:31`, `.sisyphus/plans/ui-design-realignment-work-plan.md:39`, `.sisyphus/plans/ui-design-realignment-work-plan.md:68` | `frontend/src/main.tsx:31` 到 `frontend/src/main.tsx:39` 仍是 `/overview -> /topology|/kanban -> /session/:instanceId/:agentId`；`frontend/src/components/Layout.tsx:7` 到 `frontend/src/components/Layout.tsx:10` 主导航仍是四页语义；`frontend/src/main.tsx:41` 仅保留一个旧 `collab` 兼容别名 | 通过 |

## Deviations / Ambiguities

### 1. Topology footer summary breaches the strict graph-only reading

- `frontend/src/components/InstanceTopology.tsx:356` 到 `frontend/src/components/InstanceTopology.tsx:368` 仍渲染 footer strip，展示 `实例 / agents / skills / ACPs` 计数。
- 这与 `.sisyphus/plans/ui-design-realignment-work-plan.md:26`、`.sisyphus/plans/ui-design-realignment-work-plan.md:34` 所说“外围 UI 仅限极简标题区与 fit/reset 级别画布控件”“不允许统计卡”不完全一致。
- 影响：不改变 IA，但削弱了 `graph-only` 纯度。

### 2. Topology interactivity is not hardened to observer-only

- 当前没有看到显式的 `nodesDraggable={false}`、`nodesConnectable={false}`、`elementsSelectable={false}` 之类硬关闭；反而保留了 `onNodesChange/onEdgesChange` 和多个 `Handle`。
- 这更像“本地可交互但不写回”的画布，而不是“语义上完全无编辑暗示”的只读图。
- 影响：视觉/交互语义上仍有越界风险，尤其与 `README.md:116` 的“禁止任何拖拽写回式编辑”口径贴得不够紧。

### 3. Session shell has two low-risk ambiguities, but not enough to flip verdict

- `frontend/src/components/SessionPage.tsx:133` 到 `frontend/src/components/SessionPage.tsx:137` 头部仍显示连接状态徽标；这不是 `status panel`，但属于额外辅助信息。
- `frontend/src/components/AgentWorkspace.tsx:598` 到 `frontend/src/components/AgentWorkspace.tsx:619` 在多会话时会显示 session switcher；这不属于 `tabs/sidebar/status panel`，但比“只保留标题+消息流+底部输入区”的最严口径更宽一点。
- 结论：目前仍可解释为“最小辅助信息”，建议文档或测试继续澄清，而不是直接判定不通过。

### 4. Scope-locking test debt remains

- `frontend/src/components/InstanceTopology.readonly.test.tsx:42` 到 `frontend/src/components/InstanceTopology.readonly.test.tsx:66` 仍期望“实例按钮 -> detail modal -> readonly dialog”的旧 topology 交互模型。
- Fresh run 结果：该测试 1/1 失败，报错同时暴露过期 mock：`No "resolveCurrentInstanceId" export is defined on the "../hooks/useCurrentInstance" mock`。
- 这不代表现网 scope 回退，但说明“旧 readonly 契约测试”尚未与新 graph-only 设计一起收口。

## Execution Evidence vs Plan Checkbox State

- 当前“实现证据通过”与“计划 checkbox 未更新”必须分开看：本次 fresh test/build/LSP 证据表明主要 UI realignment 已落地，不能因为 `.sisyphus/plans/ui-design-realignment-work-plan.md` 仍未被 orchestrator 勾选，就倒推出实现未完成。
- 反过来，也不能只看 task 7 / F3 的通过证据就直接宣告 scope fidelity 无瑕：`topology` 的 footer/interactivity 以及 stale readonly test 仍然是真实偏差或遗留。

## Recommended Disposition

1. 去掉 `frontend/src/components/InstanceTopology.tsx:356` 到 `frontend/src/components/InstanceTopology.tsx:368` 的 footer summary，确保 topology 只剩标题、fit/reset、graph canvas。
2. 在 `frontend/src/components/InstanceTopology.tsx` 显式关闭 ReactFlow 的拖拽/连接/选择交互，并补负向测试，避免“看起来可编辑”。
3. 删除或重写 `frontend/src/components/InstanceTopology.readonly.test.tsx`，让测试契约与 graph-only 设计一致。
4. 视产品口径决定是否保留 session switcher / 连接状态徽标；若保留，建议把该例外写回文档或测试说明。

## Final Judgment

- 判定：有条件通过
- 明确回答：是，当前实现总体满足“UI hierarchy correction, not IA rewrite”。
- 条件：在最终收口前，需处理 `topology` graph-only 纯度问题（footer + interactivity）并清理 stale readonly test；否则 scope fidelity 仍留有可见裂缝。
