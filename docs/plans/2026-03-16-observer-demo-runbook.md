# Linpo v0.2 Realtime Observer Demo Runbook

> **状态**：手动演示与联调准备文档
>
> **适用阶段**：v0.2 realtime observer 增量收敛

## 1. 文档目的

本 runbook 用于支持两类场景：

1. 本地手动演示当前 observer 主路径
2. 为 OpenClaw realtime 接入后的联调提供统一检查基线

当前文档只覆盖 observer-only 主路径，不覆盖控制面或外部协议写操作。

---

## 2. 当前 v0.2 主路径

手动演示时，优先验证以下主路径：

1. 打开 agents 列表页
2. 观察列表页通过 HTTP 快照完成首次渲染
3. 观察列表页建立 `agents:list` realtime 订阅
4. 在 OpenClaw 有 agent summary 变化时，列表页状态可增量更新
5. 进入某个 agent 详情页，继续验证当前快照主路径（detail realtime 仍按当前实现边界检查）

当前已落地的 realtime 范围：

- `agents:list`
  - `stub`：支持
  - `openclaw`：支持
- `agent:{agent_id}:detail`
  - `stub`：支持
  - `openclaw`：支持（当前最小事件集：`topology_updated` / `node_events_appended`）

---

## 3. 后端启动

在仓库根目录执行：

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

若验证 OpenClaw realtime，使用：

```bash
OPENCLAW_BASE_URL=ws://127.0.0.1:28789 \
OPENCLAW_GATEWAY_TOKEN=<token> \
OPENCLAW_ORIGIN=http://127.0.0.1:28789 \
LINPO_OBSERVER_DATA_SOURCE=openclaw \
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

期望：

- 本地监听 `http://127.0.0.1:8000`
- `GET /health` 返回 200
- `GET /agents?data_source=openclaw` 能返回真实快照
- `/ws/observer?data_source=openclaw` 能接受 `agents:list` 订阅

可选检查：

```bash
curl http://127.0.0.1:8000/health
curl "http://127.0.0.1:8000/agents?data_source=openclaw"
```

---

## 4. 前端启动

在 `frontend/` 目录执行：

```bash
npm install
npm run dev
```

默认开发地址：

- `http://127.0.0.1:5173`

前端 API 地址规则：

- 若设置 `VITE_API_BASE_URL`，则使用该值
- 若未设置，则前端按当前页面 host 推导为 `<当前协议>//<当前主机>:8000`
- 默认 observer data source 为 `openclaw`

如需显式指定：

```bash
VITE_API_BASE_URL=http://127.0.0.1:8000 npm run dev
```

---

## 5. 手动检查表

### 5.1 Agents 列表页（OpenClaw realtime）

访问：

- `http://127.0.0.1:5173/`

检查：

- 页面显示 `Agents`
- 列表能先显示 HTTP 快照结果
- 页面 meta 区显示：`Realtime (openclaw): reconnecting`，随后进入 `realtime`
- 当 OpenClaw 上游 agent summary 有变化时，列表项的 `status` / `is_active` / `last_active_at` 能增量更新

### 5.2 Agent 详情页（OpenClaw detail realtime）

访问示例：

- `http://127.0.0.1:5173/agents/main`

检查：

- 页面显示 agent 名称
- 页面 meta 区在建立订阅后进入 `realtime`
- 当 OpenClaw 上游发送 topology 增量时，详情页 header 与拓扑节点状态同步更新
- `resync_required` 时会回退 HTTP 重拉，而不是静默失效
- 上游 `error` 或 websocket 非预期关闭时，界面显式显示 `error` / `disconnected`

### 5.3 Node 详情侧栏（OpenClaw detail realtime）

在详情页点击任意节点后检查：

- 侧栏标题为 `Node Details`
- 显示名称、状态、Active、Last Active
- 当 OpenClaw 上游发送 `node_events_appended` 时，事件列表增量追加
- `resync_required` 时会回退 `getNodeDetail()` 重拉
- 上游 `error` 或 websocket 非预期关闭时，界面显式暴露错误

---

## 6. Realtime 验证矩阵

| 页面 / 频道 | stub | openclaw | 当前期望 |
|---|---|---|---|
| `/` / `agents:list` | 支持 | 支持 | 应看到 `snapshot_ready` 后进入 `realtime` |
| `/agents/:agentId` / `agent:{agent_id}:detail` | 支持 | 支持（最小事件集） | 应消费 `topology_updated`，并在 `resync_required` / `error` / `disconnected` 下显式收敛 |
| `NodeDetailPanel` / `agent:{agent_id}:detail` | 支持 | 支持（最小事件集） | 应消费 `node_events_appended`，并在 `resync_required` / `error` / `disconnected` 下显式收敛 |

### 6.1 浏览器实时状态文案

当前前端允许出现以下状态：

- `realtime`
- `reconnecting`
- `resyncing`
- `disconnected`
- `error`

### 6.2 失败路径检查

至少手动确认以下 4 条：

1. 上游 OpenClaw token 缺失或错误时，HTTP 快照显式报错
2. `agents:list` realtime 上游异常时，前端进入 `error`
3. websocket 非预期关闭时，前端进入 `disconnected`
4. `last_seq` 失效时，后端返回 `resync_required`，前端回退 HTTP 重拉

---

## 7. 自动化验证对照

当前应至少保证以下测试通过：

### 后端

```bash
./.venv/bin/python -m pytest tests/test_observer_realtime_state.py tests/integration/test_observer_ws.py -q
```

应覆盖：

- event buffer replay / `resync_required`
- openclaw shared source 生命周期
- openclaw `agents:list` realtime 主路径
- 上游失败显式 `error`
- detail 频道在 openclaw 下的前置拒绝

### 前端

```bash
cd frontend
npm run test -- src/api/realtimeClient.test.ts src/components/AgentsList.test.ts src/components/AgentDetail.test.ts src/components/NodeDetailPanel.test.ts
```

应覆盖：

- `openclaw + agents:list` websocket 建连
- `openclaw + agent:{agent_id}:detail` websocket 建连
- `snapshot_ready` / `agent_summary_updated` / `topology_updated` / `node_events_appended` / `resync_required` / `error` / `disconnected`
- 列表页、详情页、节点侧栏默认 openclaw bridge 真接线验证

---

## 8. 当前真实数据接入边界

当前已确认的 OpenClaw 单实例基线：

- 网关：`ws://127.0.0.1:28789`
- 鉴权：`OPENCLAW_GATEWAY_TOKEN`
- 协议版本：`3`
- 推荐 Origin：`OPENCLAW_ORIGIN=http://127.0.0.1:28789`

当前明确不在本 runbook 中推进：

- detail realtime 的 OpenClaw 全量建模
- 控制按钮
- agent 启停
- workspace 编辑
- 任何写操作（如 `chat.send`、`sessions.delete`）
- 用户直连 OpenClaw
- Redis / Kafka / 持久化消息总线

---

## 9. 失败时排查顺序

1. 先检查后端 `/health`
2. 再检查 `GET /agents?data_source=openclaw` 是否可返回 JSON
3. 再检查 `OPENCLAW_GATEWAY_TOKEN` / `OPENCLAW_BASE_URL` / `OPENCLAW_ORIGIN`
4. 再检查浏览器是否成功连接 `/ws/observer?data_source=openclaw`
5. 若首页正常但详情页报错，先确认这是否属于当前未完成的 openclaw detail realtime 边界
6. 最后再看浏览器控制台与后端日志

---

## 10. 远程客户端联调记录（ravin）

当前指定的远程联调客户端为：

- `ravin@68.64.179.125`

用途边界：

- `ravin` 在当前阶段作为**远程客户端**使用
- 用于从远端网络路径访问 Linpo 已运行的前后端服务，验证 HTTP / WebSocket / 浏览器主路径
- 不作为当前 runbook 的部署目标机
- 不在 `ravin` 上执行 Linpo 部署、迁移或服务编排

建议联调方式：

1. 在 Linpo 服务端按本 runbook 第 3 / 4 节先启动后端与前端
2. 从 `ravin` 发起远程请求，优先验证：
   - `curl <Linpo服务地址>/health`
   - `curl "<Linpo服务地址>/agents?data_source=openclaw"`
   - 从远端浏览器打开列表页与详情页
3. 如需验证 WebSocket，可从 `ravin` 上使用浏览器或 websocket CLI 连到：
   - `<Linpo服务地址>/ws/observer?data_source=openclaw`
4. 若远端失败而本地成功，优先排查：
   - 服务监听地址是否为 `0.0.0.0`
   - 远端访问使用的 host / port 是否正确
   - `VITE_API_BASE_URL` 或前端推导出的 API base 是否仍指向错误主机
   - `LINPO_CORS_ALLOW_ORIGINS` 是否包含远端页面来源

本节只记录远程客户端入口与使用边界；不替代服务端部署文档。

---

## 11. 本轮联调结论（2026-03-16）

本轮已完成一次基于 `ravin` 的真实远程联调，验证目标为 Linpo v0.2 realtime observer 在公网/远端网络路径下的最小闭环。

### 已验证通过

- `ravin` 到 Linpo 后端 `GET /health` 可达
- `ravin` 到 Linpo 后端 `GET /agents?data_source=openclaw` 可返回真实快照
- 远端浏览器可打开列表页 `/` 并显示 `Realtime (openclaw): realtime`
- 远端浏览器可打开详情页 `/agents/main` 并显示 `Realtime (openclaw): realtime`
- 远端浏览器可看到 `Topology`、`Node Details`、`Status` 与事件历史
- 远端 Playwright smoke 结果中：
  - `consoleErrors = []`
  - `requestFailures = []`

### 本轮暴露并修复的问题

1. 初始使用 `linpo.duckdns.org` 进行联调时，请求命中了 `68.64.179.125`，与当前 Linpo 服务机 `175.178.213.10` 不一致，导致公网入口不可达
2. 在当前 FastAPI / Starlette / uvicorn 运行栈下，全局 `CORSMiddleware` 会让 `/ws/observer` 握手直接返回 `403`
3. 修复方式：
   - 保持前端与后端公网访问路径指向当前 Linpo 服务机
   - 将 `app/main.py` 中的全局 `CORSMiddleware` 替换为仅处理 HTTP 请求的最小 CORS 中间件，避免 websocket 握手被误拦截

### 本轮联调建议结论

- 当前 v0.2 realtime observer 已具备远程联调所需的最小闭环
- 如需重复验证，可继续复用 `ravin` 作为远端客户端执行 HTTP / WebSocket / Playwright smoke
- 后续若切回域名联调，应先确保域名解析与当前服务机地址一致

