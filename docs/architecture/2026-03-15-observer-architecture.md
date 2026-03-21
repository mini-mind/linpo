# Linpo v0.1 Observer Architecture

> **状态**：当前有效架构边界文档
> 
> **前置产品约束**：`docs/prd/2026-03-15-linpo-v0.1-observer-prd.md`

## 1. 文档目的

本文档用于冻结 Linpo v0.1 的最小架构边界，明确 observer 角色、页面职责、视图边界，以及支撑产品成立所需的最小状态 / 事件模型。

本文档不冻结具体技术栈实现细节，也不提前引入 v0.2+ 的扩张能力。

---

## 2. 架构角色边界

Linpo v0.1 的系统角色是 **Observer**。

这意味着 Linpo 在当前版本中：

- 不负责启动 agent
- 不负责暂停 / 恢复 / 重试
- 不负责编排 subagents
- 不负责调度任务优先级
- 不负责统一 runtime 生命周期控制

Linpo v0.1 只承担一件事：

> 把 agent 与其 subagents 的结构和状态变成可见、可浏览、可回看的对象。

因此，当前架构必须围绕“结构可见性”和“状态可理解性”展开，而不是围绕执行控制面展开。

当前 v0.6 也明确排除模板系统、工作流平台化与控制面扩张，所有新增页面与契约都必须服务于观测入口本身。

---

## 3. 信息架构

### 3.1 四层结构（当前 v0.6 冻结）

用户登录后首先进入 **`/overview` 总览页**。

Linpo 当前采用 **overview → topology / kanban → session** 的产品结构：

冻结术语：**overview = 总览层主舞台，topology = workbench，kanban = 聚合工作信号视图，session = drill-down**。

| 层级 | 路由 | 职责 |
|------|------|------|
| **总览层** | `/overview` | 默认 landing，全局脉搏主舞台，展示用户全部 agents |
| **工作台层** | `/topology` | `workbench`，承接结构/配置工作台与固定动作环，展示实例 / agents / skills / ACP 关系并提供配置入口 |
| **看板层** | `/kanban` | 聚合工作项、协作状态与关键工作信号 |
| **接管层** | `/session/:instanceId/:agentId` | drill-down 页，显式身份参数 |

**关键约束：**

- **首页汇报感硬红线**：首页汇报感禁止额外 prompt 注入，仅基于现有状态/事件/活跃度归纳生成，禁止向 agent 静默发送额外 prompt
- **overview 对象**：`overview` 以用户全部 agents 为默认概览对象，承担概览 / 巡视入口
- **动作环首期范围**：仅承载 `查看 / 进入 / 配置 / 关系`，同屏仅单开；不支持 drill-down 的节点禁用“进入”
- **禁止 destructive/runtime controls**：首期 topology 与 session 主路径不暴露 pause/reset/send/delete 等 destructive/runtime controls
- **路由真源**：`/session/:instanceId/:agentId` 的 URL 参数为唯一真源；`/session` 与 `/session/:instanceId` 仅作为兼容重定向入口，不承载长期状态
- **消息历史展示**：普通消息支持 Markdown 渲染；工具调用统一折叠为摘要说明气泡，不直接暴露原始 JSON
- **统一对话入口**：`overview`、`topology`、`kanban` 三页都必须提供进入 agent 对话的入口，并统一跳转到 `/session/:instanceId/:agentId`
- **范围排除项**：不引入模板系统、工作流平台化或控制面扩张

### 3.2 主对象

当前主对象是 **用户拥有的实例下的 agent 聚合视角**。

原因是：

- 当前产品切入口已从单 agent 列表提升到多实例聚合观察
- `overview` 负责跨实例的聚合观察入口，并展示用户全部 agents
- `topology` 负责实例 / agents / skills / ACP 关系与配置工作台
- `kanban` 负责聚合工作信号，而不是单纯任务系统
- `session` 是 drill-down 承接页，不是首页主对象

### 3.3 页面职责

| 页面 | 路由 | 职责 |
|------|------|------|
| 总览页 | `/overview` | 全局脉搏主舞台，展示用户全部 agents，回答“谁在干活、哪里值得巡视”；首页汇报感禁止额外 prompt 注入 |
| 拓扑工作台 | `/topology` | `workbench`，展示实例 / agents / skills / ACP 关系，提供固定动作环与配置入口 |
| 看板页 | `/kanban` | 聚合工作项、协作状态与关键工作信号，不扩张成审批/治理平台 |
| 会话接管页 | `/session/:instanceId/:agentId` | `drill-down` 页，从 overview / topology / kanban 的进入动作跳转；URL 参数为真源 |

### 3.4 验收与收口约束

- 每个 major feature 完成后都必须先部署，再从 `ravin` 发起 Playwright 集成验证，覆盖改动功能与强相关链路
- 后端新增或修改的核心逻辑必须补齐完整单元测试覆盖，不能只靠浏览器联调兜底
- 全部任务完成后，必须逐条核对实现成果与 active plan / PRD / architecture 的一致性，不一致继续补齐后再收口

---

## 4. 核心视图：拓扑图

### 4.1 目标

拓扑图的目标是帮助用户直接看清：

- 根 agent 与 subagents 的层级关系
- 当前结构是否完整
- 哪些节点存在、彼此如何连接
- 节点当前是否活跃以及基础状态如何

### 4.2 v0.1 展示原则

v0.1 采用 **完整拓扑默认展示**。

当前版本不做：

- 当前活跃路径高亮
- 最近变化节点高亮
- 自动聚焦逻辑
- 智能推荐或自动摘要

原因是 v0.1 首先要证明“结构外显”本身成立，而不是过早把系统做成解释层或诊断层。

拓扑图在 v0.1 中首先是一张结构图，而不是决策图、资源图或运维图。

---

## 5. 节点设计

### 5.1 极简节点原则

拓扑图中的节点应保持极简。每个节点只展示：

- 名称
- 状态
- 是否活跃
- 子节点数

不在节点本体中直接堆叠以下信息：

- 当前任务摘要
- token 消耗
- 错误分类
- 资源占用
- 最近事件
- 运行时配置

### 5.2 详情后置原则

节点本体只承担结构识别与最小状态表达。更多细节由点击节点后的详情面板承接。

这一原则可概括为：

> 结构优先，细节后置。

---

## 6. 节点详情面板

点击任一节点后，系统应展示一个侧边详情面板。

v0.1 中该面板仅展示最少必要状态信息：

- 最近开始活跃的时间点
- 当前是否活跃
- 历史事件记录

当前版本明确不加入：

- 任务详情卡片
- 资源面板
- 控制按钮
- 决策摘要
- 异常分类与告警面板

详情面板的职责是帮助用户理解状态，而不是承担完整控制台职责。

---

## 7. 首页列表页

Agents 列表页采用 **纯列表** 形式。

每个 agent 一行，仅展示：

- 名称
- 当前状态
- 是否活跃
- 最近活跃时间

当前版本不使用：

- 卡片网格作为默认布局
- 复杂仪表盘
- 基于异常的显式优先分组

列表页只作为“发现与进入”的入口，不承担更高阶监控语义。

---

## 8. 最小状态模型

在 v0.1 中，每个可观测节点至少具备以下稳定字段：

- `name`：节点名称
- `status`：当前状态
- `is_active`：当前是否活跃
- `child_count`：子节点数

补充字段用于详情面板或列表页：

- `last_active_started_at`：最近一次开始活跃时间点
- `event_history`：历史事件记录

当前状态字段不承担复杂告警语义。异常如需体现，应先作为事件的一部分被记录，而不是在首页 / 拓扑层成为一等产品对象。

---

## 9. 最小事件模型

v0.1 需要一套支持节点详情面板的最小事件模型。

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

## 10. 文档与实现约束

当前架构冻结的是边界与最小模型，不冻结以下内容：

- 接入协议
- 持久化实现细节
- 前端框架细节
- 后端技术栈细节
- 部署拓扑细节

这些内容应在后续实施计划中按阶段逐步冻结，但不得突破本文档的 observer 边界。

---

## 11. 架构演进路径

> **状态**：2026-03-16 重新定义的架构演进规划
>
> **说明**：本节描述从 v0.1 observer 到 v1.0 多实例协作平台的架构扩展路径，供后续版本架构文档参考。

### 11.1 v0.3：控制能力引入

当引入控制能力时，架构需要以下扩展：

**协议层扩展：**

| 扩展项 | 说明 |
|--------|------|
| `role` 参数 | 从隐式 observer 改为显式 `operator` |
| `scopes` 声明 | 声明 `operator.read` + `operator.write` |
| 设备身份 | 实现 `device` 参数（id, publicKey, signature） |

**新增请求类型：**

```
agent.start    — 启动 agent
agent.pause    — 暂停 agent
agent.resume   — 恢复 agent
agent.send     — 发送消息
sessions_spawn — 创建 subagent
```

**新增事件订阅：**

```
tick    — 心跳
agent   — agent 状态变化
chat    — 聊天消息流
```

### 11.2 v0.4：单实例控制完善（已完成）

> **完成日期**：2026-03-18
> **提交**：`50a4dd6`

**已落地：**

| 能力 | 后端 API | 前端组件 |
|------|----------|----------|
| 会话列表 | `GET /chat/sessions` | `SessionList.tsx` |
| 消息预览 | `GET /chat/sessions/preview` | `AgentWorkspace.tsx` |
| 模型切换 | `GET /chat/models` + `PATCH /chat/sessions/{key}` | `ModelSelector.tsx` |
| 会话重置 | `POST /chat/sessions/{key}/reset` | `SessionActions.tsx` |
| 会话删除 | `DELETE /chat/sessions/{key}` | `SessionActions.tsx` |
| 发送消息 | `POST /agents/{agent_id}/send-message` | `AgentWorkspace.tsx` |
| 暂停控制 | `POST /agents/{agent_id}/pause` | `SessionActions.tsx` |

**控制状态流转：**
```
sending → accepted → applied
    ↓         ↓        ↓
  failed   failed   failed
    ↓         ↓
  timeout  timeout
```

**未落地（OpenClaw 不支持）：**

- `start`/`resume` 控制动作
- `agents.list`/`bindings` 管理

**不变项：**

- 仍为单实例，不引入用户模型
- 为 v0.5 用户模型预留扩展点

### 11.3 v0.5：用户模型 + 实例配置基础

> **状态**：已完成
>
> **完成日期**：2026-03-18
> **说明**：该阶段能力已并入当前 README / PRD / active `.sisyphus` plan 的 v0.6 基线，不再单独依赖旧 v0.5 plan 文件。

**已落地设计约束：**

| 约束项 | 决策 |
|--------|------|
| 登录方式 | 用户名 + 密码 |
| 数据库存储 | PostgreSQL |
| 实例保存前验证 | 必须验证 endpoint 可连通性与 token 可用性 |
| 实例上限 | 每个用户最多 3 个实例 |
| Token 存储 | Gateway Token 后端加密存储 |
| 实例类型 | 首期只支持 `openclaw` |

**数据模型：**

```
User {
  id: UUID
  username: string(64)      // 唯一
  password_hash: text       // bcrypt 哈希
  created_at: timestamp
}

Instance {
  id: UUID
  user_id: UUID             // 外键关联 User
  name: string(100)
  type: string(32)          // 首期仅 "openclaw"
  endpoint: text            // OpenClaw gateway 地址
  gateway_token_enc: text   // 加密存储的 token
  status: string(32)        // "active" | "inactive"
  last_check_at: timestamp  // 最后验证时间
  created_at: timestamp
}

AuthSession {
  session_id: string        // 服务端 session cookie
  user_id: UUID
  created_at: timestamp
}
```

**UI 设计约束：**

- 侧边栏底部账户区域只展示用户入口，不展示实例信息
- 拓扑页保持全局拓扑视野，实例以节点形式展示，详情通过弹窗展示
- 空状态引导用户新增第一个实例

**非目标范围：**

- 不引入 OAuth、RBAC、软删除、找回密码、多组织/团队模型

**架构变更：**

- 后端新增 `/auth` 与 `/instances` 两组 API
- PostgreSQL 持久化用户与实例配置
- 服务端 session cookie 维持登录态
- 为 v0.6 多实例聚合做准备

### 11.4 v0.6：多实例聚合视图 ← 核心差异化

**架构扩展：**

```
┌─────────────────────────────────────────────────────────────┐
│                       Linpo Platform                         │
├─────────────────────────────────────────────────────────────┤
│  Instance Registry   │  Health Monitor   │  Agent Aggregator │
│  (实例注册管理)       │  (健康检测)        │  (聚合 agents.list)│
├─────────────────────────────────────────────────────────────┤
│                    Instance Adapter Layer                     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐          │
│  │ OpenClaw    │  │ KimiClaw    │  │ AutoClaw    │  ...     │
│  │ Adapter     │  │ Adapter     │  │ Adapter     │          │
│  └─────────────┘  └─────────────┘  └─────────────┘          │
└─────────────────────────────────────────────────────────────┘
         │                   │                   │
         ▼                   ▼                   ▼
   ┌───────────┐       ┌───────────┐       ┌───────────┐
   │ OpenClaw  │       │ KimiClaw  │       │ AutoClaw  │
   │ Instance  │       │ Instance  │       │ Instance  │
   └───────────┘       └───────────┘       └───────────┘
```

**适配器抽象层：**

```
interface InstanceAdapter {
  type: string                    // "openclaw" | "kimiclaw" | ...
  connect(): Promise<void>        // 建立 WebSocket 连接
  disconnect(): Promise<void>     // 断开连接
  getAgents(): Promise<Agent[]>   // 获取 agent 列表
  getHealth(): Promise<Health>    // 健康检测
  sendMessage(msg): Promise<void> // 发送消息
}
```

**Linpo 需实现：**

| 功能 | 说明 |
|------|------|
| 适配器抽象层 | 统一接口，首期只实现 OpenClaw Adapter |
| 实例注册管理 | 用户配置的实例列表 |
| 健康检测 | 定期 ping 实例，展示状态 |
| Agent 聚合 | 多实例 agents.list 合并为统一列表 |
| 跨实例拓扑视图 | 单视图展示多个实例的 agents |

### 11.5 v0.7：跨实例消息传递 ← 核心差异化

**架构扩展：**

```
┌─────────────────────────────────────────────────────────────┐
│                       Linpo Platform                         │
├─────────────────────────────────────────────────────────────┤
│                   Message Router Layer                       │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  Route Table:                                        │    │
│  │  (instance_id, agent_id) → WebSocket Connection      │    │
│  └─────────────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  Message Queue:                                      │    │
│  │  离线消息缓存、重试、状态追踪                          │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

**消息路由逻辑：**

```
用户发送消息 → Linpo Message Router
                    │
                    ├── 查询目标 (instance_id, agent_id)
                    ├── 获取对应实例的 WebSocket 连接
                    ├── 转发消息（复用 agentToAgent 协议）
                    └── 返回状态（发送/接收/失败）
```

**Linpo 需实现：**

| 功能 | 说明 |
|------|------|
| 跨实例消息路由 | Linpo 作为路由层，不重新实现编排引擎 |
| 消息发送 UI | 指定目标实例 + agent |
| 消息流可视化 | 拓扑图上的边动态高亮 |
| 消息状态追踪 | 发送/接收/失败状态 |

**私有实例边界：**

用户只能在自己的实例间传递消息，不涉及跨用户协作。

### 11.6 v0.8：文件系统视图 + 文件传递

**实现方式：**

Linpo 封装 OpenClaw 工具为文件浏览器 UI：

```
Linpo UI ──HTTP/WebSocket──▶ Linpo Backend ──WebSocket──▶ OpenClaw Gateway
                                   │
                                   ├── 调用 read 工具获取文件内容
                                   ├── 调用 exec (ls, tree) 获取目录结构
                                   ├── 映射到文件树 UI 组件
                                   └── 跨实例文件传递
```

**功能范围：**

| 功能 | 说明 |
|------|------|
| 文件浏览器 | 目录树 + 文件预览 |
| 配置编辑 | Agent 配置文件读写 |
| 工作目录可视化 | Agent 工作目录展示 |
| 跨实例文件传递 | Agent 间共享文件（需适配器支持） |

**注意：** OpenClaw 无独立文件系统 API，需通过工具调用实现。

### 11.7 v0.9：安全加固 + 审计

**安全措施：**

| 措施 | 说明 |
|------|------|
| 安全审计日志 | 记录所有控制操作和消息传递 |
| 操作记录追溯 | 用户行为可追溯 |
| 实例连接安全验证 | endpoint 可达性、证书验证 |
| 漏洞修复 | 依赖扫描 + 安全测试 |

### 11.8 v1.0：内测 + 修复

**内测阶段：**

- 内测用户反馈收集与处理
- 稳定性修复
- 性能优化
- 为公开发布做准备

### 11.9 v1.1：公开发布

---

## 12. 与其他文档的关系

- 产品目标、范围与不做项：见 `docs/prd/2026-03-15-linpo-v0.1-observer-prd.md`
- 第一阶段实施拆解：见 `docs/plans/2026-03-15-linpo-v0.1-observer-implementation-plan.md`
- 设计共识来源记录：见 `docs/plans/2026-03-15-linpo-v0.1-observer-design.md`
