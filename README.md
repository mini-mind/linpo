# 灵盘（Linpo）

灵盘（Linpo）是一个从小功能闭环起步、逐步成长的平台型项目。

当前产品方向已切换为：

> **面向人类的 agent 运行观测入口：用户登录后可以查看自己的 agents，并进入单个 agent 的拓扑视图，观察其与 subagents 的结构关系、活跃状态与历史事件。**

当前仓库已完成一次项目级重置：旧版 roboard 的实现、设计与配置已迁出当前仓库根目录，仅作为仓库外本地归档参考，不再作为当前项目的权威来源。

开发阶段域名暂定为：`linpo.duckdns.org`

## 开发环境

| 机器 | IP | 用途 |
|------|-----|------|
| 本机 | `175.178.213.10` | Linpo 服务端（前端 5173，后端 8000） |
| ravin | `68.64.179.125` | 远程客户端联调（SSH: `ravin@68.64.179.125`） |

### 本机 OpenClaw 实例

| 名称 | 端口 | Token |
|------|------|-------|
| claw1 | 18789 | `lhdWYU1MGLCWNwbHaQsIjlPkiSt5LKhEh9PjAtElrlE` |
| claw2 | 28789 | `ZUE 6oLmaH2DEuC3A3mJYe_l-q3yLOqVSLiLsAGfmJQ` |
| claw3 | 38789 | (查看容器环境变量) |

## 当前阶段

- **当前稳定基线**：v0.4 单实例控制完善已完成
- **v0.4 核心能力**：session 管理 + model 切换 + realtime 状态闭环
- **公网访问**：前端 `http://175.178.213.10:5173`，后端 `http://175.178.213.10:8000`

## 版本路线

```
v0.1 ─ Observer 起点（已完成）
v0.2 ─ Realtime Observer（已完成）
v0.3 ─ 单实例控制接入验证（已完成）
v0.4 ─ 单实例控制完善（已完成）← 当前基线
v0.5 ─ 用户模型 + 实例配置
v0.6 ─ 多实例聚合视图
v0.7 ─ 跨实例消息传递
```

## v0.4 功能清单

v0.4 单实例控制完善，在 v0.3 基础上新增以下能力：

### 会话列表
- **API**: `GET /chat/sessions` - 获取当前 agent 的所有会话列表
- **前端**: SessionList 组件，支持会话列表展示与选择

### 消息预览
- **API**: `GET /chat/sessions/preview` - 获取会话消息预览
- **前端**: 预览 UI，展示会话最近消息摘要

### 模型切换
- **API**: `GET /chat/models` - 获取可用模型列表；`PATCH /chat/sessions/{key}` - 切换会话模型
- **前端**: ModelSelector 组件，支持桌面端与移动端模型选择

### 会话管理
- **API**: `POST /chat/sessions/{key}/reset` - 重置会话；`DELETE /chat/sessions/{key}` - 删除会话
- **前端**: SessionActions 组件，提供重置与删除操作入口

### 控制状态完善
- 细化控制响应状态：`applied`（已应用）、`timeout`（超时）
- 细化错误类型：`no_active_chat`、`no_operator`、`send_failed` 等

## v0.3 控制功能

### Pause 控制

**问题**：Pause 控制需要 agent 有活跃的 chat session，否则返回 `failed`。

**解决方案**：通过 OpenClaw WebSocket API 创建活跃 chat：

```python
import asyncio, json, uuid, websockets

TOKEN = "从进程环境获取"  # cat /proc/$(pgrep uvicorn)/environ | tr '\0' '\n' | grep OPENCLAW_GATEWAY_TOKEN

async def create_chat():
    async with websockets.connect("ws://127.0.0.1:28789", origin="http://127.0.0.1:28789") as ws:
        await ws.recv()  # challenge
        await ws.send(json.dumps({
            "type": "req", "id": "connect-1", "method": "connect",
            "params": {
                "minProtocol": 3, "maxProtocol": 3,
                "client": {"id": "openclaw-control-ui", "displayName": "linpo-operator", "version": "0.1.0", "mode": "webchat", "platform": "linux"},
                "auth": {"token": TOKEN},
                "role": "operator", "scopes": ["operator.admin", "operator.write"]
            }
        }))
        if not json.loads(await ws.recv()).get("ok"): return
        await ws.send(json.dumps({
            "type": "req", "id": "chat-1", "method": "chat.send",
            "params": {"sessionKey": "agent:main:main", "idempotencyKey": str(uuid.uuid4()), "message": "写一篇500字的文章"}
        }))
        print("Chat started - now test Pause in Linpo UI")

asyncio.run(create_chat())
```

### Send Message 控制

**API**: `POST /agents/{agent_id}/send-message?data_source=openclaw`

**请求体**:
```json
{"message": "你的消息内容"}
```

**响应**:
```json
{
  "request_id": "control-xxx",
  "agent_id": "main",
  "status": "accepted",  // 或 "failed", "timeout"
  "message": null
}
```

**前提条件**：
- agent 需要有活跃的 chat session
- 需要 OpenClaw 配置正确的 operator 权限

### 接入新实例

**版本规划**：接入新实例（配置 endpoint、名称、类型）属于 **v0.5 用户模型 + 实例配置基础** 阶段。

当前 v0.3 只面向**单实例、受信环境、单操作者**验证，不包含多实例配置功能。

## 文档入口

| 文档 | 路径 | 说明 |
|------|------|------|
| 产品需求（含版本路线） | `docs/prd/2026-03-15-linpo-v0.1-observer-prd.md` | 当前有效的产品边界与版本演进路线 |
| v0.3 控制接入计划 | `docs/plans/2026-03-17-linpo-v0.3-single-agent-control-plan.md` | v0.3 最小控制闭环验证（已完成） |
| **v0.4 控制完善计划** | `docs/plans/2026-03-18-linpo-v0.4-single-instance-control-completion-plan.md` | v0.4 单实例控制完善（已完成） |
| **OpenClaw API 参考** | `OPENCLAW_API.md` | OpenClaw WebSocket API 完整清单，v0.4 对接依据 |
| v0.1 架构边界 | `docs/architecture/2026-03-15-observer-architecture.md` | observer 架构边界与后续演进参考 |
| v0.2 demo runbook | `docs/plans/2026-03-16-observer-demo-runbook.md` | 当前 realtime observer 主路径的本地演示与联调检查说明 |
| 仓库治理 | `AGENTS.md` | 当前项目治理规则 |

## 当前技术原理（极简）
- 前端不直接连接 OpenClaw，只请求 Linpo 后端的 3 个 observer 只读接口：`/agents`、`/agents/{agent_id}`、`/agents/{agent_id}/nodes/{node_id}`。
- 后端在选择 `openclaw` 数据源时，会作为只读 WebSocket client 连接 OpenClaw gateway，按 `connect.challenge -> connect -> hello-ok` 完成最小握手。
- 当前监控数据主要来自 `hello-ok` 内的 `snapshot.health` 与 `snapshot.presence`，然后被映射成 Linpo 的最小 read model：`Agent`、`TopologyNode`、`EventRecord`。
- 在 v0.2 realtime observer 中，浏览器通过 Linpo 的 WebSocket 通道消费增量事件，并以短时 buffer + `resync_required` 维持状态收敛。
- OpenClaw 失败时不会静默回退到 stub；会直接返回明确错误，避免把假数据伪装成真实运行状态。

## 当前原则
- 先做最小观测入口，再扩张平台能力
- 先定文档，再做实现
- 不复用旧 roboard 的平台世界观作为当前约束
- 不在方向未冻结前预建大而全的代码骨架

