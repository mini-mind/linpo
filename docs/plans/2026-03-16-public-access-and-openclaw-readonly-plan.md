# Linpo v0.1 Public Demo Access & OpenClaw Read-Only Integration Plan

> **状态**：当前有效的接入与公网联调边界文档
>
> **前置文档**：
> - `docs/prd/2026-03-15-linpo-v0.1-observer-prd.md`
> - `docs/architecture/2026-03-15-observer-architecture.md`
> - `docs/plans/2026-03-16-observer-demo-hardening-and-data-boundary-plan.md`
> - `docs/plans/2026-03-16-observer-demo-runbook.md`

## 1. 文档目的

本文档用于冻结两个紧邻 v0.1 的实现边界：

1. 支持**公网浏览器联调/演示**，避免 `localhost` 默认值误导远程访问
2. 支持**真实 OpenClaw 的只读 observer 接入**，但不引入任何控制能力

本文档不扩张 v0.1 产品范围，只为当前 observer-only 路径提供更真实的访问与数据来源。

---

## 2. 当前问题

### 2.1 公网联调问题

当前前端 API base 在未显式配置时回退到 `http://localhost:8000`。这会在远程浏览器访问时把 API 请求错误地指向用户本机，而不是部署 Linpo 的服务器。

同时，后端 CORS 当前只放行本地 `localhost/127.0.0.1` 的开发地址，不覆盖公网 IP / 域名来源。

### 2.2 真实数据接入问题

当前后端已经有 `ObserverDataSource` 只读抽象，但实际仍固定绑定 `StubObserverDataSource`。

这意味着：

- 当前所有列表、拓扑、事件数据仍来自 stub
- 还没有 `OpenClawObserverDataSource`
- 也没有 OpenClaw → Linpo read model 的映射层

---

## 3. v0.1 明确边界

### 3.1 允许做的事情

- 从 OpenClaw 读取 agent / topology / event 类信息
- 将外部数据映射成 Linpo 已冻结的最小 observer read model
- 在前端和文档中清晰区分“本地 demo”与“公网联调”运行方式
- 为公网来源配置显式 CORS 白名单

### 3.2 明确不做的事情

- 不新增 agent 控制、启停、重试、审批等操作
- 不引入 session 控制面
- 不冻结大型 OpenClaw 外部协议
- 不引入 websocket / persistence / auth 作为本轮前置条件
- 不把 OpenClaw runtime 概念直接扩张成 Linpo 自有产品对象

---

## 4. 公网联调配置原则

### 4.1 前端 API base 原则

前端不再使用误导性的 `localhost:8000` 作为默认 API 地址。

推荐规则：

- 若显式设置 `VITE_API_BASE_URL`，则使用该值
- 若未设置，则使用基于当前页面 host 推导的同机后端地址：`<当前协议>//<当前主机>:8000`
- 前端错误信息中应明确显示当前使用的 API base，便于定位联调问题

这样既支持本地开发，也避免远程浏览器把 API 错误打到用户本机。

### 4.2 后端 CORS 原则

后端默认只放行本地开发来源，但必须支持通过环境变量追加公网来源。

推荐规则：

- 保留本地开发 origin 默认值
- 增加如 `LINPO_CORS_ALLOW_ORIGINS` 的环境变量，使用逗号分隔 origin 列表
- 禁止使用 `*` 作为默认策略

---

## 5. OpenClaw 只读接入原则

### 5.1 接入形态

OpenClaw 接入只允许通过新的只读数据源实现：

- `ObserverDataSource`（已存在）
- `StubObserverDataSource`（已存在）
- `OpenClawObserverDataSource`（新增）

Linpo API 继续只暴露当前 3 个 observer 只读接口，不新增控制类接口。

### 5.1.1 当前实验基线（已确认）

本机 Docker 中已存在可用于实验的 OpenClaw gateway 实例。当前推荐以单实例方式进行只读联调，避免多实例同时接入带来的观测噪音。

当前已确认的最小实验基线如下：

- 实例：`claw2-openclaw-gateway-1`
- 网关地址：`ws://127.0.0.1:28789`
- 鉴权模式：`token`
- 协议版本：`3`
- 推荐 Origin：`http://127.0.0.1:28789`

当前实验已确认：

- `GET /health` 可返回 `{\"ok\": true, \"status\": \"live\"}`
- WebSocket 连接后会先收到 `connect.challenge`
- 只有发送合法的 `connect` 请求后，才会返回 `hello-ok`
- `hello-ok` 中可包含当前可用 methods / events 以及 `snapshot.health`、`snapshot.presence`

因此，Linpo 当前阶段的真实接入实验应以“最小只读握手 + hello/snapshot 映射”为边界，而不是尝试控制类调用。

### 5.2 映射目标

OpenClaw 数据必须映射到当前已冻结的最小对象：

- `Agent`
- `TopologyNode`
- `EventRecord`

也就是继续服务于：

- `GET /agents`
- `GET /agents/{agent_id}`
- `GET /agents/{agent_id}/nodes/{node_id}`

### 5.3 当前已知不确定性

当前仓库内没有可直接复用的 OpenClaw 完整 observer 契约，因此接入层需要显式做以下事情：

- 定义 OpenClaw 读取配置
- 映射外部状态到 Linpo 状态枚举
- 从外部数据中推导 root 节点、parent-child 关系和事件列表
- 对无法映射的字段保持裁剪，而不是扩大 Linpo UI

---

## 6. 失败与回退策略

本阶段采用显式失败策略：

- `stub` 只能作为**显式选择的数据源**
- 一旦选择 `openclaw`，如果配置缺失、连接失败、响应不合法或映射失败，Linpo 必须**直接报错**
- 不允许因 OpenClaw 错误而静默回退到 stub
- 不允许在公网联调场景中展示伪装成真实数据的假数据

建议使用环境变量表达：

- `LINPO_OBSERVER_DATA_SOURCE=stub|openclaw`

推荐默认：

- 未配置时：`stub`
- 若选择 `openclaw`：初始化或请求阶段一旦出错，直接返回明确错误

这样做的原因是：

- 用户要求“如果 OpenClaw 错误，需要直接汇报出来不隐瞒”
- v0.1 observer 虽然允许只读接入，但不应以静默降级掩盖真实运行状态
- 公网演示时，错误比假成功更可信

## 7. 建议实现顺序

1. 先补文档与 runbook
2. 先用测试锁定：
   - API base 不再误导远程访问
   - CORS 可接受显式公网 origin
   - 数据源切换行为与回退策略
3. 再实现前端/后端配置收敛
4. 再实现 `OpenClawObserverDataSource` 的最小骨架
5. 最后补验证与联调说明

---

## 8. 本阶段验收标准

### 公网联调
- 前端可在公网 IP / 域名下正确推导或读取 API base
- 后端允许显式配置的公网 origin 完成浏览器请求
- runbook 明确给出公网启动示例

### OpenClaw 只读接入
- 存在 `OpenClawObserverDataSource` 占位实现
- 可通过配置切换数据源
- 在不满足 OpenClaw 配置时，行为符合“开发可回退 / 公网禁静默回退”规则
- 现有 3 个 observer 接口契约不破坏
