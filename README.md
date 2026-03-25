# 灵盘（Linpo）

灵盘（Linpo）是一个从小功能闭环起步、逐步成长的平台型项目。

当前产品方向已切换为：

> **面向人类的多实例 agent 工作与协作入口：用户登录后通过 `overview / topology / kanban / team / session` 五页 IA 理解总体运行态势、结构关系、任务推进、团队入口与会话工作区。**

当前仓库已完成一次项目级重置：旧版 roboard 的实现、设计与配置已迁出当前仓库根目录，仅作为仓库外本地归档参考，不再作为当前项目的权威来源。

开发阶段域名暂定为：`linpo.duckdns.org`

## 产品信息架构（当前契约）

Linpo 当前采用 **5 页 IA**：

| 页面 | 路由语义 | 职责 |
|------|------|------|
| **Overview** | `/overview` | 默认 landing / 主页；顶部展示 token 统计与 agent 状态统计，主区域展示按实例分组的近期 token 消耗曲线，右侧保留全局事件列表 |
| **Topology** | `/topology` | IA 第一页；满屏 routing graph 画布，泳道固定为实例 / 智能体 / 会话 / 工具，结构语言对齐 `openclaw/geteway-routing-graph` |
| **Kanban** | `/kanban` | IA 第二页；任务板，每卡一个任务，板面能力与交互边界对齐 `openclaw/mission-control` |
| **Team** | `/team` | IA 第三页；persistent agent cards 主舞台，页面结构对齐 `openclaw/center` 的 `Staff` 页面 |
| **Session** | `/session/:agentId/:channelKey/:sessionKey` | 会话工作区；从 agent 进入，侧栏固定为“渠道在上，会话在下”，主区域为当前会话；空工作区与空会话使用固定 canonical 变体 |

**关键约束：**
- `overview` 是默认 landing，不再是旧的 `agents-first watchlist`
- `team` 承接 persistent agent cards；agent card 点击进入 session 工作区
- `session` 不再是旧的极简 drill-down；允许真实对话能力，并以 `agentId / channelKey / sessionKey` 为当前 canonical 路由上下文
- `overview / topology / kanban / team / session` 五页共享聚合读链路与页面可见契约：`request_id`、`freshness`、`partial_failure` / `diagnostics`
- `freshness` 至少表达状态与时间戳，状态词汇冻结为 `fresh` / `stale` / `failed`
- overview / topology / kanban / team / session 在部分成功、失败、未授权场景都必须继续显示明确的诊断/错误摘要，而不是空成功
- 工具调用消息不直接展示原始 JSON，而要折叠为摘要说明气泡
- 会话消息历史支持 Markdown 渲染
- `session` 当前唯一 canonical 路由固定为 `/session/:agentId/:channelKey/:sessionKey`
- 当某个 agent 无可用 channel 与 session 时，空工作区 canonical 路由固定为 `/session/:agentId/__none__/__new__`
- 当某个 agent 有 channel 但无可用具体 session 时，空会话 canonical 路由固定为 `/session/:agentId/:channelKey/__new__`
- `__none__` / `__new__` 为保留字；若外部系统存在同名 key，进入当前系统前必须按 plan 中的稳定转义规则处理
- topology 交互固定围绕 routing graph 主舞台，不回退为旧的 graph-only observer 画布
- kanban 不再按只读板定义，而以任务板语义与 `openclaw/mission-control` 能力锚点为准
- 当前有效 IA 只包含 5 页；`settings / profile` 暂时搁置，不纳入当前完成定义
- 每个 major feature 完成后都要完成部署，并由 ravin 发起 Playwright 集成验证，覆盖改动功能与强相关链路
- 后端新增/修改的核心逻辑必须有完整单元测试覆盖
- 全部计划完成后，必须逐条核对实现成果是否符合 plan / PRD / architecture，不一致继续补齐再收口

## 开发环境

| 机器 | IP | 用途 |
|------|-----|------|
| 本机 | `175.178.213.10` | Linpo 服务端（前端 5173，后端 8000） |
| ravin | `68.64.179.125` | 远程客户端联调（SSH: `ravin@68.64.179.125`） |

### 当前部署形态

当前开发环境为**混合部署**，并非前端 / 后端 / 数据库全部容器化：

- Linpo 前端：宿主机上的 Vite / Node 进程（`5173`）
- Linpo 后端：宿主机上的 uvicorn 进程（`8000`）
- PostgreSQL：Docker 容器 `postgres:16`，当前通过宿主机端口 `40193` 暴露
- OpenClaw 实例：Docker 容器（如 `claw1` / `claw2` / `claw3`）

### 运行与验收验证约定

- 后端测试统一使用：`/data/projects/linpo/.venv/bin/pytest`（不依赖系统全局 `pytest`）。
- 执行测试/验证命令前，先按仓库当前文件结构确认目标路径真实存在，再运行命令。
- 浏览器侧端到端验收优先从 `ravin` 发起 Playwright，作为远程验证入口。
- Playwright 端到端验收目标为已部署端点：前端 `http://175.178.213.10:5173`、后端 `http://175.178.213.10:8000`。
- 对由多个 major feature 组成的版本，不得等到最后才统一调试；每个 major feature 完成后都必须触发部署与 Playwright 集成验证。

| 名称 | 端口 | Token |
|------|------|-------|
| claw1 | 18789 | `lhdWYU1MGLCWNwbHaQsIjlPkiSt5LKhEh9PjAtElrlE` |
| claw2 | 28789 | `ZUEg6oLmaH2DEuC3A3mJYe_l-q3yLOqVSLiLsAGfmJQ` |
| claw3 | 38789 | `OuWJnOh9wo_8wLkIQv262NPc0tgnjo1G4yCMh9v-RAg` |

## 运行时前置条件

v0.5+ 运行需要以下环境配置：

| 依赖 | 说明 |
|------|------|
| PostgreSQL | 用户与实例配置持久化，需配置 `LINPO_DATABASE_URL` |
| 服务端会话 | 登录态保持依赖服务端 session cookie，无需单独 secret，但后端需可稳定持久运行 |
| 加密密钥 | Gateway Token 加密存储，需配置 `LINPO_SECRET_ENCRYPTION_KEY` |
| CORS 来源 | 公网前端联调时需正确配置 `LINPO_CORS_ALLOW_ORIGINS` |
| 前端 API 地址 | 前端需配置 `VITE_API_BASE_URL`（如 `http://175.178.213.10:8000`） |
| OpenClaw 联调环境 | 如需同时验证多实例聚合、任务板、团队入口与 session 工作区相关链路，后端还需具备可用的 `OPENCLAW_BASE_URL`、`OPENCLAW_GATEWAY_TOKEN`、`OPENCLAW_ORIGIN` |

## 当前阶段

- **当前唯一目标**：把 v0.6 做成对齐 `../` 参考仓库的新 5 页 IA 工作入口
- **当前计划范围**：只处理 `overview / topology / kanban / team / session` 的页面职责、结构语言、交互边界与对应实现/验收收口
- **当前稳定基线**：v0.6A 多实例聚合数据模型与筛选/健康接口（已完成）
- **当前推进策略**：按 `.sisyphus/plans/v0.6-backend-layered-breakly-implementation-work-plan.md` 这一份唯一计划完成后端分层与 breakly 迁移收口，并保持与当前冻结锚点一致
- **当前产品语义**：overview 承担主页/默认入口；topology 承担 routing graph 画布；kanban 承担任务板；team 承担 persistent agent cards 主舞台；session 承担会话工作区
- **公网访问**：前端 `http://175.178.213.10:5173`，后端 `http://175.178.213.10:8000`

> `docs/plans/` 仅存放长远规划，不参与当前 v0.6 执行。

**当前对齐目标：**
- `/overview` = 主页 / 默认入口；顶部 token 统计 + agent 状态统计，主区域为按实例分组的近期 token 曲线，右侧为全局事件列表
- `/topology` = 满屏 routing graph 画布，泳道固定为实例 / 智能体 / 会话 / 工具
- `/kanban` = 任务板，每卡一个任务，能力边界对齐 `openclaw/mission-control`
- `/team` = persistent agent cards 主舞台，对齐 `openclaw/center` 的 `Staff` 页面
- `/session/:agentId/:channelKey/:sessionKey` = 会话工作区 canonical 路由；空工作区与空会话使用固定 canonical 变体
- 首页汇报感禁止额外 prompt 注入
- 消息历史支持 Markdown，tool-call 展示为摘要气泡而非 raw JSON
- 不引入模板系统、工作流平台化或额外第六个有效页面

**当前 UI 角色冻结：**
- `overview` = 主页。主舞台固定为顶部统计 + 实例 token 曲线 + 右侧全局事件流；禁止回退成 `agents-first watchlist`、大摘要报告页或旧 observer 首页。
- `topology` = routing graph 画布。主舞台固定为四泳道满屏画布；禁止回退到旧 graph-only observer 语义或以侧栏/面板挤占主舞台。
- `kanban` = 任务板。主舞台固定为 task board；禁止继续以“只读信号板”作为当前产品定义。
- `team` = persistent agent cards 主舞台。承担从团队视角进入 agent 的入口职责；禁止被降级为附录或可选页。
- `/session/:agentId/:channelKey/:sessionKey` = 会话工作区。固定包含渠道区、会话区、当前会话区与输入/发送能力；禁止回退为旧的极简 drill-down 单列页。

## 文档入口

| 文档 | 路径 | 说明 |
|------|------|------|
| 产品需求（当前范围） | `docs/prd/2026-03-24-linpo-v0.6-observer-prd.md` | 当前有效产品边界；当前阶段只以 v0.6 对齐 `../` 参考仓库为执行目标 |
| 架构边界（当前范围） | `docs/architecture/2026-03-24-observer-architecture.md` | 当前有效架构边界与 v0.6 IA/约束入口 |
| 当前唯一计划 | `.sisyphus/plans/v0.6-backend-layered-breakly-implementation-work-plan.md` | 当前阶段唯一 active plan：定义并承载 v0.6 后端分层与 breakly 迁移的目标、实现范围、验证与收口要求 |
| 长远规划 | `docs/plans/` | 非当前阶段版本设计与长期规划入口；`v0.6+` 未来版本不再作为当前执行入口 |
| OpenClaw API 参考 | `OPENCLAW_API.md` | OpenClaw WebSocket API 参考 |
| 仓库治理 | `AGENTS.md` | 当前项目治理规则 |

### start-work 前置阅读与执行边界

- 继续 `/start-work` 前，只读 `.sisyphus/plans/v0.6-backend-layered-breakly-implementation-work-plan.md` 这一份当前 active plan。
- 当前阶段只允许围绕 **v0.6 对齐 `../` 参考仓库** 展开工作；`docs/plans/` 下的长期规划与其他非当前文件不得被当作执行入口。
- 若当前 plan 与 truth docs 存在冲突，以 `README.md` + PRD + architecture 为准，并先修正文档口径再继续实现。
- `ravin` 只承担远端访问与浏览器验收发起。
- `ravin` 不承载仓库命令执行，不作为构建、测试、部署主机。

## 当前原则
- 先做最小观测入口，再扩张平台能力
- 先定文档，再做实现
- 不复用旧 roboard 的平台世界观作为当前约束
- 不在方向未冻结前预建大而全的代码骨架
- 以最新 docs + active `.sisyphus` plan 作为当前唯一执行约束
