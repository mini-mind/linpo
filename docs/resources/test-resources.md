# 测试/联调资源

## ravin 测试服务域名

- `linpo.duckdns.org`

## 机器与访问

| 机器 | 地址 | 用途 |
|---|---|---|
| 本机 | `175.178.213.10` | Linpo 服务端（前端 5173，后端 8000） |
| ravin | `68.64.179.125` | 远程客户端联调与浏览器验收发起端 |

- `ravin` SSH：`ravin@68.64.179.125`

## 部署形态
- 本地开发为前端 + 后端进程本机运行，分别监听 5173 / 8000；数据库通过 Docker（宿主机端口 40193）。
- OpenClaw 联调实例通常运行于 Docker 容器（如 `claw1` / `claw2` / `claw3`）。
- 联调环境集中在 `175.178.213.10`，前端 5173，后端 8000；诊断时直接访问对应 IP 端口以归因网络、服务状态或健康检查。

## 角色分工
- 本地工作区承担代码实现、构建与测试；所有改动都需先在本地通过标准命令验证。
- `ravin` 负责远端浏览器验收入口，自己不负责构建、测试或部署主机；如需远端执行，应事先在本地演练并确保日志可回放。

## 标准命令
- `/data/projects/linpo/.venv/bin/pytest`：后端核心逻辑测试，门禁要求核心改动必须覆盖。
- `npm --prefix frontend run test`：前端单元/集成测试，保证视图反馈行为。
- `npm --prefix frontend run build`：前端构建产物，用于联调环境部署前验证。
- `make quality`：统一质量门（聚合后端测试、类型检查与前端构建）。
- `curl -i http://175.178.213.10:8000/health`：后端健康检查，便于在联调环境确认基础链路。
- 不依赖系统全局 `pytest`，后端测试统一使用仓库虚拟环境命令。
- 执行测试/验收命令前先确认目标路径与文件存在，避免路径漂移误判。

## 验收流程
1. 本地完成改动并运行对应测试命令，确认无回归。
2. 将构建产物/服务发布到联调环境（`175.178.213.10` 前端与后端端口）。
3. 由 `ravin` 发起 Playwright 验收，覆盖涉及的数据链路、页面渲染与核心 API。
4. 若验收失败，记录失败场景与诊断路径，修复后重新验证，确保故障可复制并关闭。

## 验收门禁
- 所有后端核心逻辑变更必须伴随单元测试。
- 任何 major feature 不允许在未部署并通过验收前直接收口；必须走完联调部署 + Playwright 验收链路。
- 页面在 success、partial-failure、failed、unauthorized 等状态都要提供可诊断的反馈，以便 Playwright/人工定位。

## 质量管线（建议执行顺序）
1. `/data/projects/linpo/.venv/bin/pytest`
2. `npm --prefix frontend run test`
3. `npm --prefix frontend run build`
4. `make quality`
5. `curl -i http://175.178.213.10:8000/health`
6. `ravin` 发起 Playwright 验收

## OpenClaw 联调实例资源

| 名称 | 端口 | Token |
|---|---|---|
| claw1 | `18789` | `lhdWYU1MGLCWNwbHaQsIjlPkiSt5LKhEh9PjAtElrlE` |
| claw2 | `28789` | `ZUEg6oLmaH2DEuC3A3mJYe_l-q3yLOqVSLiLsAGfmJQ` |
| claw3 | `38789` | `OuWJnOh9wo_8wLkIQv262NPc0tgnjo1G4yCMh9v-RAg` |

## 运行时前置条件（环境变量）

| 变量 | 用途 |
|---|---|
| `LINPO_DATABASE_URL` | PostgreSQL 连接，用于用户与实例配置持久化 |
| `LINPO_SECRET_ENCRYPTION_KEY` | Gateway Token 加密存储 |
| `LINPO_CORS_ALLOW_ORIGINS` | 公网前端联调时的 CORS 白名单 |
| `VITE_API_BASE_URL` | 前端 API 地址（如 `http://175.178.213.10:8000`） |
| `OPENCLAW_BASE_URL` | OpenClaw 网关地址 |
| `OPENCLAW_GATEWAY_TOKEN` | OpenClaw 网关令牌 |
| `OPENCLAW_ORIGIN` | OpenClaw 请求来源标识 |

## OpenClaw 参考
本节仅作为引用型参考，基于 `/data/projects/openclaw/src/gateway/server-methods-list.ts` 与 OpenClaw 官方文档（WebSocket API：https://openclaw-openclaw.mintlify.app/api/websocket，Sessions API：https://openclaw-openclaw.mintlify.app/api/sessions）。不代表 Linpo 产品契约，正式约束仍以 `docs/prd/v0.6.md`/`docs/architecture/v0.6.md` 为准。
- OpenClaw 全量接口清单（含未接入项）：`docs/resources/openclaw-api-catalog.md`
- **Chat 系列**：`chat.send`、`chat.abort`、`chat.history`、`chat.inject`，用于对 agent 发送消息、终止运行、查看/补上下文。
- **Session 管理**：`sessions.list`、`sessions.preview`、`sessions.patch`、`sessions.reset`、`sessions.delete`、`sessions.compact`、`sessions.resolve`，可查询/修改会话状态与元信息。
- **Agent 管理与调用**：`agents.list/create/update/delete`、`agents.files.*`、`agent`、`agent.identity.get`、`agent.wait`，支撑 agent 实例的生命周期与交互。
- **模型与配置**：`models.list`、`config.*`、`config.apply`，用于查看可用模型并在 runtime 上调配配置。
- **健康/状态与工具审批**：`health/status`、`doctor.memory.status`、`tools.catalog`、`exec.approvals.*`，以及 `update.run`、`usage.*`，可联动监控与执行策略。
- **设备/节点与消息**：`node.*`、`device.*`、`send`、`channels.*`，保障边缘节点与设备的配对、通讯和日志订阅。
- **事件与语音**：事件广播（`agent`、`chat`、`health`、`update.available` 等）、`tts.*`、`voicewake.*` 支持流式反馈与语音输入的状态感知。
