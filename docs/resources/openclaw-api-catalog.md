# OpenClaw WebSocket API 参考（v0.6 口径）

> 用途：保留 OpenClaw 全量接口清单（含未接入项），并明确 Linpo v0.6 在后端适配层的真实接入状态。  
> 口径日期：2026-03-25。  
> 判定依据：`app/adapters/openclaw_adapter.py`、`app/services/openclaw_client.py`、`app/services/provider_application_service.py`、`app/api/agents.py`、`app/services/observer_data.py`。

本文档整理 OpenClaw Gateway 的 WebSocket RPC 与事件，并按 v0.6 实现状态标注，避免把“历史规划状态”误当作现状。

## 状态标记

- `✅ 已接入（Adapter）`：已进入 `ProviderAdapter/OpenClawAdapter` 主链路，并可被 v0.6 业务调用。
- `✅ 已接入（Adapter+HTTP）`：在上条基础上，已有 HTTP 路由对外暴露。
- `🟨 Client 已实现`：仅在 `OpenClawClient` 或 Operator Service 中存在调用代码，未进入 Adapter 主链路。
- `❌ 未接入`：仓库内无对应实现或未打通到可用链路。
- `↔️ 等价能力`：未调用同名 RPC，但通过 snapshot/realtime 等方式提供相近能力。

## v0.6 已接入 RPC（按适配层）

- `models.list`（并已对外：`GET /chat/models`）
- `sessions.list`（并已对外：`GET /chat/sessions`）
- `sessions.preview`（并已对外：`GET /chat/sessions/preview`）
- `sessions.patch`（并已对外：`PATCH /chat/sessions/{key}`）

## 1. Chat 相关

| 方法 | 功能 | Linpo v0.6 状态 | 说明 |
|---|---|---|---|
| `chat.send` | 发送消息到 agent | 🟨 Client 已实现 | `OpenClawClient` 有请求构造与发送，但未进入 Adapter/API 主链路 |
| `chat.abort` | 中断/停止 agent 运行 | 🟨 Client 已实现 | 用于 pause 控制链路，但未作为公共 Adapter 能力对外 |
| `chat.history` | 获取会话历史消息 | ❌ 未接入 | 无对应实现 |
| `chat.inject` | 注入消息到会话（不触发 agent） | ❌ 未接入 | 无对应实现 |

## 2. Session 管理

| 方法 | 功能 | Linpo v0.6 状态 | 说明 |
|---|---|---|---|
| `sessions.list` | 列出会话 | ✅ 已接入（Adapter+HTTP） | 适配层已封装，HTTP 已暴露 |
| `sessions.preview` | 预览会话内容 | ✅ 已接入（Adapter+HTTP） | 适配层已封装，HTTP 已暴露 |
| `sessions.patch` | 修改会话配置 | ✅ 已接入（Adapter+HTTP） | 适配层已封装，HTTP 已暴露 |
| `sessions.reset` | 重置会话 | 🟨 Client 已实现 | `OpenClawClient` 有方法，未进入 Adapter/API 主链路 |
| `sessions.delete` | 删除会话 | 🟨 Client 已实现 | `OpenClawClient` 有方法，未进入 Adapter/API 主链路 |
| `sessions.compact` | 压缩会话 | ❌ 未接入 | 无对应实现 |
| `sessions.resolve` | 解析会话 key | ❌ 未接入 | 无对应实现 |

## 3. Agent 管理

| 方法 | 功能 | Linpo v0.6 状态 | 说明 |
|---|---|---|---|
| `agents.list` | 列出所有 agents | ↔️ 等价能力 | 未调用该 RPC；通过 snapshot + realtime 映射得到 agents 列表 |
| `agents.create` | 创建新 agent | ❌ 未接入 | 无对应实现 |
| `agents.update` | 更新 agent 配置 | ❌ 未接入 | 无对应实现 |
| `agents.delete` | 删除 agent | ❌ 未接入 | 无对应实现 |
| `agents.files.list` | 列出 agent 文件 | ❌ 未接入 | 无对应实现 |
| `agents.files.get` | 获取 agent 文件内容 | ❌ 未接入 | 无对应实现 |
| `agents.files.set` | 设置 agent 文件内容 | ❌ 未接入 | 无对应实现 |

## 4. Agent 调用

| 方法 | 功能 | Linpo v0.6 状态 | 说明 |
|---|---|---|---|
| `agent` | 直接调用 agent | ❌ 未接入 | 未调用该 RPC；`agent` 事件仅用于流式消息消费 |
| `agent.identity.get` | 获取 agent 身份信息 | ❌ 未接入 | 无对应实现 |
| `agent.wait` | 等待 agent 完成 | ❌ 未接入 | 无对应实现 |

## 5. 模型管理

| 方法 | 功能 | Linpo v0.6 状态 | 说明 |
|---|---|---|---|
| `models.list` | 列出可用模型 | ✅ 已接入（Adapter+HTTP） | 适配层已封装，HTTP 已暴露 |

## 6. 配置管理

| 方法 | 功能 | Linpo v0.6 状态 |
|---|---|---|
| `config.get` | 获取配置 | ❌ 未接入 |
| `config.set` | 设置配置 | ❌ 未接入 |
| `config.patch` | 更新配置 | ❌ 未接入 |
| `config.schema` | 获取配置 schema | ❌ 未接入 |
| `config.apply` | 应用配置变更 | ❌ 未接入 |

## 7. 健康与状态

| 方法 | 功能 | Linpo v0.6 状态 | 说明 |
|---|---|---|---|
| `health` | OpenClaw 健康检查 | ↔️ 等价能力 | 未直接调用该 RPC；消费 snapshot 的 `health` 字段 |
| `status` | OpenClaw 系统状态 | ❌ 未接入 | 无对应实现 |
| `doctor.memory.status` | 内存诊断状态 | ❌ 未接入 | 无对应实现 |
| `usage.status` | 使用状态 | ❌ 未接入 | 无对应实现 |
| `usage.cost` | 使用成本 | ❌ 未接入 | 无对应实现 |

## 8. 设备与配对

| 方法 | 功能 | Linpo v0.6 状态 |
|---|---|---|
| `node.pair.request` | 请求节点配对 | ❌ 未接入 |
| `node.pair.list` | 列出配对请求 | ❌ 未接入 |
| `node.pair.approve` | 批准配对请求 | ❌ 未接入 |
| `node.pair.reject` | 拒绝配对请求 | ❌ 未接入 |
| `node.pair.verify` | 验证配对状态 | ❌ 未接入 |
| `node.list` | 列出节点 | ❌ 未接入 |
| `node.describe` | 描述节点 | ❌ 未接入 |
| `node.rename` | 重命名节点 | ❌ 未接入 |
| `device.pair.list` | 列出设备配对 | ❌ 未接入 |
| `device.pair.approve` | 批准设备配对 | ❌ 未接入 |
| `device.pair.reject` | 拒绝设备配对 | ❌ 未接入 |
| `device.pair.remove` | 移除设备配对 | ❌ 未接入 |
| `device.token.rotate` | 轮换设备 token | ❌ 未接入 |
| `device.token.revoke` | 撤销设备 token | ❌ 未接入 |

## 9. 工具与审批

| 方法 | 功能 | Linpo v0.6 状态 |
|---|---|---|
| `tools.catalog` | 工具目录 | ❌ 未接入 |
| `exec.approvals.get` | 获取执行审批配置 | ❌ 未接入 |
| `exec.approvals.set` | 设置执行审批配置 | ❌ 未接入 |
| `exec.approval.request` | 请求执行审批 | ❌ 未接入 |
| `exec.approval.resolve` | 解决执行审批 | ❌ 未接入 |

## 10. 消息发送

| 方法 | 功能 | Linpo v0.6 状态 |
|---|---|---|
| `send` | 发送消息到 channel | ❌ 未接入 |

## 11. 其他 API

| 方法 | 功能 | Linpo v0.6 状态 |
|---|---|---|
| `channels.status` | Channel 状态 | ❌ 未接入 |
| `channels.logout` | Channel 登出 | ❌ 未接入 |
| `tts.status` | TTS 状态 | ❌ 未接入 |
| `tts.providers` | TTS 提供商列表 | ❌ 未接入 |
| `tts.convert` | TTS 转换 | ❌ 未接入 |
| `voicewake.get` | 语音唤醒配置 | ❌ 未接入 |
| `voicewake.set` | 设置语音唤醒 | ❌ 未接入 |
| `secrets.reload` | 重载密钥 | ❌ 未接入 |
| `secrets.resolve` | 解析密钥引用 | ❌ 未接入 |
| `skills.status` | 技能状态 | ❌ 未接入 |
| `skills.install` | 安装技能 | ❌ 未接入 |
| `skills.update` | 更新技能 | ❌ 未接入 |
| `update.run` | 运行更新 | ❌ 未接入 |
| `cron.list` | 列出定时任务 | ❌ 未接入 |
| `cron.add` | 添加定时任务 | ❌ 未接入 |
| `cron.remove` | 移除定时任务 | ❌ 未接入 |
| `cron.run` | 运行定时任务 | ❌ 未接入 |
| `logs.tail` | 日志流 | ❌ 未接入 |
| `wizard.start` | 启动向导 | ❌ 未接入 |
| `wizard.next` | 向导下一步 | ❌ 未接入 |
| `wizard.cancel` | 取消向导 | ❌ 未接入 |
| `browser.request` | 浏览器请求 | ❌ 未接入 |
| `talk.config` | Talk 配置 | ❌ 未接入 |
| `talk.mode` | Talk 模式 | ❌ 未接入 |

## 12. 事件类型（v0.6 实际消费）

| 事件 | Linpo v0.6 状态 | 说明 |
|---|---|---|
| `connect.challenge` | ✅ 已处理 | 握手 challenge |
| `chat` | ✅ 已使用 | 用于 control request 状态确认 |
| `agent.summary.updated` | ✅ 已使用 | 映射 agent summary 更新 |
| `agent.updated` | ✅ 已使用 | 映射 agent summary 更新 |
| `health.agent.updated` | ✅ 已使用 | 映射 agent summary 更新 |
| `topology_updated` | ✅ 已使用 | 映射拓扑节点更新 |
| `node_events_appended` | ✅ 已使用 | 映射节点事件追加 |
| `agent` | ✅ 已使用 | 仅消费 assistant 流文本片段 |
| `presence` | 🟨 仅 snapshot 字段消费 | 未见 realtime 同名事件分支 |
| `health` | 🟨 仅 snapshot 字段消费 | 未见 realtime `health` 事件分支 |
| `tick` | ❌ 未使用 | 无消费分支 |
| `shutdown` | ❌ 未使用 | 无消费分支 |
| `heartbeat` | ❌ 未使用 | 无消费分支 |
| `talk.mode` | ❌ 未使用 | 无消费分支 |
| `cron` | ❌ 未使用 | 无消费分支 |
| `node.pair.requested` | ❌ 未使用 | 无消费分支 |
| `node.pair.resolved` | ❌ 未使用 | 无消费分支 |
| `device.pair.requested` | ❌ 未使用 | 无消费分支 |
| `device.pair.resolved` | ❌ 未使用 | 无消费分支 |
| `voicewake.changed` | ❌ 未使用 | 无消费分支 |
| `exec.approval.requested` | ❌ 未使用 | 无消费分支 |
| `exec.approval.resolved` | ❌ 未使用 | 无消费分支 |
| `update.available` | ❌ 未使用 | 无消费分支 |

## 13. 代码对照锚点

- 适配层接口定义：`app/adapters/openclaw_adapter.py`
- OpenClaw RPC 请求构造：`app/services/openclaw_client.py`
- 业务编排入口：`app/services/provider_application_service.py`
- 对外 HTTP 路由：`app/api/agents.py`
- realtime 事件映射：`app/services/observer_data.py`

## 参考资料

- OpenClaw WebSocket 协议文档：https://openclaw-openclaw.mintlify.app/api/websocket
- OpenClaw Sessions API：https://openclaw-openclaw.mintlify.app/api/sessions
- OpenClaw 源码：`/data/projects/openclaw/src/gateway/server-methods/`
