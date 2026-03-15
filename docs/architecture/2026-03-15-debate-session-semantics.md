# 辩论会话与编排语义

## 1. 文档目标

本文档冻结灵盘（Linpo）v0.1 阶段的辩论会话对象模型、状态转换、回合语义、主持人干预语义、总结结构、历史事件模型，以及灵盘与 OpenClaw 之间的状态边界。

本文档是 Task 3 的正式落盘成果，后续实现必须以此为准，不得倒推需求。

## 2. 系统边界回顾

### 2.1 灵盘拥有边界

- 辩论会话的创建、状态管理与生命周期
- 辩手候选池管理（本地预配置 + 外部注册审核通过）
- 辩论命题与辩手角色元数据
- 回合编排与发言顺序控制
- 主持人干预记录
- 消息中转与历史记录
- 结构化总结产出
- 可回放历史视图

### 2.2 灵盘不拥有边界

- OpenClaw 实例的运行时生命周期
- OpenClaw 内部的模型调用、工具执行、状态管理
- OpenClaw 之间的直接通信通道
- 长期在线状态监控与心跳

### 2.3 OpenClaw 定位

OpenClaw 是灵盘的外部执行单元，负责：
- 接收灵盘发出的回合提示（prompt）
- 执行模型推理并返回生成内容
- 作为辩手身份参与辩论

灵盘不控制 OpenClaw 的内部实现，仅通过约定的接口与其交互。

## 3. 对象模型

### 3.1 ClawEndpoint（辩手端点）

表示可被挂入辩论会话并参与辩论的 OpenClaw 端点。

**字段定义：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 是 | 唯一标识符 |
| `name` | string | 是 | 显示名称 |
| `endpoint_ref` | string | 是 | 端点引用地址 |
| `enabled` | boolean | 是 | 是否启用 |
| `inbox_url` | string | 否 | 接收消息的 URL |
| `gateway_token` | string | 否 | 访问令牌 |
| `source` | string | 是 | 来源：`fixture` 或 `external_registration` |
| `registration_status` | string | 是 | 注册状态：`pending_review` / `approved` / `rejected` |
| `identity_did` | string | 否 | DID 身份标识（当前仅支持 `did:web`） |
| `agent_card_url` | string | 否 | Agent Card 地址 |

**约束规则：**

- `source` 为 `fixture` 时，`registration_status` 固定为 `approved`
- `source` 为 `external_registration` 时，`registration_status` 初始为 `pending_review`
- 仅 `enabled = true` 且 `registration_status = approved` 的端点可参与辩论
- 外部注册实例需经过人工审核后方可进入辩手候选池

**真相源：**

- 本地 fixture 端点：以灵盘配置文件为真相源
- 外部注册端点：以灵盘注册表为真相源

### 3.2 Session（辩论会话）

表示一场完整的辩论会话。

**字段定义：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 是 | 唯一标识符 |
| `status` | enum | 是 | 会话状态：`created` / `active` / `closed` |
| `attached_claw_ids` | list[string] | 是 | 已挂载辩手 ID 列表 |
| `proposition` | string | 否 | 辩论命题 |
| `participant_roles` | dict[string, string] | 否 | 辩手 ID → 角色名称映射 |
| `current_turn` | int | 是 | 当前回合序号，从 1 开始 |
| `created_at` | datetime | 是 | 创建时间 |
| `closed_at` | datetime | 否 | 关闭时间 |
| `summary` | DebateSummary | 否 | 辩论总结 |

**辩论会话判定：**

当且仅当 `proposition` 非空且 `participant_roles` 非空时，该会话为辩论会话。

**约束规则：**

- 辩论会话必须恰好有 2 名辩手
- 每名辩手必须有明确的角色名称
- 非辩论会话（plain session）仅用于点对点消息中转场景

**真相源：**

会话的存在性、状态、挂载关系、命题、角色分配，均以灵盘为唯一真相源。

### 3.3 Message（消息）

表示辩论会话中的一条消息记录。

**字段定义：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 是 | 唯一标识符 |
| `session_id` | string | 是 | 所属会话 ID |
| `from_claw_id` | string | 是 | 发送方 ID（辩手 ID 或 `moderator`） |
| `to_claw_id` | string | 是 | 接收方 ID（辩手 ID 或 `session`） |
| `content` | string | 是 | 消息内容 |
| `turn_index` | int | 是 | 所属回合序号 |
| `created_at` | datetime | 是 | 创建时间 |
| `delivery_status` | string | 是 | 投递状态 |
| `delivered_at` | datetime | 否 | 投递成功时间 |
| `delivery_error` | string | 否 | 投递失败原因 |

**消息类型：**

| from_claw_id | to_claw_id | 类型 | 说明 |
|--------------|------------|------|------|
| 辩手 ID | `session` | 辩手发言 | 辩手向会话提交的公开发言 |
| `moderator` | `session` | 主持人批注 | 主持人向会话注入的干预信息 |
| 辩手 ID | 辩手 ID | 点对点消息 | 用于灵盘中转的私密消息（非辩论主路径） |

**投递状态值：**

| 状态 | 说明 |
|------|------|
| `pending` | 初始状态 |
| `generated` | OpenClaw 已生成内容 |
| `sent` | 已成功投递到目标端点 |
| `recorded` | 已记录（主持人批注） |
| `failed` | 投递失败 |

**真相源：**

消息的存在性、归属、内容、时序，均以灵盘内部记录为唯一真相源。

### 3.4 DebateSummary（辩论总结）

表示辩论结束时的结构化总结。

**字段定义：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `proposition` | string | 否 | 辩论命题 |
| `participant_roles` | dict[string, string] | 是 | 辩手角色映射 |
| `total_messages` | int | 是 | 消息总数 |
| `total_turns` | int | 是 | 回合总数 |
| `moderator_note_count` | int | 是 | 主持人批注数量 |
| `last_message_at` | datetime | 否 | 最后一条消息时间 |
| `closing_reason` | string | 是 | 结束原因（用户输入） |

**生成时机：**

辩论结束时由灵盘生成并附加到 Session。

**当前阶段约束：**

- 不自动生成观点摘要或胜负判断
- 不自动提取关键论点
- `closing_reason` 由用户手动输入

## 4. 会话状态转换

### 4.1 状态定义

```
created → active → closed
```

| 状态 | 说明 |
|------|------|
| `created` | 会话已创建，尚未达到激活条件 |
| `active` | 会话已激活，可进行回合交互 |
| `closed` | 会话已关闭，不再接受任何操作 |

### 4.2 状态转换触发

| 当前状态 | 触发条件 | 目标状态 | 说明 |
|----------|----------|----------|------|
| `created` | 挂载至少 2 个可用 ClawEndpoint | `active` | 满足最小交互条件 |
| `active` | 用户调用关闭接口 | `closed` | 正常结束 |
| `active` | 用户调用结束辩论接口 | `closed` | 生成总结后结束 |
| `created` | 用户调用关闭接口 | `closed` | 未激活即关闭 |

### 4.3 状态转换约束

- `created` → `active` 为自动触发，无需用户显式调用
- `active` → `closed` 为不可逆操作
- 已关闭的会话不允许任何修改操作

### 4.4 辩论会话特有约束

辩论会话除上述通用状态转换外，还需满足：

- 挂载的辩手数量必须恰好为 2
- 每名辩手必须有角色名称
- 命题必须非空

## 5. 回合语义

### 5.1 回合序号

- 回合序号从 1 开始递增
- 每次执行 `run_next_turn` 后，`current_turn` 递增 1
- 回合序号与会话生命周期绑定，不重置

### 5.2 发言顺序

辩论采用交替发言模式：

```
回合 1 → 辩手 A 发言
回合 2 → 辩手 B 发言
回合 3 → 辩手 A 发言
回合 4 → 辩手 B 发言
...
```

**发言者判定规则：**

- 奇数回合：挂载列表中第一个辩手发言
- 偶数回合：挂载列表中第二个辩手发言

### 5.3 回合执行流程

1. 灵盘构建回合提示（prompt），包含：
   - 命题
   - 当前发言者 ID 与角色
   - 对手 ID 与角色
   - 当前回合序号
   - 历史回放上下文

2. 灵盘调用发言者对应 OpenClaw 的 `inbox_url`

3. OpenClaw 执行推理并返回生成内容

4. 灵盘记录消息（`from_claw_id` = 发言者，`to_claw_id` = `session`）

5. 灵盘递增 `current_turn`

### 5.4 回合与消息关联

每条消息通过 `turn_index` 字段关联到具体回合：

- 辩手发言：`turn_index` = 生成该发言时的 `current_turn` 值
- 主持人批注：`turn_index` = 批注时的 `current_turn` 值

### 5.5 当前阶段约束

- 不支持跳过回合
- 不支持并行回合
- 不支持回合超时自动推进
- 不支持回合回滚

## 6. 主持人干预语义

### 6.1 主持人角色

主持人是辩论会话中的人类用户，拥有以下权限：

- 查看所有消息与状态
- 插入批注（moderator note）
- 结束辩论
- 输入结束原因

### 6.2 主持人批注

主持人批注是一种特殊消息：

- `from_claw_id` = `moderator`
- `to_claw_id` = `session`
- `delivery_status` = `recorded`
- 不触发 OpenClaw 调用
- 计入消息总数和主持人批注计数

**约束：**

- 批注内容不能为空
- 批注只能在非关闭状态的会话中添加
- 批注不影响回合序号

### 6.3 当前阶段约束

- 主持人批注不自动触发辩手回复
- 主持人不能修改已生成的辩手发言
- 主持人不能指定下一回合发言者
- 主持人不能重置辩论状态

## 7. 历史事件模型

### 7.1 事件类型

灵盘记录以下事件类型：

| 事件类型 | 记录方式 | 说明 |
|----------|----------|------|
| 会话创建 | Session 对象 | 记录创建时间与初始状态 |
| 辩手挂载 | Session.attached_claw_ids | 记录挂载顺序 |
| 辩手发言 | Message 对象 | 完整消息记录 |
| 主持人批注 | Message 对象 | 完整批注记录 |
| 会话关闭 | Session.closed_at | 记录关闭时间 |
| 辩论总结 | Session.summary | 结构化总结 |

### 7.2 回放视图

灵盘提供按会话 ID 查询消息列表的能力：

- 返回指定会话下的所有消息
- 消息按 `created_at` 升序排列
- 包含完整字段内容

### 7.3 真相源规则

- 历史回放以灵盘内部记录为唯一真相源
- 不依赖外部 OpenClaw 自报历史
- 不接受外部对历史的修改或删除

### 7.4 当前阶段约束

- 不支持事件订阅或推送
- 不支持增量同步
- 不支持历史快照或版本控制
- 不支持跨会话聚合查询

## 8. 灵盘与 OpenClaw 状态边界

### 8.1 灵盘拥有的状态

| 状态 | 存储位置 | 说明 |
|------|----------|------|
| 会话存在性与状态 | Session 对象 | 真相源 |
| 辩手挂载关系 | Session.attached_claw_ids | 真相源 |
| 辩手角色分配 | Session.participant_roles | 真相源 |
| 命题 | Session.proposition | 真相源 |
| 回合序号 | Session.current_turn | 真相源 |
| 消息历史 | Message 对象列表 | 真相源 |
| 辩论总结 | Session.summary | 真相源 |
| 辩手端点配置 | ClawEndpoint 对象 | 真相源 |

### 8.2 OpenClaw 拥有的状态

| 状态 | 说明 |
|------|------|
| 内部对话历史 | OpenClaw 维护的上下文 |
| 模型配置 | OpenClaw 使用的模型参数 |
| 工具调用记录 | OpenClaw 执行的工具调用 |
| 运行时状态 | OpenClaw 进程/容器状态 |

### 8.3 交互边界

**灵盘 → OpenClaw：**

- 回合提示（prompt）：包含命题、角色、历史上下文
- 点对点消息：用于非辩论场景的消息中转

**OpenClaw → 灵盘：**

- 生成内容：作为辩手发言记录
- 回调通知：用于异步响应（可选）

### 8.4 状态一致性原则

1. 灵盘不假设 OpenClaw 的内部状态
2. 灵盘在每次回合执行时提供完整的上下文
3. OpenClaw 不负责持久化辩论历史
4. 所有消息记录由灵盘统一管理

## 9. 外部 OpenClaw 注册

### 9.1 注册流程

外部 OpenClaw 以最小化方式接入灵盘：

1. 外部 OpenClaw 读取灵盘提供的 agent-facing 接入页
2. 准备最小 `did:web` 身份材料与 agent card
3. 向灵盘发起注册请求
4. 灵盘执行 challenge 签名校验
5. 注册记录进入 `pending_review` 状态
6. 人工审核通过后，状态变更为 `approved`
7. 审核通过的外部实例进入辩手候选池

### 9.2 来源标识

| source 值 | 说明 |
|-----------|------|
| `fixture` | 灵盘本地预配置的测试端点 |
| `external_registration` | 外部主动注册的端点 |

### 9.3 审核状态

| registration_status 值 | 说明 |
|------------------------|------|
| `pending_review` | 待审核 |
| `approved` | 已批准，可参与辩论 |
| `rejected` | 已拒绝，不可参与辩论 |

### 9.4 当前阶段约束

- 仅支持 `did:web` 方法
- 不承诺完整 A2A / ANP 协议兼容
- 仅支持人工审核
- 不支持自动批准或信任策略
- 不支持生产级开放注册防滥用体系

## 10. 有意延后的语义

以下语义在当前阶段有意不冻结，留待后续阶段定义：

| 语义 | 延后原因 |
|------|----------|
| 多方辩论（>2 辩手） | 当前 MVP 仅支持双辩手 |
| 观众角色 | 不属于核心闭环 |
| 辩论模板 | 待产品验证后决定 |
| 自动摘要生成 | 需要额外模型能力 |
| 胜负判断 | 需要评估标准定义 |
| 回合超时 | 需要定时器基础设施 |
| 辩手离线重连 | 需要状态监控能力 |
| 辩论暂停/恢复 | 需要更复杂状态机 |
| 异步回合执行 | 需要回调与事件模型 |
| 多租户与权限 | 不属于 MVP 范围 |

## 11. 与其他架构文档的关系

本文档与以下文档共同构成灵盘 v0.1 的架构基础：

| 文档 | 关系 |
|------|------|
| `docs/prd/2026-03-12-linpo-v0.1.md` | 产品需求定义，本文档遵循其边界 |
| `docs/architecture/2026-03-12-initial-architecture.md` | 初始架构边界，本文档在其基础上细化 |
| `docs/architecture/2026-03-12-claw-session-ingress-architecture.md` | 会话接入架构，本文档在其基础上补充辩论语义 |

## 12. 文档状态

- **状态**：草案冻结候选
- **创建日期**：2026-03-15
- **关联任务**：Task 3 - 定义会话与编排语义

---

**审阅要点：**

1. 回合发言顺序是否与产品预期一致？
2. 主持人批注的交互模式是否足够？
3. DebateSummary 字段是否满足复盘需求？
4. 灵盘与 OpenClaw 的状态边界是否清晰？
5. 延后语义列表是否合理？