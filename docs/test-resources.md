# 测试/联调资源

## ravin 测试服务域名

- 不在仓库固定记录公网验收域名，按部署环境注入。

## 机器与访问

| 机器 | 地址 | 用途 |
|---|---|---|
| 本机 | `127.0.0.1`（或内网地址） | Linpo 服务端（前端 5173，后端 8000） |
| ravin | 按实际环境配置 | 远程客户端联调与浏览器验收发起端 |

- `ravin` SSH 地址按环境私有配置，不在仓库公开记录。

## 部署形态

- 本地开发为前端 + 后端进程本机运行，分别监听 5173 / 8000；数据库通过 Docker（宿主机端口 40193）。
- OpenClaw 联调实例通常运行于 Docker 容器（如 `claw1` / `claw2` / `claw3`）。
- v0.7 联调实例按当前配对与环境配置选择，不在文档约定默认实例。
- v0.7 流程拆解服务实例由 `FLOW_DECOMPOSITION_*` 显式配置决定（后端服务化拆解）。

## 角色分工

- 本地工作区承担代码实现、构建与测试；所有改动都需先在本地通过标准命令验证。
- `ravin` 负责远端浏览器验收入口，自己不负责构建、测试或部署主机；如需远端执行，应事先在本地演练并确保日志可回放。

## 标准命令

- `nvm use`：切换到仓库约定 Node 版本（`20.19.0`）。
- `/data/projects/linpo/.venv/bin/pytest`：后端核心逻辑测试。
- `npm --prefix frontend run test`：前端单元/集成测试。
- `npm --prefix frontend run build`：前端构建产物。
- `make quality`：统一质量门（聚合后端测试、类型检查与前端构建）。
- `curl -i http://127.0.0.1:8000/api/v1/health`：后端健康检查。

## CI/CD 门禁（GitHub Actions）

- `CI Gate`：`.github/workflows/ci.yml`
  - Backend：`py_compile + pytest(关键风险套件)`
  - Frontend：`vitest(FlowPage/flowPageUtils/geometry) + build`
  - Playwright：本地 dev server 下执行 `e2e/local/flow-page.local.spec.ts`
- `CD Delivery Gate`：`.github/workflows/cd-delivery-gate.yml`
  - 在部署环境运行 `e2e/deployed/core-path.deployed.spec.ts`
  - `push main/master` 触发时读取仓库密钥 `PLAYWRIGHT_BASE_URL`
  - 手动触发 `workflow_dispatch` 时使用输入参数 `base_url`

## 验收流程

1. 本地完成改动并运行对应测试命令，确认无回归。
2. 将构建产物/服务发布到联调环境（按环境配置的前端与后端地址）。
3. 由 `ravin` 发起 Playwright 验收，覆盖核心数据链路与页面行为。
4. 若验收失败，记录失败场景与诊断路径，修复后重新验证。

## 验收门禁

- 所有后端核心逻辑变更必须伴随单元测试。
- major feature 不允许在未部署并通过验收前直接收口。
- 页面在 success、partial-failure、failed、unauthorized 等状态要提供可诊断反馈。

## OpenClaw 联调实例资源

| 名称 | 端口 | 令牌 |
|---|---|---|
| claw1 | `18789` | 通过本地安全配置注入，不在仓库明文记录 |
| claw2 | `28789` | 通过本地安全配置注入，不在仓库明文记录 |
| claw3 | `38789` | 通过本地安全配置注入，不在仓库明文记录 |

## 运行时前置条件（环境变量）

| 变量 | 用途 |
|---|---|
| `LINPO_DATABASE_URL` | PostgreSQL 连接，用于用户与实例配置持久化 |
| `LINPO_SECRET_ENCRYPTION_KEY` | Gateway Token 加密存储 |
| `LINPO_CORS_ALLOW_ORIGINS` | 公网前端联调时的 CORS 白名单 |
| `LINPO_SESSION_COOKIE_SECURE` | 会话 Cookie `Secure` 开关；不显式配置时默认启用（`true`） |
| `VITE_API_BASE_URL` | 前端 API 地址（如 `http://127.0.0.1:8000`）；由 `frontend/.env(.local)` 注入 |
| `OPENCLAW_BASE_URL` | OpenClaw 网关地址（按部署环境显式配置） |
| `OPENCLAW_GATEWAY_TOKEN` | OpenClaw 网关令牌 |
| `OPENCLAW_ORIGIN` | OpenClaw 请求来源标识 |
| `FLOW_DECOMPOSITION_OPENCLAW_BASE_URL` | 流程拆解服务网关地址（必须显式配置） |
| `FLOW_DECOMPOSITION_OPENCLAW_GATEWAY_TOKEN` | 流程拆解服务网关令牌 |
| `FLOW_DECOMPOSITION_OPENCLAW_ORIGIN` | 流程拆解服务 Origin |
| `FLOW_DECOMPOSITION_AGENT_ID` | 已废弃；拆解服务 agent 固定为 `claw3` |
| `LINPO_TASK_EVENT_CALLBACK_BASE_URL` | 任务事件回调地址基座；建议显式配置。留空时按实例 endpoint host 自动推导公网 callback URL，若无法推导则任务投放失败 |
| `LINPO_TASK_EVENT_CALLBACK_PORT` | 自动推导 callback URL 时使用的端口（默认 `8000`） |
| `LINPO_TASK_RUN_STALE_SECONDS` | `running` 任务无 heartbeat 的超时阈值（秒） |

补充说明：任务事件回调当前采用 `callbackToken` + `occurredAt` 时间窗 + `callbackSignature(HMAC-SHA256)` 三层校验；签名 key 直接使用该次运行下发的 `callbackToken`。

补充说明：本地使用 `fastapi dev app/main.py` 启动时，后端会自动从仓库根目录 `.env` 读取并注入未显式设置的环境变量（显式导出的环境变量优先级更高）。

## OpenClaw 参考

本节仅作为引用型参考，不代表 Linpo 产品契约，正式约束仍以 `docs/prd.md` / `docs/architecture.md` 为准。
- OpenClaw 全量接口清单（含未接入项）：`docs/openclaw-api-catalog.md`
- WebSocket API：https://openclaw-openclaw.mintlify.app/api/websocket
- Sessions API：https://openclaw-openclaw.mintlify.app/api/sessions
