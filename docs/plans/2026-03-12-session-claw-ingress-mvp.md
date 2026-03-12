# Session-Scoped Claw Ingress MVP Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为灵盘建立最小可验证的外部 Claw 会话型接入闭环：会话创建、测试 Claw 挂载、点对点消息中转与历史回放。

**Architecture:** 当前实现不把 3 个 OpenClaw 测试实例视为产品组件，而是把它们当作模拟外部用户 Claw 的测试夹具。Linpo 自身只拥有会话、挂载关系、消息中转与回放真相源；所有 Claw-to-Claw 交互都必须经过 Linpo。

**Tech Stack:** 当前阶段以文档优先为准；代码实现前先冻结架构补充文档、测试夹具口径与实施顺序。测试夹具默认使用 3 个 OpenClaw 容器或等价 mock fixture。

---

## 前置文档

在开始任何代码实现前，必须先以以下文档为权威来源：

- `docs/prd/2026-03-12-linpo-v0.1.md`
- `docs/architecture/2026-03-12-initial-architecture.md`
- `docs/architecture/2026-03-12-claw-session-ingress-architecture.md`
- `docs/plans/2026-03-12-phase-1-plan.md`

---

### Task 1: 冻结会话型接入架构补充文档

**Files:**
- Verify: `docs/architecture/2026-03-12-claw-session-ingress-architecture.md`
- Reference: `docs/architecture/2026-03-12-initial-architecture.md`
- Reference: `docs/prd/2026-03-12-linpo-v0.1.md`

**Step 1: 校对架构补充文档与现有 PRD/初始架构是否一致**

检查以下要点是否全部明确：
- 3 个 OpenClaw 仅是 TDD fixture，而非产品运行单元
- 第一版是会话型接入，不是长期注册
- 第一版是点对点中转，不是广播或群聊
- 第一版只要求最小 Message 模型与回放能力

**Step 2: 修正文档中的过度承诺**

若出现以下内容，删除或收紧：
- 长期注册池
- 辩论回合状态机
- 广播 / 群聊
- 结构化总结产出实现细节
- 将测试 Claw 写成产品内建节点

**Step 3: 人工复核文档命名与关联关系**

确认该文档被视为初始架构的补充，而不是替代初始架构。

**Step 4: 记录冻结结果**

验收结果应能用一句话概括：
> 当前 MVP 起点已经从“直接建辩论编排”收紧为“外部 Claw 会话接入与点对点中转基础能力”。

---

### Task 2: 冻结测试夹具口径

**Files:**
- Create: `docs/plans/2026-03-12-test-fixture-strategy.md`
- Reference: `docs/architecture/2026-03-12-claw-session-ingress-architecture.md`

**Step 1: 写清测试夹具的角色**

文档必须明确：
- 3 个 OpenClaw 容器属于测试环境
- 它们模拟未来用户自己的 Claw
- 它们不属于产品部署架构

**Step 2: 写清 fixture 的最小用途**

至少覆盖：
- 提供预配置端点
- 支撑会话挂载测试
- 支撑点对点中转测试
- 支撑回放测试

**Step 3: 写清 fixture 的替代策略**

说明：
- 优先使用真实 OpenClaw fixture
- 若真实 OpenClaw 在当前阶段不稳定，可临时使用 mock fixture
- mock fixture 只是验证平台契约，不替代真实 OpenClaw 联调

**Step 4: 验证该文档没有把 fixture 反客为主**

必须避免出现以下倾向：
- 围绕 fixture 设计产品边界
- 把测试配置写成产品长期约束

---

### Task 3: 定义最小实现切面而非完整代码目录

**Files:**
- Modify: `docs/plans/2026-03-12-session-claw-ingress-mvp.md`
- Reference: `docs/architecture/2026-03-12-claw-session-ingress-architecture.md`

**Step 1: 将计划中的实现切面收敛为 4 个最小能力**

只保留：
- Session 创建与关闭
- ClawEndpoint 预配置与会话挂载
- 点对点 Message 中转
- ReplayRecord 读取

**Step 2: 删除当前阶段不该冻结的代码目录假设**

删除或改写：
- 具体 `src/` 目录树
- 具体 HTTP 路由路径
- 具体存储实现名称
- 具体框架/协议实现细节

改为“实现切面 + 验证目标 + 后续待定目录”。

**Step 3: 删除与当前冻结边界冲突的行为假设**

删除或改写：
- 默认把消息发送给所有 Claw
- 过早引入 delivered/status 字段
- 把挂载/卸载协议写死成当前唯一接入方式

**Step 4: 保留后续 subagent 可执行性**

每个切面都要能被单独分派，但不要求现在就把代码路径写死。

---

### Task 4: 设计实现前的验证用例

**Files:**
- Create: `docs/plans/2026-03-12-session-claw-ingress-test-cases.md`
- Reference: `docs/architecture/2026-03-12-claw-session-ingress-architecture.md`

**Step 1: 写最小 happy path**

至少包含：
1. 平台加载预配置测试 ClawEndpoint
2. 创建 Session
3. 将两个或三个测试 Claw 挂入 Session
4. Claw A 经 Linpo 向 Claw B 发送一条消息
5. Linpo 返回或记录该消息
6. 通过 Replay 读取到这条消息

**Step 2: 写最小约束失败用例**

至少包含：
- 未挂载的 Claw 不能发送消息
- 未挂载的目标 Claw 不能成为收件方
- 已关闭 Session 不能再中转新消息

**Step 3: 写 fixture 验证用例**

至少包含：
- 测试环境能启动 fixture
- fixture 端点可被平台引用
- fixture 崩溃不会改变产品边界定义

---

### Task 5: 为后续实现拆分 subagent 任务

**Files:**
- Modify: `docs/plans/2026-03-12-session-claw-ingress-mvp.md`
- Reference: `AGENTS.md`

**Step 1: 将后续实现拆为独立 subagent 任务包**

建议拆分：
- 文档修订 subagent
- fixture 环境 subagent
- session 模型 subagent
- relay 能力 subagent
- replay 能力 subagent
- 集成测试 subagent

**Step 2: 为每个 subagent 任务写清输入/输出**

每个任务包必须至少写：
- 依赖文档
- 目标产出
- 验收标准
- 不允许越界实现的内容

**Step 3: 明确主 agent 职责**

必须写清：
- 主 agent 负责拆解、顺序控制、结果核对与集成
- 默认不亲自承担主要实现

---

### Task 6: 最终计划复核

**Files:**
- Verify: `docs/plans/2026-03-12-session-claw-ingress-mvp.md`
- Verify: `docs/architecture/2026-03-12-claw-session-ingress-architecture.md`
- Verify: `docs/plans/2026-03-12-test-fixture-strategy.md`
- Verify: `docs/plans/2026-03-12-session-claw-ingress-test-cases.md`

**Step 1: 复核文档之间的术语一致性**

必须保持一致的术语：
- ClawEndpoint
- Session
- Message
- ReplayRecord
- test fixture

**Step 2: 复核边界一致性**

确保所有文档都遵守：
- fixture 不是产品组件
- 当前起点不是完整辩论状态机
- 点对点中转优先于复杂交互

**Step 3: 为 compact / handoff 做准备**

整理一份后续推进摘要，至少说明：
- 当前已冻结的架构边界
- 当前仍未冻结的实现细节
- 后续第一批 subagent 应该如何开工

---

## 当前阶段完成标准

满足以下条件，才算本轮文档工作完成：

- `docs/architecture/2026-03-12-claw-session-ingress-architecture.md` 已可作为权威补充文档
- 测试夹具策略已被单独写清
- `docs/plans/2026-03-12-session-claw-ingress-mvp.md` 已从“过早代码化”收紧为“可分派实施计划”
- 已形成可直接用于下一轮 subagent 实现的任务切面

---

## 后续执行选项

### 方案 A：继续保持文档级实施切面

适用于尚未冻结实现基线的情况。

### 方案 B：按 Python + FastAPI 最小实现基线派发 subagents

当前已新增实现基线文档：

- `docs/plans/2026-03-12-python-fastapi-bootstrap.md`

在该基线下，后续实现任务按以下顺序派发：

#### Task Pack 1：工程骨架与测试基线 subagent
- 依赖文档：
  - `docs/architecture/2026-03-12-claw-session-ingress-architecture.md`
  - `docs/plans/2026-03-12-test-fixture-strategy.md`
  - `docs/plans/2026-03-12-session-claw-ingress-test-cases.md`
  - `docs/plans/2026-03-12-python-fastapi-bootstrap.md`
- 目标产出：
  - `pyproject.toml`
  - `app/` 最小 FastAPI 应用骨架
  - `tests/` 最小 pytest / TestClient 基线
  - 健康检查测试与最小 app 启动测试
- 验收标准：
  - 可运行最小测试
  - 测试先失败后通过
  - 未引入数据库、鉴权、队列、多服务目录
- 不允许越界实现：
  - session / relay / replay 业务能力
  - 真实 OpenClaw 协议细节

#### Task Pack 2：fixture 基线 subagent
- 依赖文档：
  - `docs/plans/2026-03-12-test-fixture-strategy.md`
  - `docs/plans/2026-03-12-python-fastapi-bootstrap.md`
- 目标产出：
  - `fixtures/mock/` 下的最小 mock fixture
  - 如可行，再补 `fixtures/openclaw/` 与 compose 测试拓扑草案
- 验收标准：
  - fixture 仅位于测试拓扑
  - 平台后续可把 fixture 引用为预配置端点
- 不允许越界实现：
  - 把 fixture 建模为产品运行单元
  - 围绕 fixture 反推产品边界

#### Task Pack 3：Session 模型与创建/关闭 subagent
- 依赖文档：
  - `docs/architecture/2026-03-12-claw-session-ingress-architecture.md`
  - `docs/plans/2026-03-12-session-claw-ingress-test-cases.md`
  - `docs/plans/2026-03-12-python-fastapi-bootstrap.md`
- 目标产出：
  - Session 最小领域模型
  - 创建 / 关闭服务逻辑
  - 对应 API 与 unit tests
- 验收标准：
  - `created` / `active` / `closed` 语义成立
  - 已关闭 Session 不接受后续 relay
- 不允许越界实现：
  - 辩论回合状态机
  - 主持人控制语义

#### Task Pack 4：ClawEndpoint 预配置与会话挂载 subagent
- 依赖文档：
  - `docs/architecture/2026-03-12-claw-session-ingress-architecture.md`
  - `docs/plans/2026-03-12-test-fixture-strategy.md`
  - `docs/plans/2026-03-12-python-fastapi-bootstrap.md`
- 目标产出：
  - ClawEndpoint 最小模型
  - 预配置端点读取
  - 挂载规则与 tests
- 验收标准：
  - 未挂载 Claw 不能参与 relay
  - Session 挂载关系由 Linpo 作为真相源
- 不允许越界实现：
  - 长期注册池
  - 自动发现与纳管

#### Task Pack 5：点对点 relay subagent
- 依赖文档：
  - `docs/architecture/2026-03-12-claw-session-ingress-architecture.md`
  - `docs/plans/2026-03-12-session-claw-ingress-test-cases.md`
  - `docs/plans/2026-03-12-python-fastapi-bootstrap.md`
- 目标产出：
  - Message 最小模型
  - relay 服务与 API
  - 相关 unit/integration tests
- 验收标准：
  - 仅允许 session 内已挂载双方进行点对点消息中转
  - 消息被记录到 Linpo 内部历史
- 不允许越界实现：
  - 广播、群聊、消息状态扩展字段

#### Task Pack 6：replay 读取 subagent
- 依赖文档：
  - `docs/architecture/2026-03-12-claw-session-ingress-architecture.md`
  - `docs/plans/2026-03-12-session-claw-ingress-test-cases.md`
  - `docs/plans/2026-03-12-python-fastapi-bootstrap.md`
- 目标产出：
  - ReplayRecord 最小读取逻辑
  - replay API 与 tests
- 验收标准：
  - 可按时间顺序返回某 Session 下全部 Message
  - 回放以 Linpo 内部记录为准
- 不允许越界实现：
  - 结构化总结
  - 外部 Claw 历史聚合

#### Task Pack 7：集成测试 subagent
- 依赖文档：
  - `docs/plans/2026-03-12-session-claw-ingress-test-cases.md`
  - `docs/plans/2026-03-12-test-fixture-strategy.md`
  - `docs/plans/2026-03-12-python-fastapi-bootstrap.md`
- 目标产出：
  - happy path 集成测试
  - 失败路径集成测试
  - fixture 不可达场景测试
- 验收标准：
  - 覆盖会话创建、挂载、relay、replay 与关键失败路径
- 不允许越界实现：
  - 将测试拓扑误写为产品拓扑

主 agent 负责：
- 按顺序派发 subagents
- 在每个 task pack 后核对实现与文档边界一致
- 仅在极小修正时直接编辑，不承担主要实现
