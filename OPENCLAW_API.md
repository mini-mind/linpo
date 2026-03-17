# OpenClaw WebSocket API 参考

本文档整理了 OpenClaw Gateway 提供的 WebSocket RPC 方法，用于规划 Linpo 的 API 对接优先级。

> 来源：`/data/projects/openclaw/src/gateway/server-methods-list.ts` 及相关源码

---

## API 总览

| 分类 | 已实现 | v0.4 目标 | 未来版本 | 未计划 |
|-----|-------|----------|---------|-------|
| Chat | 2/4 | 2 | 0 | 0 |
| Session | 0/7 | 6 | 0 | 1 |
| Agent | 1/7 | 1 | 3 | 2 |
| Config | 0/5 | 1 | 0 | 4 |
| Health | 0/5 | 0 | 0 | 5 |
| Device/Pairing | 0/10 | 0 | 0 | 10 |
| Tools/Approval | 0/5 | 0 | 0 | 5 |
| Other | 0/10 | 1 | 0 | 9 |

**v0.4 目标**：对接 Chat + Session + Agent 管理 + Model 相关 API，实现完整的单实例控制能力。

---

## 1. Chat 相关

核心聊天控制 API，用于与 agent 进行交互。

| 方法 | 功能 | 参数 | 响应 | Linpo 状态 |
|-----|------|------|------|-----------|
| `chat.send` | 发送消息到 agent | `sessionKey`, `message`, `idempotencyKey`, `thinking?`, `attachments?` | `{ runId, status }` | ✅ 已实现 |
| `chat.abort` | 中断/停止 agent 运行 | `sessionKey`, `runId?` | `{ aborted, runIds }` | ✅ 已实现 (pause) |
| `chat.history` | 获取会话历史消息 | `sessionKey`, `limit?` | `{ sessionKey, sessionId, messages, thinkingLevel }` | ❌ v0.4 |
| `chat.inject` | 注入消息到会话（不触发 agent） | `sessionKey`, `message`, `label?` | `{ ok, messageId }` | ❌ v0.4 |

### chat.send 请求示例

```json
{
  "jsonrpc": "2.0",
  "id": "chat-1",
  "method": "chat.send",
  "params": {
    "sessionKey": "agent:main:main",
    "message": "写一个 Python 脚本",
    "idempotencyKey": "req-abc123",
    "thinking": "medium"
  }
}
```

### chat.abort 请求示例

```json
{
  "jsonrpc": "2.0",
  "id": "abort-1",
  "method": "chat.abort",
  "params": {
    "sessionKey": "agent:main:main"
  }
}
```

---

## 2. Session 管理

会话生命周期管理，每个会话对应一个对话上下文。

| 方法 | 功能 | 参数 | 响应 | Linpo 状态 |
|-----|------|------|------|-----------|
| `sessions.list` | 列出所有会话 | `agentId?`, `limit?`, `offset?` | `{ sessions, total }` | ❌ v0.4 |
| `sessions.preview` | 预览会话内容 | `keys[]`, `limit?`, `maxChars?` | `{ ts, previews[] }` | ❌ v0.4 |
| `sessions.patch` | 修改会话配置 | `key`, `agentId?`, `model?`, `thinking?` | `{ updated }` | ❌ v0.4 |
| `sessions.reset` | 重置会话（清空历史） | `key` | `{ reset }` | ❌ v0.4 |
| `sessions.delete` | 删除会话 | `key` | `{ deleted }` | ❌ v0.4 |
| `sessions.compact` | 压缩会话（减少存储） | `key` | `{ compacted, beforeSize, afterSize }` | ⚠️ 可选 |
| `sessions.resolve` | 解析会话 key | 各种解析参数 | `{ ok, key }` | ❌ 未计划 |

### sessions.list 请求示例

```json
{
  "jsonrpc": "2.0",
  "id": "sess-1",
  "method": "sessions.list",
  "params": {
    "agentId": "main",
    "limit": 50
  }
}
```

### sessions.list 响应示例

```json
{
  "id": "sess-1",
  "ok": true,
  "payload": {
    "sessions": [
      {
        "key": "agent:main:main",
        "agentId": "main",
        "model": "claude-sonnet-4",
        "createdAt": 1234567890000,
        "updatedAt": 1234567891000,
        "messageCount": 15
      }
    ],
    "total": 1
  }
}
```

---

## 3. Agent 管理

Agent 实例的创建、配置和管理。

| 方法 | 功能 | 参数 | 响应 | Linpo 状态 |
|-----|------|------|------|-----------|
| `agents.list` | 列出所有 agents | 无 | `{ agents[] }` | ✅ 观测模式 |
| `agents.create` | 创建新 agent | `agentId`, 配置参数 | `{ ok }` | ❌ 未计划 |
| `agents.update` | 更新 agent 配置 | `agentId`, 配置参数 | `{ ok }` | ❌ v0.4 (bindings) |
| `agents.delete` | 删除 agent | `agentId` | `{ ok }` | ❌ 未计划 |
| `agents.files.list` | 列出 agent 工作目录文件 | `agentId`, `path?` | `{ files[] }` | ❌ v0.8 |
| `agents.files.get` | 获取 agent 文件内容 | `agentId`, `name` | `{ content }` | ❌ v0.8 |
| `agents.files.set` | 设置 agent 文件内容 | `agentId`, `name`, `content` | `{ ok }` | ❌ v0.8 |

### Agent 绑定配置

Agent 的 `bindings` 配置包括：

```json
{
  "tools": ["read", "write", "exec", "search", "mcp-tool-1"],
  "resources": [
    { "type": "file", "path": "/workspace" },
    { "type": "api", "endpoint": "https://api.example.com" }
  ],
  "prompts": ["system-prompt"]
}
```

---

## 4. Agent 调用

直接与 agent 交互的方法。

| 方法 | 功能 | 参数 | 响应 | Linpo 状态 |
|-----|------|------|------|-----------|
| `agent` | 调用 agent（发送消息） | `message`, `sessionKey`, `runId` | 流式响应 | ⚠️ 类似 chat.send |
| `agent.identity.get` | 获取 agent 身份信息 | `agentId?` | `{ identity }` | ❌ 未计划 |
| `agent.wait` | 等待 agent 响应完成 | `runId`, `timeout?` | `{ ok }` | ❌ 未计划 |

---

## 5. 模型管理

查看和配置可用的 AI 模型。

| 方法 | 功能 | 参数 | 响应 | Linpo 状态 |
|-----|------|------|------|-----------|
| `models.list` | 列出可用模型 | 无 | `{ models[] }` | ❌ v0.4 |

### models.list 响应示例

```json
{
  "id": "models-1",
  "ok": true,
  "payload": {
    "models": [
      { "id": "claude-sonnet-4", "provider": "anthropic", "name": "Claude Sonnet 4" },
      { "id": "gpt-4o", "provider": "openai", "name": "GPT-4o" }
    ]
  }
}
```

---

## 6. 配置管理

Gateway 和 agent 配置管理。

| 方法 | 功能 | 参数 | 响应 | Linpo 状态 |
|-----|------|------|------|-----------|
| `config.get` | 获取配置 | `path?` | `{ config }` | ❌ 未计划 |
| `config.set` | 设置配置 | `config` | `{ ok }` | ❌ 未计划 |
| `config.patch` | 更新配置 | `updates` | `{ ok }` | ❌ v0.4 |
| `config.schema` | 获取配置 schema | `path?` | `{ schema }` | ❌ 未计划 |
| `config.apply` | 应用配置变更 | 无 | `{ ok }` | ❌ 未计划 |

---

## 7. 健康与状态

系统监控和诊断。

| 方法 | 功能 | 参数 | 响应 | Linpo 状态 |
|-----|------|------|------|-----------|
| `health` | 健康检查 | 无 | `{ status }` | ❌ 未计划 |
| `status` | 系统状态 | 无 | `{ status }` | ❌ 未计划 |
| `doctor.memory.status` | 内存诊断状态 | 无 | `{ status }` | ❌ 未计划 |
| `usage.status` | 使用状态 | 无 | `{ usage }` | ❌ 未计划 |
| `usage.cost` | 使用成本 | `period?` | `{ cost }` | ❌ 未计划 |

---

## 8. 设备与配对

设备身份验证和配对流程。

| 方法 | 功能 | Linpo 状态 |
|-----|------|-----------|
| `node.pair.request` | 请求节点配对 | ❌ 未计划 |
| `node.pair.list` | 列出配对请求 | ❌ 未计划 |
| `node.pair.approve` | 批准配对请求 | ❌ 未计划 |
| `node.pair.reject` | 拒绝配对请求 | ❌ 未计划 |
| `node.pair.verify` | 验证配对状态 | ❌ 未计划 |
| `node.list` | 列出节点 | ❌ 未计划 |
| `node.describe` | 描述节点 | ❌ 未计划 |
| `node.rename` | 重命名节点 | ❌ 未计划 |
| `device.pair.list` | 列出设备配对 | ❌ 未计划 |
| `device.pair.approve` | 批准设备配对 | ❌ 未计划 |
| `device.pair.reject` | 拒绝设备配对 | ❌ 未计划 |
| `device.pair.remove` | 移除设备配对 | ❌ 未计划 |
| `device.token.rotate` | 轮换设备 token | ❌ 未计划 |
| `device.token.revoke` | 撤销设备 token | ❌ 未计划 |

---

## 9. 工具与审批

工具执行审批流程。

| 方法 | 功能 | Linpo 状态 |
|-----|------|-----------|
| `tools.catalog` | 工具目录 | ❌ 未计划 |
| `exec.approvals.get` | 获取执行审批配置 | ❌ 未计划 |
| `exec.approvals.set` | 设置执行审批配置 | ❌ 未计划 |
| `exec.approval.request` | 请求执行审批 | ❌ 未计划 |
| `exec.approval.resolve` | 解决执行审批 | ❌ 未计划 |

---

## 10. 消息发送

向外部 channel 发送消息。

| 方法 | 功能 | 参数 | 响应 | Linpo 状态 |
|-----|------|------|------|-----------|
| `send` | 发送消息到 channel | `to`, `message`, `channel`, `idempotencyKey` | `{ ok }` | ❌ 未计划 |

---

## 11. 其他 API

| 方法 | 功能 | Linpo 状态 |
|-----|------|-----------|
| `channels.status` | Channel 状态 | ❌ 未计划 |
| `channels.logout` | Channel 登出 | ❌ 未计划 |
| `tts.status` | TTS 状态 | ❌ 未计划 |
| `tts.providers` | TTS 提供商列表 | ❌ 未计划 |
| `tts.convert` | TTS 转换 | ❌ 未计划 |
| `voicewake.get` | 语音唤醒配置 | ❌ 未计划 |
| `voicewake.set` | 设置语音唤醒 | ❌ 未计划 |
| `secrets.reload` | 重载密钥 | ❌ 未计划 |
| `secrets.resolve` | 解析密钥引用 | ❌ 未计划 |
| `skills.status` | 技能状态 | ❌ 未计划 |
| `skills.install` | 安装技能 | ❌ 未计划 |
| `skills.update` | 更新技能 | ❌ 未计划 |
| `update.run` | 运行更新 | ❌ 未计划 |
| `cron.list` | 列出定时任务 | ❌ 未计划 |
| `cron.add` | 添加定时任务 | ❌ 未计划 |
| `cron.remove` | 移除定时任务 | ❌ 未计划 |
| `cron.run` | 运行定时任务 | ❌ 未计划 |
| `logs.tail` | 日志流 | ❌ 未计划 |
| `wizard.start` | 启动向导 | ❌ 未计划 |
| `wizard.next` | 向导下一步 | ❌ 未计划 |
| `wizard.cancel` | 取消向导 | ❌ 未计划 |
| `browser.request` | 浏览器请求 | ❌ 未计划 |
| `talk.config` | Talk 配置 | ❌ 未计划 |
| `talk.mode` | Talk 模式 | ❌ 未计划 |

---

## 12. 事件类型

OpenClaw Gateway 广播的事件类型。

| 事件 | 说明 | Linpo 使用 |
|-----|------|-----------|
| `connect.challenge` | 连接挑战（配对） | ✅ 已处理 |
| `agent` | Agent 响应块（流式） | ✅ 已使用 |
| `chat` | Chat 会话更新 | ✅ 已使用 |
| `presence` | 系统在线状态 | ✅ 已使用 |
| `tick` | Gateway 心跳 | ✅ 已使用 |
| `health` | 健康状态更新 | ✅ 已使用 |
| `shutdown` | Gateway 关闭通知 | ⚠️ 可选处理 |
| `heartbeat` | 客户端心跳 | ⚠️ 可选处理 |
| `talk.mode` | 语音模式变更 | ❌ 未使用 |
| `cron` | 定时任务状态 | ❌ 未使用 |
| `node.pair.requested` | 节点配对请求 | ❌ 未使用 |
| `node.pair.resolved` | 节点配对解决 | ❌ 未使用 |
| `device.pair.requested` | 设备配对请求 | ❌ 未使用 |
| `device.pair.resolved` | 设备配对解决 | ❌ 未使用 |
| `voicewake.changed` | 语音唤醒变更 | ❌ 未使用 |
| `exec.approval.requested` | 执行审批请求 | ❌ 未使用 |
| `exec.approval.resolved` | 执行审批解决 | ❌ 未使用 |
| `update.available` | 更新可用 | ❌ 未使用 |

---

## v0.4 对接优先级

### P0 - 核心功能（必须实现）

1. `sessions.list` - 会话列表
2. `sessions.preview` - 会话预览
3. `sessions.patch` - 切换 agent/model
4. `sessions.reset` - 重置会话
5. `sessions.delete` - 删除会话
6. `chat.history` - 会话历史
7. `models.list` - 模型列表

### P1 - 增强功能（应该实现）

1. `chat.inject` - 注入消息
2. `agents.update` - 更新 agent 配置（bindings）
3. `config.patch` - 更新配置

### P2 - 可选功能（有时间再实现）

1. `sessions.compact` - 压缩会话
2. `usage.status` - 使用状态
3. `health` - 健康检查

---

## 参考资料

- OpenClaw WebSocket 协议文档：https://openclaw-openclaw.mintlify.app/api/websocket
- OpenClaw Sessions API：https://openclaw-openclaw.mintlify.app/api/sessions
- OpenClaw 源码：`/data/projects/openclaw/src/gateway/server-methods/`