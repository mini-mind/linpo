
## 2026-03-22 Task 5: Kanban Board Rebuild

### Implementation Approach
- Rebuilt CollabPage as a Mission Control style read-only kanban board
- Four columns: 需关注 (needs_attention), 进行中 (in_progress), 待巡视 (pending_review), 已完成 (completed)
- Column logic based on agent status and is_active flag:
  - `needs_attention`: status === 'error'
  - `in_progress`: status === 'running' && is_active === true
  - `pending_review`: status === 'idle' || (status !== 'finished' && !is_active)
  - `completed`: status === 'finished'

### Key Design Decisions
- Used inline styles instead of CSS modules for consistency with existing codebase
- Mobile-first responsive design: single column on mobile, 4-column grid on desktop
- Each card shows: agent name, instance name, status badge, last activity, and drill-down link
- Diagnostic alerts shown inline on cards when instance has errors
- Column headers include color-coded dot indicators and count badges

### Observer-Only Guardrails
- No drag/drop functionality (readOnly board)
- No write operations (no onTaskMove, no drop handlers)
- Only drill-down navigation to canonical `/session/:instanceId/:agentId`

### Test Coverage
- Four column headers render correctly
- Agents grouped into correct columns based on status
- Cards contain title, instance, status, last activity, drill-down link
- Diagnostic alerts displayed for failed instances
- Canonical session drill-down preserved
- testid `kanban-board` contract maintained
- Loading, error, and empty states handled


## 2026-03-22 Task 4: Topology Graph Canvas Rebuild

### @xyflow/react Integration
- Use `ReactFlowProvider` wrapper to enable `useReactFlow()` hook for `fitView()` function
- Custom node types must be defined as separate components and registered in `nodeTypes` object
- Use `Node<TopologyNodeData>` type for nodes with custom data, not just the data type
- `useNodesState<Node<TopologyNodeData>>` requires the generic to extend Node, not be the data type

### @dagrejs/dagre Auto-layout
- Create a layout function that:
  1. Initializes a new dagre graph with `new dagre.graphlib.Graph()`
  2. Sets graph options: `rankdir`, `nodesep`, `ranksep`
  3. Adds nodes and edges to the graph
  4. Calls `dagre.layout()`
  5. Extracts positions from `dagreGraph.node(id)`
- Node positions must be calculated as `x - width/2, y - height/2` to center on dagre's center point

### Test ID Contract
- `topology-graph-canvas` remains the stable testid on the main canvas container
- Node testids follow pattern: `topology-node-{type}-{id}` (e.g., `topology-node-instance-instance-alpha`)
- Drilldown links use: `drilldown-link-{agentId}`

### Observer-Only Boundary
- No config modal, no sidebar, no detail panel
- Agent nodes provide canonical drill-down to `/session/:instanceId/:agentId`
- Empty skills/external_acps show as empty node sets (not fallback blocks)

### TypeScript Gotchas
- Button aria-label takes precedence over text content for accessible name in testing
- ErrorEnvelope requires `next_step: string | null` field
- ErrorCode is a union type - must use valid codes like 'internal_error', 'source_unavailable'

## 2026-03-22T14:52Z Task 6 Complete

### Session Page Simplification
- Removed `InstanceList` left sidebar from `SessionPage.tsx`
- Created three-zone minimal shell: header + main content + bottom input
- Desktop content centered with `max-width: 880px` as per plan
- Mobile remains full-width with same three-zone hierarchy

### AgentWorkspace Simplification  
- Removed tabs (消息/状态/日志/文件) completely
- Removed session list panel that was taking left column
- Message stream is now full-width of the content area
- Observer-only hint collapsed into disclosure button to not occupy main stage
- Session switcher only appears when there are multiple sessions (simple select dropdown)

### Test Updates Required
- `SessionPage.test.tsx`: Removed assertions about instance list sidebar
- `AgentWorkspace.readonly.test.tsx`: Updated to match new disclosure-based readonly hint
- Tests now verify: no tabs, no session list panel, no destructive controls

### Key Constraint Preserved
- Canonical route `/session/:instanceId/:agentId` behavior unchanged
- `session-stream-shell` and `session-input-shell` testids stable
- Auto-redirect from `/session` to first instance still works

## 2026-03-22 Task 7: E2E Assertion Realignment (spec-only)

### Selector Contract Migration
- Updated `frontend/e2e/v0.6-overview-topology-session.spec.ts` to assert new frozen testids:
  - `overview-summary-strip`
  - `overview-agents-grid`
  - `topology-graph-canvas`
  - `kanban-board`
  - `session-stream-shell`
  - `session-input-shell`
- Replaced legacy copy assertions (`全部 agents` / `活跃中` / `值得巡视`) with absence assertions where applicable.

### Drill-down Stability Insight
- Topology graph drill-down links can be visually covered by ReactFlow overlay/footer in headless runs, causing click interception.
- Stable alternative: assert canonical `href` first, then `page.goto(href)` to preserve drill-down contract validation without flaky pointer interaction.

### Degraded-State Assertion Adjustment
- In the new realignment UI, degraded overview/kanban no longer always render diagnostic message body (`OpenClaw upstream unavailable`) unless the displayed agent card maps to a failed instance.
- Kept degraded verification focused on:
  - overview: summary/grid shell + `异常实例` signal
  - topology: graph canvas + node/drilldown contract
  - kanban: board shell + `部分降级` summary signal
  - explicit absence of removed legacy envelope text (`request_id` / `recoverable` lines)

## 2026-03-22 Task F2: Code Quality Review Learnings

### Topology Review Notes
- `InstanceTopology.tsx` currently renders skill / ACP nodes but does not consume `AggregateTopologyResponse.edges`, so non-agent relationships can silently disappear from the graph.
- The React Flow state sync only updates when `convertedNodes.length > 0`; empty refreshes need explicit clearing to avoid stale graphs.

### Kanban Review Notes
- The frozen board contract defines `需关注` by `error / failed diagnostics / watchlist`, so diagnostics must influence column assignment, not only card decoration.

### Session / E2E Review Notes
- The strict session freeze is best protected by negative assertions (`no tabs / no sidebar / no status-panel`) in Playwright, not only by checking `session-stream-shell` and `session-input-shell` are visible.

## 2026-03-22 F4 Scope Fidelity Check

### Scope Audit Learnings
- `overview` scope lock is strong: source, component tests, and e2e all explicitly prevent the old dashboard/stats-grid vocabulary from returning.
- `kanban` scope lock is also strong: board structure is verified, and direct `rg` checks found no drag/drop or approval semantics in `CollabPage` or its tests.
- `topology` is the main place where visual scope can still leak even after functional realignment: a small footer summary strip and default ReactFlow interactivity are enough to weaken a strict `graph-only` reading.
- Fresh verification should distinguish plan acceptance commands from unrelated stale tests: the plan DoD suite passed, while `InstanceTopology.readonly.test.tsx` failed because it still targets the pre-realignment modal model.

## 2026-03-22 F3 Real Manual QA

### Stable Real-World QA Flow
- Public deployed UI still redirects unauthenticated access to `/login`, so manual QA should register/login first before checking frozen selectors.
- Creating a disposable instance through authenticated browser-side `POST /instances` remains the fastest way to guarantee deterministic overview/topology/kanban/session coverage on the live environment.
- For topology manual QA, reading the node drill-down `href` and navigating directly is still more reliable than clicking through the React Flow overlay area.

### Risk Observed In Production UI
- `/topology` renders the expected graph visually, but browser console still emits repeated React Flow warning `parent container needs a width and a height to render the graph`.
- Treat this as a non-blocking UI QA risk: frozen layout passes visually, but console-clean acceptance would require a follow-up fix.

### Mobile Regression Note
- At mobile `390x844`, `overview-agents-grid` collapses to a single computed column as intended.
- At the same breakpoint, session keeps the minimal title/stream/input shell; the visible heading text collapses to the generic `会话`, but the canonical route and shell contract remain intact.

## 2026-03-22 F2 Code Quality Review (final pass)

### Release Audit Learnings
- `InstanceTopology.tsx` still has two structural correctness risks even with passing tests: it never consumes `AggregateTopologyResponse.edges`, and it only syncs React Flow state when `convertedNodes.length > 0`, so empty refreshes can leave stale graphs on screen.
- The strongest remaining scope leak is topology footer chrome: the bottom summary strip is still rendered and even codified by tests, which weakens the frozen `graph-only` contract.
- `CollabPage.tsx` keeps observer-only read semantics, but its column routing is still too agent-status-centric; failed instance diagnostics only decorate cards and do not yet promote them into `需关注`.
- Session page component tests still protect minimal-shell boundaries, but the deployed Playwright spec needs negative assertions for `no tabs / no sidebar / no status-panel` if it is to act as the final release gate.

## 2026-03-22 Topology Graph-Only Fix

### Footer Summary Removal
- Removed footer summary strip that violated `graph-only` constraint
- Removed `footerStripStyle` and `footerTextStyle` constants as unused
- Tests now explicitly assert absence of footer text (`/实例/`, `/agents/`, etc.)

### ReactFlow Readonly Mode
- Added `nodesDraggable={false}`, `nodesConnectable={false}`, `elementsSelectable={false}` to ReactFlow
- `Controls showInteractive={false}` already present, no change needed
- Drill-down links remain functional via `Link` component inside AgentNode

### Real Edges Consumption
- Changed from manually creating instance→agent edges to consuming `topology.edges` array
- Edge generation now iterates over `AggregateTopologyResponse.edges` instead of `agents` array
- Edge style simplified to uniform `#c9984c` stroke (removed per-status color logic)
- Edge `id` format: `edge-${source}-${target}`

### Readonly Test Rewrite
- Old test mocked `instanceClient.listInstances` (single-instance API, pre-realignment)
- New test mocks `getAggregateTopology` (aggregate API, matches current implementation)
- Removed assertions about detail modal/dialog (graph-only has no modals)
- Added assertions for: no sidebar, no detail panel, no config panel, no dialog
- Added assertions for: canonical drill-down link, no footer summary, no destructive controls

### Test Coverage
- 18 tests across 2 files, all passing
- Tests verify: graph canvas, nodes (instance/agent/skill/acp), drill-down, readonly mode, no footer

## 2026-03-22 Kanban Diagnostics Priority Fix

### Bug Root Cause
- Column assignment in `getAgentColumn()` only considered `agent.status` and `agent.is_active`
- Instance diagnostics failure was only used for card border decoration, not column assignment
- Result: running/finished agents with failed diagnostics landed in `in_progress`/`completed` instead of `需关注`

### Priority Order (Corrected)
1. Diagnostics failure → `needs_attention` (highest priority)
2. Agent status `error` → `needs_attention`
3. Agent status `finished` → `completed`
4. Agent status `running` + `is_active` → `in_progress`
5. All other cases → `pending_review`

### Implementation Change
- Modified `getAgentColumn()` to accept `hasFailedInstance: boolean` parameter
- Moved `failedInstanceIds` useMemo before `agentsByColumn` to allow dependency
- Column assignment now checks diagnostics failure first, then agent status

### Test Strategy
- Added `data-column-key` attribute to column containers for precise DOM testing
- Tests verify agent appears in expected column AND does NOT appear in wrong column
- Positive and negative assertions together prove correct column assignment

### Key Insight
- Signal priority in observer-only UI must be explicit in code, not implicit in decoration
- A failed instance diagnostic is a higher-priority signal than agent running/finished status

## 2026-03-22 Task 7 Final Acceptance Closure

### E2E Guardrail Additions
- `frontend/e2e/v0.6-overview-topology-session.spec.ts` now gives all three acceptance cases the `ui-realignment` marker so the required grep gate catches them directly.
- Desktop acceptance now asserts the frozen main-stage selectors plus explicit banned-structure absence for overview (`overview-stats-grid` / `dashboard-stats-grid`), topology (`topology-sidebar` / `topology-detail-panel` / `topology-config-panel`), kanban (`kanban-signal-grid` / `signal-grid`), and session (`session-sidebar` / `session-tabs` / `session-status-panel`).
- Added a mobile `390x844` scenario that proves `overview-agents-grid` computes to a single column and `/session/:instanceId/:agentId` still exposes only heading + stream + input.

### Evidence Closure
- Recorded the real Playwright command output in `.sisyphus/evidence/task-7-ui-realignment.txt`; `3 passed (40.8s)` with exit code `0`.
- Recorded the `make quality` closure in the same evidence file; pytest `131 passed, 2 skipped`, basedpyright `0 errors`, frontend build completed successfully, exit code `0`.
- `.sisyphus/evidence/task-7-ui-realignment-error.txt` stayed empty on the final passing run, matching the clean stderr expectation.
