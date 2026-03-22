# F1 Plan Compliance Audit - 2026-03-22

## 审计范围
- 计划文件：`.sisyphus/plans/ui-design-realignment-work-plan.md`
- 对照对象：当前 README / PRD / architecture、前端实现、组件测试、Playwright 脚本、现有 evidence
- 审计方式：只读核验；不修改源码、测试、配置

## 新鲜命令证据
1. `npm --prefix frontend run test -- src/components/OverviewPage.test.tsx src/components/InstanceTopology.test.tsx src/components/CollabPage.test.tsx src/components/SessionPage.test.tsx`
   - 结果：4 files / 46 tests passed
2. `npm --prefix frontend run build`
   - 结果：Vite build 成功，产物生成于 `frontend/dist`
3. `PLAYWRIGHT_BASE_URL=http://175.178.213.10:5173 npm --prefix frontend run e2e -- --grep "ui-realignment|v0.6"`
   - 结果：2 passed；命中的仍是 `v0.6` 两条用例
4. `make quality`
   - 结果：pytest `131 passed, 2 skipped`；basedpyright `0 errors`；frontend build 再次通过
5. `npm --prefix frontend run test -- src/components/Layout.test.tsx src/components/AgentWorkspace.readonly.test.tsx src/components/SessionActions.readonly.test.tsx`
   - 结果：3 files / 14 tests passed
6. `rg --line-number "agents-first|watchlist|graph-only|Mission Control|极简标题|底部输入区|observer-only" README.md docs/prd/2026-03-15-linpo-v0.1-observer-prd.md docs/architecture/2026-03-15-observer-architecture.md`
   - 结果：README / PRD / architecture 都命中新 UI 冻结段落
7. `rg --line-number "overview-summary-strip|overview-agents-grid|topology-graph-canvas|kanban-board|session-stream-shell|session-input-shell" frontend/src/components frontend/src/lib frontend/e2e`
   - 结果：六个 selector 在组件与 e2e 中均可见；`frontend/src/lib` 目录不存在但不影响命中组件/e2e

## Task 逐项核验

### Task 1 - 冻结 UI 设计真源与页面 guardrails
- 结论：**未满足**
- 风险等级：**高**
- 已满足部分：新 UI 冻结段已写入 `README.md:114`、`docs/prd/2026-03-15-linpo-v0.1-observer-prd.md:247`、`docs/architecture/2026-03-15-observer-architecture.md:88`
- 不一致点：旧文案仍把 `topology` 定义为配置工作台并保留配置入口，例如 `README.md:20`、`README.md:34`、`README.md:87`、`README.md:106`、`docs/prd/2026-03-15-linpo-v0.1-observer-prd.md:207`、`docs/prd/2026-03-15-linpo-v0.1-observer-prd.md:222`、`docs/architecture/2026-03-15-observer-architecture.md:84`
- 审计判断：虽然“冻结段”已补齐，但真源文档内部仍自相矛盾，未达到 Task1 所要求的单一真源状态

### Task 2 - 建立共享页面骨架、test id 合约与视觉 guardrails
- 结论：**已满足**
- 风险等级：**低**
- 证据：`frontend/src/main.tsx:30`-`frontend/src/main.tsx:41` 保持四页挂载；`frontend/src/components/OverviewPage.tsx:67`、`frontend/src/components/OverviewPage.tsx:94`、`frontend/src/components/InstanceTopology.tsx:317`、`frontend/src/components/CollabPage.tsx:178`、`frontend/src/components/AgentWorkspace.tsx:596`、`frontend/src/components/AgentWorkspace.tsx:649` 暴露稳定 selector
- 验证：`Layout.test.tsx`、`OverviewPage.test.tsx`、`SessionPage.test.tsx` 均通过；selector `rg` 命中组件与 e2e

### Task 3 - 重建 overview 为 agents-first watchlist 页面
- 结论：**已满足**
- 风险等级：**中**
- 证据：主舞台 agents grid 在 `frontend/src/components/OverviewPage.tsx:94`；summary strip 为紧凑条带 `frontend/src/components/OverviewPage.tsx:67`；空态引导到 `/topology` 在 `frontend/src/components/OverviewPage.tsx:85`-`frontend/src/components/OverviewPage.tsx:91`；卡片 drill-down 在 `frontend/src/components/OverviewPage.tsx:153`-`frontend/src/components/OverviewPage.tsx:160`
- 验证：`frontend/src/components/OverviewPage.test.tsx` 通过，并断言无旧 stats grid / diagnostics 区块；Playwright 用例也校验 overview 新 selector
- 残留风险：`OverviewPage` 错误态仅显示错误包络，未提供显式 retry 按钮（`frontend/src/components/OverviewPage.tsx:44`-`frontend/src/components/OverviewPage.tsx:53`），与计划里“状态矩阵”要求相比偏弱

### Task 4 - 重建 topology 为 graph-only 自动布局画布
- 结论：**未满足**
- 风险等级：**高**
- 主要问题 1：页面底部仍有统计条 `frontend/src/components/InstanceTopology.tsx:356`-`frontend/src/components/InstanceTopology.tsx:367`，与计划“页面内容原则上只有 graph 关系图；不混入统计摘要”不一致
- 主要问题 2：实现未消费后端 `topology.edges`；当前只在 `frontend/src/components/InstanceTopology.tsx:217`-`frontend/src/components/InstanceTopology.tsx:241` 人工构造 instance→agent 边，`skills` / `external_acps` 仅生成孤立节点（`frontend/src/components/InstanceTopology.tsx:244`-`frontend/src/components/InstanceTopology.tsx:267`），关系图表达不完整
- 反向证据：测试还把 footer summary 锁成预期行为（`frontend/src/components/InstanceTopology.test.tsx:301`-`frontend/src/components/InstanceTopology.test.tsx:320`），说明当前 drift 已被固化进测试

### Task 5 - 重建 kanban 为 Mission Control 风格的只读看板
- 结论：**已满足**
- 风险等级：**低**
- 证据：四列只读 board 结构在 `frontend/src/components/CollabPage.tsx:23`-`frontend/src/components/CollabPage.tsx:52`、`frontend/src/components/CollabPage.tsx:177`-`frontend/src/components/CollabPage.tsx:216`；卡片 drill-down 在 `frontend/src/components/CollabPage.tsx:283`-`frontend/src/components/CollabPage.tsx:289`
- Guardrail：`rg --line-number "draggable|onTaskMove|drop|review bucket|approval" frontend/src/components/CollabPage.tsx frontend/src/components/CollabPage.test.tsx` 无命中，未发现 Mission Control 写语义泄漏
- 验证：`frontend/src/components/CollabPage.test.tsx` 通过，并覆盖列头、分组、诊断提醒与 canonical 链接

### Task 6 - 极简化 session 页面与 AgentWorkspace 主舞台
- 结论：**已满足**
- 风险等级：**低**
- 证据：桌面宽度上限 `880px` 在 `frontend/src/components/SessionPage.tsx:11`、`frontend/src/components/SessionPage.tsx:244`、`frontend/src/components/SessionPage.tsx:253`；最小 shell selector 在 `frontend/src/components/AgentWorkspace.tsx:596`、`frontend/src/components/AgentWorkspace.tsx:649`；只读提示默认折叠在 `frontend/src/components/AgentWorkspace.tsx:650`-`frontend/src/components/AgentWorkspace.tsx:671`
- Guardrail：`AgentWorkspace.readonly.test.tsx` 明确断言无 tabs / session list / destructive controls；`SessionPage.test.tsx` 断言无 instance sidebar
- 验证：`SessionPage.test.tsx`、`AgentWorkspace.readonly.test.tsx`、`SessionActions.readonly.test.tsx` 全部通过

### Task 7 - 刷新测试、Playwright 场景与最终证据闭环
- 结论：**未满足**
- 风险等级：**高**
- 已满足部分：总 DoD 三条命令都通过；Playwright 确实覆盖了 overview / topology / kanban / session 主链路
- 不满足点 1：e2e 仅保留 `v0.6` 标识，未引入计划要求的 `ui-realignment` 场景名（`frontend/e2e/v0.6-overview-topology-session.spec.ts:122`-`frontend/e2e/v0.6-overview-topology-session.spec.ts:123`、`frontend/e2e/v0.6-overview-topology-session.spec.ts:193`）
- 不满足点 2：脚本内没有 mobile viewport / `page.setViewportSize` / `test.use({ viewport })` 一类断言，未满足“至少一个移动断点验证”
- 不满足点 3：evidence 文件名与计划不一致；脚本实际写入 `task-9-playwright.png` 与 `task-9-playwright-error.png`（`frontend/e2e/v0.6-overview-topology-session.spec.ts:186`、`frontend/e2e/v0.6-overview-topology-session.spec.ts:373`），而计划要求 `task-7-ui-realignment.txt` / `task-7-ui-realignment-error.txt`
- 不满足点 4：`.sisyphus/evidence/` 下未见 `task-7-ui-realignment.*`；现有 `task-7-manual-login-snapshot.md` 为空文件

## Guardrails 专项核验
- `overview`：**通过**。agents-first 主舞台、紧凑 summary、canonical drill-down 均成立
- `topology`：**未通过**。graph-only guardrail 被 footer summary 和不完整边关系打破
- `kanban`：**通过**。多列 board、只读 observer-only 边界成立
- `session`：**通过**。默认仅保留标题 + 消息流 + 底部输入区，无 tabs/sidebar/status-panel

## DoD 与计划一致性总评
- **DoD 三条命令 + `make quality`：通过**
- **Task1-7 计划一致性：不通过**
- 原因：命令层面已绿，但文档真源、topology guardrail、Task7 证据闭环仍存在明确偏差，当前不建议直接做“计划已完成”收口

## 建议主编排代理补跑项
1. **补跑 Task1 文档统一**：消除 README / PRD / architecture 中仍保留的 topology 配置工作台旧口径，再重新执行 Task1 的 `rg` 验收
2. **补跑 Task4 topology 收敛**：移除 footer summary，改为消费真实关系边（至少不再只剩 instance→agent 关系），然后重跑 `InstanceTopology.test.tsx`、build、Playwright
3. **补跑 Task7 验收闭环**：为 e2e 补上 `ui-realignment` 命名和移动断点场景，按计划落盘 `task-7-ui-realignment.*` evidence，再重新执行 Playwright / `make quality`
