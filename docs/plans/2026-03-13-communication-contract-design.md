# 灵盘通信契约层设计：真实端点映射与出站中继

## 1. 文档目的

本文档定义灵盘下一阶段 MVP 所需的最小通信契约层：将逻辑 `claw_id` 映射到真实可达端点，并定义出站中继（outbound relay）的最小语义。

本文档不涉及：长期注册系统、A2A/ANP 协议实现、广播机制、生产级鉴权。

## 2. 当前实现状态

### 2.1 已实现：Preflight 回调流（Claw → Linpo）

| 路径 | 用途 | 状态 |
|------|------|------|
| `GET /protocol/claw` | 返回协议指南，告知 claw 如何回调 | 已实现 |
| `GET /protocol/claw/test` | 返回 echo 测试任务契约 | 已实现 |
| `POST /callback/echo` | 接收 claw 回调，验证 payload 匹配 | 已实现 |

**特点：**
- 用于验证 claw 与 Linpo 的回调链路连通性
- `claw_id` 在回调 payload 中可选，不强制注册
- 无长期状态绑定，纯 preflight 验证

**实现文件：**
- `app/api/protocol_api.py` — 协议指南端点
- `app/api/callback_api.py` — 回调接收端点
- `app/domain/callback_record.py` — 回调记录模型

### 2.2 已实现：Host 侧主路径（Session/Attachment/Relay/Replay）

| 路径 | 用途 | 状态 |
|------|------|------|
| `POST /sessions` | 创建辩论会话 | 已实现 |
| `POST /sessions/{id}/attachments` | 将 claw 端点绑定到会话 | 已实现 |
| `POST /sessions/{id}/relay` | 记录一条 claw-to-claw 消息 | 已实现（仅内存存储） |
| `GET /sessions/{id}/replay` | 回看会话内所有消息 | 已实现 |
| `POST /sessions/{id}/close` | 关闭会话 | 已实现 |

**特点：**
- 会话生命周期管理完整
- 消息仅存内存，无持久化
- **relay 仅记录消息，不执行真实出站 HTTP 调用**

**实现文件：**
- `app/api/session_api.py` — 会话 API 端点
- `app/services/session_service.py` — 会话服务逻辑
- `app/domain/session.py` — 会话领域模型
- `app/domain/message.py` — 消息领域模型

### 2.3 已实现：端点映射（Fixture 静态配置）

| 组件 | 状态 | 说明 |
|------|------|------|
| `ClawEndpoint` | 已定义 | 包含 id, name, endpoint_ref, enabled |
| `FileClawEndpointRepository` | 已实现 | 从 YAML fixture 读取端点配置 |
| `fixtures/mock/claw_endpoints.yaml` | 已存在 | 包含 mock-claw-alpha/beta/gamma |

**当前 endpoint_ref 字段：**
```yaml
endpoint_ref: mock://claw-alpha  # 逻辑 stub，非真实 HTTP 端点
```

**实现文件：**
- `app/domain/claw_endpoint.py` — 端点领域模型
- `app/repositories/claw_endpoint_repository.py` — 端点仓库

## 3. 缺失部分

### 3.1 真实端点映射

当前 `endpoint_ref` 字段存储的是逻辑 stub 引用（如 `mock://claw-alpha`），不是真实 HTTP URL。

**缺失项：**
- 真实 HTTP URL 的存储结构
- 端点可达性验证机制
- 端点类型区分（回调地址 vs 接收地址）

### 3.2 出站中继语义

当前 `relay_message` 方法仅将消息存入内存，不执行任何 HTTP 出站调用。

**缺失项：**
- 出站 HTTP 调用逻辑
- 投递状态记录（pending/sent/failed）
- 失败边界与错误语义
- 与 claw 的接收契约

### 3.3 Claw 接收契约

当前仅定义了 claw → Linpo 的回调契约，未定义 Linpo → claw 的推送契约。

**缺失项：**
- claw 接收消息的 HTTP 接口规范
- 消息格式与元数据字段
- 确认/拒绝语义

## 4. 最小端点映射模型

### 4.1 设计原则

- 不引入长期注册系统
- 保持 fixture 驱动的静态配置模式
- 仅扩展字段，不改变现有数据结构

### 4.2 字段扩展建议

在 `ClawEndpoint` 领域模型中新增一个字段：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `inbox_url` | `str \| None` | 否 | Linpo 向 claw 推送消息的 HTTP 端点 |

> **设计决策：** 不新增 `callback_url` 字段。当前 claw 回调流已通过 payload 中的 `claw_id` 标识来源，无需额外 URL 字段。MVP 阶段聚焦出站中继，入站回调保持现有契约不变。

**扩展后的 fixture 示例：**

```yaml
claw_endpoints:
  - id: openclaw-proponent
    name: 正方辩手
    endpoint_ref: openclaw://proponent
    inbox_url: http://localhost:8001/inbox
    enabled: true
  - id: openclaw-opponent
    name: 反方辩手
    endpoint_ref: openclaw://opponent
    inbox_url: http://localhost:8002/inbox
    enabled: true
```

### 4.3 端点可用性验证

在 `SessionService.attach_claw_endpoints` 中，当 `inbox_url` 存在时，可选执行 HEAD 请求验证可达性。此步骤为可选，不阻塞 attachment 流程。

**验证时机：** attachment 时异步执行，失败记录日志但不拒绝 attachment。

## 5. 最小出站中继契约

### 5.1 设计原则

- 保持最小：仅支持单播（one-to-one），不支持广播
- 同步调用：当前阶段不引入消息队列，直接同步 HTTP 调用
- 失败透明：投递失败记录状态，不自动重试

### 5.2 消息投递状态扩展

在 `Message` 领域模型中新增投递状态：

| 字段 | 类型 | 说明 |
|------|------|------|
| `delivery_status` | `enum` | pending / sent / failed |
| `delivered_at` | `datetime \| None` | 投递成功时间 |
| `delivery_error` | `str \| None` | 投递失败原因 |

### 5.3 出站 HTTP 调用规范

**请求格式：**

```http
POST {inbox_url}
Content-Type: application/json

{
  "message_id": "uuid",
  "session_id": "uuid",
  "from_claw_id": "openclaw-proponent",
  "to_claw_id": "openclaw-opponent",
  "content": "辩论内容...",
  "created_at": "2026-03-13T10:00:00Z"
}
```

**响应期望：**

| 状态码 | 含义 |
|--------|------|
| 200 / 201 | 投递成功 |
| 4xx | 客户端错误（payload 无效等） |
| 5xx | 服务端错误 |

**超时设置：** 30 秒（可配置）

**幂等性说明：** 每条消息包含唯一 `message_id`。若需支持重复投递去重，由 claw 接收方基于 `message_id` 自行实现。当前 MVP 阶段 Linpo 不自动重试，幂等性需求推迟至引入消息队列时再行设计。

### 5.4 投递流程

```
relay_message(session_id, from_claw_id, to_claw_id, content)
    │
    ├─▶ 验证 session 状态与 claw attachment
    │
    ├─▶ 创建 Message 对象（delivery_status=pending）
    │
    ├─▶ 查询 target_claw 的 inbox_url
    │     │
    │     └─▶ 若 inbox_url 为空 → 标记 delivery_status=failed
    │                              delivery_error="no inbox_url configured"
    │
    ├─▶ 执行 HTTP POST 到 inbox_url
    │     │
    │     ├─▶ 成功（2xx）→ delivery_status=sent, delivered_at=now
    │     │
    │     └─▶ 失败 → delivery_status=failed, delivery_error=错误信息
    │
    └─▶ 保存 Message 并返回
```

### 5.5 失败边界

| 场景 | 处理方式 |
|------|----------|
| `inbox_url` 未配置 | 标记 failed，记录 "no inbox_url configured" |
| HTTP 超时 | 标记 failed，记录 "timeout" |
| HTTP 非 2xx | 标记 failed，记录状态码与响应体（截断） |
| 网络 DNS/TCP 错误 | 标记 failed，记录异常类型 |

**不实现：** 自动重试、死信队列、补偿事务。

## 6. 真相源规则

### 6.1 端点配置

- **真相源：** `fixtures/mock/claw_endpoints.yaml`（未来可替换为数据库）
- **读取时机：** 首次请求时延迟加载并缓存于 `app.state`，运行期间不变更
- **验证规则：** fixture 不存在时返回 503（已实现）

### 6.2 会话状态

- **真相源：** `InMemorySessionRepository`（未来可替换为持久化存储）
- **一致性要求：** 单进程内存状态，无跨实例一致性要求

### 6.3 消息记录

- **真相源：** `InMemoryMessageRepository`
- **持久化：** 当前阶段不持久化，重启丢失
- **replay 一致性：** 返回内存中所有消息，按写入顺序返回（append order）

## 7. OpenClaw 定位

根据 `docs/architecture/2026-03-12-initial-architecture.md`：

> OpenClaw 在当前阶段被视为外部运行时内核。

因此：

- OpenClaw 实例作为**外部 fixture / 未来用户 claw**，不属于灵盘平台组件
- 端点配置由灵盘维护，但 claw 的运行时由外部管理
- 当前阶段不实现 claw 的自动发现或动态注册

## 8. 分阶段实施建议

### Phase 2.1：字段扩展（无行为变更）

1. 扩展 `ClawEndpoint` 模型，新增 `inbox_url` 字段
2. 更新 fixture YAML 格式
3. 更新 `FileClawEndpointRepository` 解析逻辑
4. 测试：fixture 加载、字段可读

**验收标准：** 现有测试全部通过，新字段可通过 fixture 配置。

### Phase 2.2：消息投递状态扩展

1. 扩展 `Message` 模型，新增 `delivery_status`、`delivered_at`、`delivery_error`
2. 调整 `new_message()` 工厂函数，默认 `delivery_status=pending`
3. 更新 API 响应模型 `MessageReadModel`，暴露投递状态
4. 测试：消息创建、状态默认值、API 响应字段

**验收标准：** 现有测试通过，replay 返回包含投递状态字段。

### Phase 2.3：出站 HTTP 调用（核心）

1. 新增 `RelayClient` 服务，封装 HTTP 调用逻辑
2. 在 `SessionService.relay_message` 中集成出站调用
3. 处理 `inbox_url` 缺失、超时、错误等边界情况
4. 测试：使用 `responses` 库 mock HTTP 端点，覆盖成功/失败/超时场景

**验收标准：**
- 有 `inbox_url` 时执行 HTTP POST
- 无 `inbox_url` 时标记 failed
- HTTP 错误时记录错误信息

### Phase 2.4：集成验证

1. 编写端到端测试：创建 session → attach → relay → replay
2. 验证完整流程中的投递状态变化
3. 验证 fixture 中配置的真实端点可被调用

**验收标准：** MVP 闭环成立，可演示真实 claw 间消息传递。

## 9. 风险与约束

| 风险 | 缓解措施 |
|------|----------|
| 同步 HTTP 调用阻塞请求 | 当前阶段可接受；流量增长后引入异步队列 |
| 无自动重试导致消息丢失 | 记录 failed 状态，由运维/用户手动处理 |
| 单 fixture 文件限制 | 当前阶段可接受；未来支持数据库或多 fixture |
| 无消息持久化 | 当前阶段可接受；按需引入持久化层 |

## 10. 非目标

以下内容明确不在当前设计范围内：

- 长期 claw 注册系统
- A2A 或 ANP 协议实现
- 广播/多播消息
- 生产级鉴权（API Key / OAuth）
- 消息队列集成
- 死信队列与补偿事务
- 跨实例消息一致性

## 11. 参考资料

- 产品定义：`docs/prd/2026-03-12-linpo-v0.1.md`
- 初始架构：`docs/architecture/2026-03-12-initial-architecture.md`
- 第一阶段计划：`docs/plans/2026-03-12-phase-1-plan.md`
- 现有实现：
  - `app/api/session_api.py` — 会话 API
  - `app/services/session_service.py` — 会话服务
  - `app/domain/claw_endpoint.py` — 端点模型
  - `app/repositories/claw_endpoint_repository.py` — 端点仓库
  - `fixtures/mock/claw_endpoints.yaml` — 端点 fixture