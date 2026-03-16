# Linpo v0.1 Observer Demo Runbook

> **状态**：手动演示与联调准备文档
>
> **适用阶段**：v0.1 observer 最小闭环 / demo hardening

## 1. 文档目的

本 runbook 用于支持两类场景：

1. 本地手动演示当前 observer 主路径
2. 为后续真实数据接入前的手动联调准备统一检查基线

当前文档只覆盖 observer-only 主路径，不覆盖控制面或外部协议对接。

---

## 2. 当前主路径

手动演示时，只需要验证以下主路径：

1. 打开 agents 列表页
2. 进入某个 agent 详情页
3. 查看 root + subagents 的拓扑结构
4. 点击一个节点
5. 在右侧详情侧栏看到状态与事件历史

推荐使用样例 agent：

- `agent-root-observer`
- `agent-solo-archiver`

---

## 3. 后端启动

在仓库根目录执行：

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

期望：

- 本地监听 `http://127.0.0.1:8000`
- 公网联调时必须实际绑定 `0.0.0.0:8000`，不能只监听 `127.0.0.1:8000`
- `GET /health` 返回 200

可选检查：

```bash
curl http://127.0.0.1:8000/health
curl http://127.0.0.1:8000/agents
curl http://127.0.0.1:8000/agents/agent-root-observer
curl http://127.0.0.1:8000/agents/agent-root-observer/nodes/node-collector
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
- 若未设置，则前端会按当前页面 host 推导为 `<当前协议>//<当前主机>:8000`
- 因此公网访问时，不再误用访问者本机的 `localhost:8000`

如需显式指定：

```bash
VITE_API_BASE_URL=http://127.0.0.1:8000 npm run dev
```

如需公网联调示例：

```bash
VITE_API_BASE_URL=http://175.178.213.10:8000 npm run dev -- --host 0.0.0.0 --port 5173
```

注意：如果前端在公网可打开，但浏览器访问 `http://175.178.213.10:8000/...` 出现 `ERR_CONNECTION_REFUSED`，优先检查后端是否误启动为 `127.0.0.1:8000`。这属于监听地址错误，不是 CORS。

---

## 5. 手动检查表

### 5.1 Agents 列表页

访问：

- `http://127.0.0.1:5173/`

检查：

- 页面显示 `Agents`
- 至少显示 2 个 agent
- 每个 agent 行显示：名称、状态、是否活跃、最近活跃时间
- 点击任意一行可进入 agent 详情页

### 5.2 Agent 详情页

访问示例：

- `http://127.0.0.1:5173/agents/agent-root-observer`

检查：

- 页面显示 agent 名称
- 页面能显示拓扑区与详情侧栏区
- 拓扑至少包含 root 节点与两个子节点
- 初始状态下可看到一个节点详情，或能通过点击快速打开

### 5.3 节点详情侧栏

在详情页点击：

- `Collector Subagent`
- `Summarizer Subagent`
- `Root Observer Agent`

检查：

- 侧栏标题为 `Node Details`
- 显示名称、状态、Active、Last Active
- 显示事件历史列表
- 切换不同节点时，侧栏内容能正确更新

### 5.4 单节点 agent

访问：

- `http://127.0.0.1:5173/agents/agent-solo-archiver`

检查：

- 拓扑只显示单 root 节点
- 点击节点后可看到最小事件历史

---

## 6. 联调前契约检查点

在开始真实数据接入前，至少确认以下契约点：

- 只有一个 root 节点
- 所有非 root 节点都能通过 `parent_id` 连接到 root
- 所有时间字段都使用 RFC3339 UTC 字符串
- `GET /agents/{agent_id}` 的根节点身份可被前端可靠识别
- 节点事件历史允许为空数组，但字段必须存在
- 缺失 agent 或 node 时返回 404

---

## 7. 当前真实数据接入边界

后续真实接入应限制在：

- 替换当前 stub 数据来源
- 保持现有 3 个只读 observer 接口不失控扩张
- 将外部数据映射为当前最小 read model
- OpenClaw 一旦配置错误、不可达或响应不合法，必须显式报错

当前本机 Docker 实验已确认的 OpenClaw 单实例基线：

- 容器：`claw2-openclaw-gateway-1`
- 网关：`ws://127.0.0.1:28789`
- 鉴权：`OPENCLAW_GATEWAY_TOKEN`
- 协议版本：`3`
- 推荐 Origin：`OPENCLAW_ORIGIN=http://127.0.0.1:28789`

后端真实实验可使用如下环境变量：

```bash
OPENCLAW_BASE_URL=ws://127.0.0.1:28789 \
OPENCLAW_GATEWAY_TOKEN=<token> \
OPENCLAW_ORIGIN=http://127.0.0.1:28789 \
LINPO_OBSERVER_DATA_SOURCE=openclaw \
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

当前明确不在 runbook 中推进：

- 鉴权体系设计
- websocket 协议冻结
- 外部协议冻结
- 控制按钮
- agent 启停
- workspace 编辑
- 任何写操作（如 `chat.send`、`sessions.delete`）

---

## 8. 失败时排查顺序

1. 先检查后端 `/health`
2. 再检查 `/agents` 是否可返回 JSON
3. 再检查前端 `VITE_API_BASE_URL` 是否正确
4. 再检查详情页请求的 `agent_id` / `node_id` 是否与 stub 数据一致
5. 最后再看浏览器控制台与后端日志
