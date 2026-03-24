# Linpo v0.6 IA Architecture

> **状态**：当前有效架构边界文档
> 
> **前置产品约束**：`docs/prd/2026-03-24-linpo-v0.6-observer-prd.md`

## 1. 文档目的

本文件用于冻结 Linpo v0.6 的当前架构边界，明确新 5 页 IA 的页面职责、视图边界，以及支撑产品成立所需的最小状态 / 事件模型。

本文档不冻结具体技术栈实现细节，也不提前引入 v0.2+ 的扩张能力。

---

## 2. 架构角色边界

Linpo 当前阶段的系统角色是：**多实例工作与协作入口**。

这意味着 Linpo 在当前版本中：

- 围绕 `overview / topology / kanban / team / session` 五页 IA 组织用户主路径
- 既要承担总体态势与结构可见性，也要承担任务板、团队入口与会话工作区承接
- 不把 `settings / profile` 纳入当前有效范围
- 不把未冻结的第六个主页面、额外平台化控制面或长期规划能力混入当前执行

当前阶段只承认一件事：

> 把当前 active UI 基线整体替换为与新 5 页 IA 一致的页面职责、路由语义、验证门禁与可审计留痕。

---

## 3. 信息架构

### 3.1 当前 5 页结构（当前 v0.6 冻结）

用户登录后首先进入 **`/overview` 主页**。

Linpo 当前采用 **overview → topology / kanban / team → session** 的产品结构：

冻结术语：**overview = 主页，topology = routing graph 画布，kanban = 任务板，team = persistent agent cards 主舞台，session = 会话工作区**。

| 页面 | 路由 | 职责 |
|------|------|------|
| **Overview** | `/overview` | 默认 landing / 主页；顶部统计 + 实例 token 曲线 + 右侧全局事件列表 |
| **Topology** | `/topology` | 满屏 routing graph 画布；泳道固定为实例 / 智能体 / 会话 / 工具 |
| **Kanban** | `/kanban` | 任务板；每卡一个任务，能力锚点为 `openclaw/mission-control` |
| **Team** | `/team` | persistent agent cards 主舞台，对齐 `openclaw/center` 的 `Staff` 页面 |
| **Session** | `/session/:agentId/:channelKey/:sessionKey` | 会话工作区 canonical 路由；从 agent 进入，侧栏“渠道在上，会话在下” |

**关键约束：**

- **首页汇报感硬红线**：overview 禁止额外 prompt 注入，仅基于现有状态/事件/活跃度与真实读链路生成展示
- **聚合契约字段冻结**：overview / topology / kanban / team / session 共享的聚合语义必须显式包含 `request_id`、`freshness`、`partial_failure` / `diagnostics`
- **freshness 语义冻结**：`freshness` 至少表达状态与时间戳，状态词汇固定为 `fresh` / `stale` / `failed`
- **session canonical 冻结**：`/session/:agentId/:channelKey/:sessionKey` 为当前唯一 canonical session 路由；空工作区 canonical 路由固定为 `/session/:agentId/__none__/__new__`，空会话 canonical 路由固定为 `/session/:agentId/:channelKey/__new__`
- **team 冻结**：`team` 是当前有效第三页，不得缺失、降级或附录化
- **范围排除项**：当前不纳入 `settings / profile`，也不引入第六个有效主页面

### 3.2 主对象

当前主对象不再是单一 agent 首页视角，而是按页面拆分：

- `overview`：总体 token / agent 状态 / 全局事件
- `topology`：实例 / 智能体 / 会话 / 工具 的 routing 关系
- `kanban`：任务
- `team`：persistent agent cards
- `session`：agent 工作区中的 channel / session 上下文

### 3.3 页面职责

| 页面 | 路由 | 职责 |
|------|------|------|
| Overview | `/overview` | 默认入口；展示总体 token / agent 状态、实例 token 曲线与全局事件流 |
| Topology | `/topology` | routing graph 画布，展示实例 / 智能体 / 会话 / 工具 的关系 |
| Kanban | `/kanban` | 任务板，承接任务推进、协作状态与任务级上下文 |
| Team | `/team` | 团队主入口，承接 persistent agent cards 与从团队视角进入 session |
| Session | `/session/:agentId/:channelKey/:sessionKey` | 会话工作区，承接渠道切换、会话切换、消息流与输入发送 |

**五页 UI guardrails：**

- **overview**：主舞台固定为顶部统计 + 实例 token 曲线 + 全局事件侧栏；禁止回退成 `agents-first watchlist` 或 observer-only 首页。
- **topology**：主舞台固定为四泳道满屏 routing graph；禁止回退成旧 graph-only observer 画布或以侧栏/面板挤占主舞台。
- **kanban**：主舞台固定为任务板；禁止继续按“只读信号板”定义当前页面。
- **team**：主舞台固定为 persistent agent cards；禁止被降级为附录、future work 或可选页。
- **session**：主舞台固定为 agent header + 渠道区 + 会话区 + 当前会话区 + 输入/发送区；禁止回退到旧的单列极简 drill-down。

### 3.4 验收与收口约束

- 每个 major feature 完成后都必须先部署，再从 `ravin` 发起 Playwright 集成验证，覆盖改动功能与强相关链路
- 后端新增或修改的核心逻辑必须补齐完整单元测试覆盖，不能只靠浏览器联调兜底
- 全部任务完成后，必须逐条核对实现成果与 active plan / PRD / architecture 的一致性，不一致继续补齐后再收口

---

## 4. 核心视图：Topology Routing Graph

### 4.1 目标

`topology` 的目标是帮助用户直接看清：

- 实例、智能体、会话、工具这四类对象如何在 routing graph 中组织
- 当前结构是否完整
- 哪些对象可进入 session 工作区、哪些对象只能停留在结构浏览层
- 节点当前是否活跃以及基础状态如何

### 4.2 当前展示原则

当前版本采用 **四泳道满屏 routing graph 默认展示**。

当前版本不做：

- 回退到旧 `graph-only observer` 语义
- 详情侧栏 / 配置面板挤占主舞台
- 把旧 `skill / ACP` 继续定义成一等泳道对象

拓扑图在当前阶段首先是一张 routing graph，而不是旧 observer 结构示意页。

---

## 5. 节点设计

### 5.1 节点原则

拓扑中的节点保持清晰与可区分。每个节点至少需要能支持：

- 名称识别
- 状态识别
- 所在泳道识别
- 是否具备进入 session 或其他承接上下文的资格

### 5.2 细节后送原则

`topology` 不通过详情侧栏或配置面板承接更多细节；如需进入 agent 或会话上下文，应走当前 5 页 IA 冻结的 session 进入规则，而不是回退到旧 `/session/:instanceId/:agentId` drill-down。

---

## 6. topology 禁止项

为保持当前 routing graph 边界，`topology` 当前版本明确不承接以下内容：

- 详情侧栏
- 配置面板挤占主舞台
- 独立统计卡或 summary strip 挤占主舞台
- 未冻结的额外对象类型回流为一等泳道

拓扑页的职责是帮助用户看清 routing 关系，而不是回退成旧 observer 画布或扩成额外工作台。

---

## 7. overview 主页

`/overview` 当前采用主页语义，而不是旧 watchlist 首页。

主舞台应优先呈现：

- 顶部 token 统计
- 顶部 agent 状态统计
- 按实例分组的近期 token 消耗曲线
- 右侧全局事件列表

当前版本明确不使用：

- `agents-first watchlist` 作为首页主定义
- 大摘要报告页
- 旧 `observer-only` 首页语义

`overview` 的职责是帮助用户先把握总体态势与最近事件，而不是继续承担旧的 agent 卡片巡视首页。

---

## 8. 最小状态模型

在 v0.6 中，每个可观测节点至少具备以下稳定字段：

- `name`：节点名称
- `status`：当前状态
- `is_active`：当前是否活跃
- `child_count`：子节点数

补充字段用于列表页、轻量提示或 session 承接信息：

- `last_active_started_at`：最近一次开始活跃时间点
- `event_history`：历史事件记录

当前状态字段不承担复杂告警语义。异常如需体现，应先作为事件的一部分被记录，而不是在首页 / 拓扑层成为一等产品对象。

---

## 9. 最小事件模型

v0.6 需要一套支持拓扑状态理解与 session 承接的最小事件模型。

### 9.1 结构 / 状态事件

- `agent_created`
- `subagent_created`
- `activity_started`
- `activity_stopped`
- `status_changed`
- `node_finished`

### 9.2 最小任务边界事件

- `task_started`
- `task_finished`
- `task_interrupted`

该模型的用途不是把 Linpo 做成任务系统，而是帮助用户回答：

- 这个节点何时开始工作
- 这个节点何时结束工作
- 一段活跃期对应了哪些最小工作边界
- 在此期间发生了哪些结构或状态变化

---

## 10. 后端分层架构（当前冻结）

在不改变当前 5 页 IA、聚合字段契约与 session canonical 路由的前提下，后端采用以下分层：

1. **API Layer**
   - 职责：HTTP 路由、鉴权入口、请求校验、响应封装
   - 不承接：供应商协议细节、跨 provider 业务编排

2. **Application Layer**
   - 职责：用例编排（聚合读链路、会话控制链路、任务板与团队入口相关用例）
   - 输出：统一调用 Domain Contract，不直接拼接 provider 特有报文

3. **Domain Contract Layer**
   - 职责：系统唯一 canonical 契约（请求/响应/错误/能力）
   - 强约束：`request_id`、`freshness`、`partial_failure`、`diagnostics` 为强制语义字段；`freshness` 词汇冻结为 `fresh` / `stale` / `failed`

4. **Provider Adapter Layer**
   - 职责：OpenClaw、其他 Claw 与未来工具生态的协议适配
   - 规则：所有外部协议差异只能在 Adapter 层处理，不向上泄漏

5. **Infra Layer**
   - 职责：WS/HTTP 客户端、重试、超时、限流、熔断、配置、观测
   - 规则：基础设施策略可替换，但不得改变 Domain Contract 语义

6. **Persistence Layer**
   - 职责：实例配置、会话状态、映射关系、审计留痕持久化
   - 规则：持久化实现可演进，但对上暴露稳定仓储接口

该分层用于支撑“多 provider + 多工具”扩展，不作为新增页面或产品边界扩张依据。

---

## 11. Breakly 迁移策略（当前冻结）

本阶段后端迁移采用 **breakly（一次性切换）** 策略：

- 不保留新旧协议并行运行路径
- 不保留兼容分支、兼容开关、兼容补丁胶水
- 不允许遗留死代码、废弃分支、不可达调用链

### 11.1 切换原则

- 先冻结 canonical 契约，再切换 provider adapter 实现
- 切换后调用链必须唯一：`API -> Application -> Domain Contract -> Provider Adapter -> Infra/Persistence`
- 旧调用入口在同一迁移窗口内删除，不做长期双写/双读

### 11.2 清理原则

迁移完成后必须完成以下清理：

- 删除旧版 OpenClaw 直连 client 的上层直接依赖
- 删除旧协议字段分支与历史兜底逻辑
- 删除无法被现网调用的函数、类型、配置与测试桩
- 删除“临时过渡”注释与 TODO（若不再有执行价值）

### 11.3 风险控制

breakly 不等于无门禁。必须通过以下门禁后方可收口：

- 关键链路测试通过（聚合读链路 + session 控制链路）
- 已部署环境联调通过（按当前 plan 的 Playwright 验收口径）
- 与 PRD/architecture/active plan 的契约一致性核对通过

---

## 12. 文档与实现约束

当前架构冻结的是边界与最小模型，并在本版本额外冻结后端分层与 breakly 迁移纪律。

即便内部重构，以下契约不得破坏：

- 5 页 IA 页面职责与 guardrails
- session canonical 路由与空态 canonical 变体
- 聚合字段语义：`request_id`、`freshness`、`partial_failure` / `diagnostics`
- `freshness` 词汇：`fresh` / `stale` / `failed`

允许演进项：

- provider 实现数量与类型（不止 OpenClaw）
- infra 与 persistence 的具体实现细节
- 在不破坏 canonical 契约前提下的内部模块重组

---

## 13. 附录：长远规划

> `v0.6` 之后的长期架构方向统一收纳在 `docs/plans/`，不在当前架构文档中展开，也不参与当前阶段执行选路。

---

## 14. 与其他文档的关系

- 产品目标、范围与不做项：见 `docs/prd/2026-03-24-linpo-v0.6-observer-prd.md`
- 当前阶段唯一计划：见 `.sisyphus/plans/ui-design-realignment-work-plan.md`
- `docs/plans/` 仅存放长远规划，不作为当前阶段 active 执行入口

