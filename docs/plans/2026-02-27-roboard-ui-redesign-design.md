# RoBoard UI Redesign (Industrial Night Ops) Design

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** 在不破坏现有 JS 绑定与接口的前提下，重做任务树页为“工业夜航”视觉，并新增三视图（树/日志/看板）与详情弹窗。

**Architecture:** 前端保持现有 DOM id 与数据结构，新增布局与视图容器，视图切换由前端完成；后端补充事件日志与看板摘要 API（如必要）。

**Tech Stack:** HTML/CSS/JS（静态），FastAPI（可选新增接口），WebSocket 事件流。

---

## 设计方向

**调性**：工业夜航 / 战术蓝。深色基底 + 冷灰面板 + 霓虹蓝/青高亮，微网格背景与轻噪点质感，强调控制室仪表感。

**布局结构**：
- 顶部导航：品牌 + 会话状态 + 连接灯。
- 视图切换：三标签（任务树 / 执行日志 / 任务看板）。
- 主视图：
  - 树视图：层级任务节点（状态点 + 标题 + 时间）。
  - 日志视图：流式事件列表。
  - 看板视图：待执行 / 执行中 / 已完成列。
- 详情弹窗：任务说明 + 状态 + TODO 列表（点开节点或卡片）。
- 底部输入条：快速干预指令。

**保留约束**：
- 必须保留现有 `id` 与 JS 绑定（`#task-tree-root`, `#task-details-section`, `#task-sop-display` 等）。
- 新增三视图容器时保证不破坏现有 DOM（可包裹 / 复用）。

---

## 交互与数据

**术语说明：** 本文 SOP 指 TODO/计划列表，来源为 `plan.md` 并解析为 `plan_subtasks`，对应页面上的 `task-sop-display` 展示区域。当前实现仍保留 SOP 模板（`sops/templates/*.md` + `mission.md` + `/api/agents/{agent_id}/sop`），与计划列表并存。

**视图切换**：
- 前端状态切换（无后端参与），默认树视图。
- 视图切换不触发 API，仅切换容器显示。

**树视图**：
- 数据来源：`/api/runs/{run_id}/tree` + WS `/ws/runs/{run_id}`。

**日志视图**：
- 方案 A（首选）：直接复用 WS `recent_events` 渲染列表。
- 方案 B（补充）：新增 REST `/api/runs/{run_id}/events` 拉取历史日志。

**看板视图**：
- 方案 A（首选）：从树/plan 子任务推导状态列（todo/inProgress/done/blocked）。
- 方案 B（补充）：新增 `/api/runs/{run_id}/kanban` 返回已分组列表。

**详情弹窗**：
- 前端生成；数据来源于树节点与 plan 子任务。

---

## 后端支持（如需）

**事件日志接口**：
- `GET /api/runs/{run_id}/events?limit=200` 返回事件列表（与 WS snapshot 同结构）。

**看板摘要接口**：
- `GET /api/runs/{run_id}/kanban` 返回 `{todo, running, done}`。

**接口删减**：
- 暂不删减既有接口，仅在 UI 侧移除不使用入口；是否删减由后端评估后提交变更。

---

## 验收标准

- 三视图可切换且不影响现有逻辑。
- 任务树与详情面板正常可用（与现有逻辑一致）。
- 日志与看板可显示数据（至少使用现有 WS/树数据）。
- 视觉符合“工业夜航”风格（深色、冷蓝、发光边、细节纹理）。

---

## 实施拆分

### Task 1: 前端 UI 重构
- 修改 `edge-ui/web-frontend/index.html`/`style.css`/`app.js`。
- 增加三视图容器与切换逻辑，保持现有 id 绑定。

### Task 2: 后端支持（可选）
- 新增事件日志与看板接口（如前端无法自洽）。
- 提供测试覆盖（API + 数据格式）。
