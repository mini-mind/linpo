# F2 Code Quality Review — UI realignment

## 审查范围
- 审查对象：`frontend/src/components/OverviewPage.tsx`、`frontend/src/components/InstanceTopology.tsx`、`frontend/src/components/CollabPage.tsx`、`frontend/src/components/SessionPage.tsx`、`frontend/src/components/AgentWorkspace.tsx`、对应组件测试，以及 `frontend/e2e/v0.6-overview-topology-session.spec.ts`。
- 对照基线：`.sisyphus/plans/ui-design-realignment-work-plan.md:24`、`.sisyphus/plans/ui-design-realignment-work-plan.md:33`、`.sisyphus/plans/ui-design-realignment-work-plan.md:259`、`.sisyphus/plans/ui-design-realignment-work-plan.md:298`。

## 发布判定
- 结论：**需修复后发布**。
- 原因：当前实现的测试、构建、`make quality` 都通过，但 topology/kanban 仍存在会影响 observer 视图语义的真实缺陷，且 e2e 对 session/topology 的禁用结构约束覆盖还不够严。

## Findings

### 1. High — topology 没有消费服务端 `edges`，skill / ACP 关系会被静默丢失
- 证据：`frontend/src/api/types.ts:133` 定义了 `AggregateTopologyEdgeItem`，`frontend/src/api/types.ts:162` 在聚合响应中保留了 `edges`；但 `frontend/src/components/InstanceTopology.tsx:200` 到 `frontend/src/components/InstanceTopology.tsx:275` 只手工生成了 `instance -> agent` 边，针对 `skills`/`external_acps` 只建节点、不建边；对 `frontend/src/components/InstanceTopology.tsx` 做 `topology\.edges|\.edges\b` 搜索结果为 0 命中。
- 影响：拓扑页本该是“关系图”，现在会把 skill / ACP 降级成孤立库存节点。只要后端返回了非 agent 关系，前端就会漏画，观察结果失真。
- 建议：以 `topology.edges` 为主构图来源，必要时再用 `target_ids` 做兜底；同时给 `frontend/src/components/InstanceTopology.test.tsx` 增加 skill / ACP 连边断言，避免只验证“节点存在”。

### 2. Medium — topology 刷新为空图时不会清空旧图，存在 stale graph 边界 bug
- 证据：`frontend/src/components/InstanceTopology.tsx:195` 在无数据时会产出空的 `convertedNodes` / `convertedEdges`；但 `frontend/src/components/InstanceTopology.tsx:278` 到 `frontend/src/components/InstanceTopology.tsx:283` 只在 `convertedNodes.length > 0` 时才同步 React Flow 状态。
- 影响：如果页面先渲染过非空拓扑，后续刷新拿到空图，旧节点/边会继续留在画布上，用户看到的是过期关系图，不符合计划要求的 `loading / empty / error / partial / retry` 状态矩阵。
- 建议：无论数组是否为空都执行 `setNodes(convertedNodes)` 与 `setEdges(convertedEdges)`，并补一条“非空 -> 空图”回归测试。

### 3. Medium — topology 仍保留 footer summary，且测试把这一违禁结构固化下来了
- 证据：计划明确定义 topology 主舞台只保留 graph 关系图与极简画布控件，禁止统计摘要卡或额外面板：`.sisyphus/plans/ui-design-realignment-work-plan.md:26`、`.sisyphus/plans/ui-design-realignment-work-plan.md:34`、`.sisyphus/plans/ui-design-realignment-work-plan.md:65`。但 `frontend/src/components/InstanceTopology.tsx:356` 到 `frontend/src/components/InstanceTopology.tsx:367` 仍渲染底部计数条；`frontend/src/components/InstanceTopology.test.tsx:301` 到 `frontend/src/components/InstanceTopology.test.tsx:330` 还专门断言 `2 实例 / 1 agents / 1 skills / 1 ACPs` 必须出现。
- 影响：这会把 graph-only 页面重新拉回“图 + 摘要”的混合信息架构，而且测试会阻止后续按计划删掉这块 UI。
- 建议：移除 footer summary，把 topology 测试改成只验证画布、控件和 canonical drill-down；如果团队决定保留此条，必须先回写计划/架构文档，不应在实现层偷偷放宽。

### 4. Medium — kanban 分栏逻辑没有纳入 failed diagnostics / watchlist，优先级会分错列
- 证据：计划冻结的看板语义要求 `需关注 = error / failed diagnostics / watchlist`，见 `.sisyphus/plans/ui-design-realignment-work-plan.md:259`。但 `frontend/src/components/CollabPage.tsx:54` 到 `frontend/src/components/CollabPage.tsx:58` 的 `getAgentColumn` 只看 `agent.status` 与 `agent.is_active`；失败诊断直到 `frontend/src/components/CollabPage.tsx:101` 到 `frontend/src/components/CollabPage.tsx:112` 才被计算，且只在 `frontend/src/components/CollabPage.tsx:207` 到 `frontend/src/components/CollabPage.tsx:208` 作为卡片装饰态传入。`frontend/src/components/CollabPage.test.tsx:179` 的失败诊断用例也只覆盖了 `agent.status === "error"` 的情形，没有验证“状态仍是 running/idle，但实例诊断已 failed”的混合场景。
- 影响：实例已经 failed 的 agent 仍可能被放进 `进行中` 或 `待巡视`，直接削弱 observer 看板最重要的优先级排序能力。
- 建议：把 failed diagnostics / watchlist 判定前移到分栏逻辑；补一个 `running + failed diagnostic` 的测试，确保该卡片必须进入 `需关注`。

### 5. Low — e2e 对 session minimal shell 只做正向存在断言，缺少禁止结构回流的浏览器级门禁
- 证据：计划要求浏览器验收显式校验 session 不再出现 sidebar / tabs / status-panel，见 `.sisyphus/plans/ui-design-realignment-work-plan.md:322`。但 `frontend/e2e/v0.6-overview-topology-session.spec.ts:154`、`frontend/e2e/v0.6-overview-topology-session.spec.ts:155`、`frontend/e2e/v0.6-overview-topology-session.spec.ts:176`、`frontend/e2e/v0.6-overview-topology-session.spec.ts:177`、`frontend/e2e/v0.6-overview-topology-session.spec.ts:189`、`frontend/e2e/v0.6-overview-topology-session.spec.ts:190` 只检查 `session-stream-shell` / `session-input-shell` 可见；对该 spec 搜索 `sidebar|tabs|status-panel|status panel` 为 0 命中。
- 影响：一旦 session 页重新混入被禁结构，只要主壳层 testid 还在，e2e 仍会通过，无法承担最终收口门禁。
- 建议：为 session 场景补充浏览器级负断言，至少覆盖 no tabs / no sidebar / no status-panel selectors。

## 正向结论
- `overview` 的去 dashboard 化约束目前比较稳：`frontend/src/components/OverviewPage.test.tsx:181` 与 `frontend/e2e/v0.6-overview-topology-session.spec.ts:140` 已显式防止旧的 `全部 agents` / `活跃中` / `值得巡视` 回流。
- `kanban` 没有拖拽/写回语义回流：对 `frontend/src/components/CollabPage.tsx` 和 `frontend/src/components/CollabPage.test.tsx` 搜索 `draggable|onTaskMove|review bucket|approval|写回|拖拽` 为 0 命中。
- session 组件级只读边界仍然在：`frontend/src/components/AgentWorkspace.readonly.test.tsx:77`、`frontend/src/components/AgentWorkspace.readonly.test.tsx:102`、`frontend/src/components/SessionPage.test.tsx:235` 继续约束了无 destructive controls、无 tabs、无旧 sidebar。

## 验证证据

### 命令输出摘要
```bash
npm --prefix frontend run test -- src/components/OverviewPage.test.tsx src/components/InstanceTopology.test.tsx src/components/CollabPage.test.tsx src/components/SessionPage.test.tsx
```
- 结果：通过。
- 摘要：4 个测试文件、46 个测试全部通过，0 failed。

```bash
npm --prefix frontend run test -- src/components/AgentWorkspace.readonly.test.tsx src/components/SessionActions.readonly.test.tsx
```
- 结果：通过。
- 摘要：2 个测试文件、4 个测试全部通过，0 failed。

```bash
npm --prefix frontend run build
```
- 结果：通过。
- 摘要：`tsc --noEmit && vite build` 成功，产物输出到 `frontend/dist`，主 JS 包约 `458.50 kB`，gzip 后约 `147.23 kB`。

```bash
make quality
```
- 结果：通过。
- 摘要：后端 `pytest` 为 `131 passed, 2 skipped`；`basedpyright` 为 `0 errors, 0 warnings, 0 notes`；前端 build 再次通过。

### 结构检索摘要
- `overview` 旧 dashboard 词汇搜索：仅命中 `frontend/src/components/OverviewPage.test.tsx` 与 `frontend/e2e/v0.6-overview-topology-session.spec.ts` 中的负断言，没有命中运行时代码。
- `kanban` 拖拽/写回语义搜索：`frontend/src/components/CollabPage.tsx` 与 `frontend/src/components/CollabPage.test.tsx` 为 0 命中。
- `topology.edges` 搜索：`frontend/src/components/InstanceTopology.tsx` 为 0 命中，证明服务端 `edges` 当前未被消费。
- `session` e2e 禁止结构搜索：`frontend/e2e/v0.6-overview-topology-session.spec.ts` 只命中 `session-stream-shell` / `session-input-shell` 正断言，未命中 `sidebar|tabs|status-panel` 负断言。

### LSP Diagnostics
- `frontend/src/components/OverviewPage.tsx`：clean
- `frontend/src/components/InstanceTopology.tsx`：clean
- `frontend/src/components/CollabPage.tsx`：clean
- `frontend/src/components/SessionPage.tsx`：clean
- `frontend/src/components/AgentWorkspace.tsx`：clean
- `frontend/e2e/v0.6-overview-topology-session.spec.ts`：clean
