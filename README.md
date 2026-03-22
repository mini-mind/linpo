# 灵盘（Linpo）

灵盘（Linpo）是一个从小功能闭环起步、逐步成长的平台型项目。

当前产品方向已切换为：

> **面向人类的 agent / instance 运行观测入口：用户登录后可以查看自己的实例，并通过 `overview / topology / kanban / session drill-down` 理解系统状态、工作信号、结构关系与单 agent 上下文。**

当前仓库已完成一次项目级重置：旧版 roboard 的实现、设计与配置已迁出当前仓库根目录，仅作为仓库外本地归档参考，不再作为当前项目的权威来源。

开发阶段域名暂定为：`linpo.duckdns.org`

## 产品信息架构（当前契约）

Linpo 当前采用四层入口语义：

| 层级 | 路由 | 职责 |
|------|------|------|
| **总览层** | `/overview` | 默认 landing，全局脉搏主舞台，展示用户全部 agents，回答“谁在干活、哪里值得巡视” |
| **拓扑层** | `/topology` | `graph-only` 关系画布，展示实例、agent、skill、外接 ACP 等关系；只保留极简画布控件，不承接配置入口或详情面板 |
| **看板层** | `/kanban` | `Mission Control` 风格只读板，聚合工作项、协作状态与关键工作信号，不扩张成完整审批/项目管理平台 |
| **接管层** | `/session/:instanceId/:agentId` | `drill-down`，以极简标题 + 消息流 + 输入区进入单 agent 上下文 |

**关键约束：**
- `overview` 以用户全部 agents 为默认概览对象，承担概览/巡视入口
- 首页汇报感禁止额外 prompt 注入，只能基于已有状态/事件/活跃度生成
- 聚合读接口与页面展示必须显式贯通 `request_id`、`freshness`、`partial_failure` / `diagnostics` 与错误包络；错误包络至少包含 `code`、`message`、`request_id`、`recoverable`、`next_step`
- `freshness` 至少表达状态与时间戳，状态词汇冻结为 `fresh` / `stale` / `failed`，不允许把降级态伪装成实时成功
- overview / topology / kanban 在部分成功、失败、未授权场景都必须继续显示明确的诊断/错误摘要，而不是空成功
- 工具调用消息不直接展示原始 JSON，而要折叠为摘要说明气泡
- 会话消息历史支持 Markdown 渲染
- `overview`、`topology`、`kanban` 三页都必须提供进入 agent 对话的入口，并统一落到 `/session/:instanceId/:agentId`
- `/session/:instanceId/:agentId` 以 URL 参数为唯一真源；`/session` 与 `/session/:instanceId` 仅作为兼容重定向入口，不承载长期状态
- topology 首期交互固定为 `查看 / 进入 / 配置 / 关系` 四类动作；不暴露 pause/reset/send/delete 等 destructive/runtime controls
- `topology` 主舞台固定为 `graph-only` canvas + auto layout，只允许极简画布控件；不包含详情侧栏、配置面板、统计卡与任何写操作
- `kanban` 保持 `Mission Control` 风格只读板，不引入拖拽写回、列内编辑、审批流或批量操作
- 不引入模板系统、工作流平台化或控制面扩张
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
| claw2 | 28789 | `ZUE 6oLmaH2DEuC3A3mJYe_l-q3yLOqVSLiLsAGfmJQ` |
| claw3 | 38789 | (查看容器环境变量) |

## 运行时前置条件

v0.5+ 运行需要以下环境配置：

| 依赖 | 说明 |
|------|------|
| PostgreSQL | 用户与实例配置持久化，需配置 `LINPO_DATABASE_URL` |
| 服务端会话 | 登录态保持依赖服务端 session cookie，无需单独 secret，但后端需可稳定持久运行 |
| 加密密钥 | Gateway Token 加密存储，需配置 `LINPO_SECRET_ENCRYPTION_KEY` |
| CORS 来源 | 公网前端联调时需正确配置 `LINPO_CORS_ALLOW_ORIGINS` |
| 前端 API 地址 | 前端需配置 `VITE_API_BASE_URL`（如 `http://175.178.213.10:8000`） |
| OpenClaw 联调环境 | 如需同时验证 observer / session 相关链路，后端还需具备可用的 `OPENCLAW_BASE_URL`、`OPENCLAW_GATEWAY_TOKEN`、`OPENCLAW_ORIGIN` |

## 当前阶段

- **当前目标版本**：v0.6 多实例聚合视图与 IA 收敛
- **当前稳定基线**：v0.6A 多实例聚合数据模型与筛选/健康接口（已完成）
- **当前推进策略**：将 Linpo 收敛为 `overview / topology / kanban / session drill-down` 结构；首页固定为 `/overview` 默认 landing，`overview` 负责用户全部 agents 的概览/巡视，`/topology` 固定为 `graph-only` 关系画布，`/kanban` 固定为 `Mission Control` 风格只读板，`/session/:instanceId/:agentId` 负责显式单 agent 接管
- **当前产品语义**：overview 承担 `agents-first watchlist` 主舞台，topology 承担 `graph-only` canvas + auto layout，kanban 承担 `Mission Control` 风格只读板，session 页固定为极简 title / stream / input drill-down
- **公网访问**：前端 `http://175.178.213.10:5173`，后端 `http://175.178.213.10:8000`

## 版本路线

```
v0.1 ─ Observer 起点（已完成）
v0.2 ─ Realtime Observer（已完成）
v0.3 ─ 单实例控制接入验证（已完成）
v0.4 ─ 单实例控制完善（已完成）
v0.5 ─ 用户模型 + 实例配置（已完成，公网验证通过）
v0.6A ─ 多实例聚合数据与筛选闭环（已完成）
v0.6B ─ overview / topology / kanban / session IA 收敛 ← 当前目标
v0.7 ─ 跨实例消息传递
```

**v0.6B 关键交付：**
- `/overview` 默认 landing，全局脉搏主舞台
- `/topology` = `graph-only` canvas + auto layout，固定动作词 `查看 / 进入 / 配置 / 关系`
- `/kanban` = `Mission Control` 风格只读板，聚合工作项、协作状态与关键信号
- `overview / topology / kanban` 三页都可进入 agent 对话，并统一落到 `/session/:instanceId/:agentId`
- `/session/:instanceId/:agentId` drill-down，URL 真源
- 首页汇报感禁止额外 prompt 注入
- 消息历史支持 Markdown，tool-call 展示为摘要气泡而非 raw JSON
- 不引入模板系统、工作流平台化或控制面扩张

**v0.6B UI 角色冻结：**
- `overview` = `agents-first watchlist`。主舞台只服务于 agent 巡视与优先级判断，summary 只保留极小辅助区，不得反客为主；禁止把首页重写成大摘要首页、报告页或新的控制面，继续保持 `observer-only`。
- `topology` = `graph-only` canvas + auto layout。主舞台固定为关系图画布，次要区域只保留极简画布控件；禁止详情侧栏、`配置面板`、统计卡、节点清单挤占主舞台与任何拖拽写回式编辑，继续保持 `observer-only`。
- `kanban` = `Mission Control` 风格只读板。主舞台是聚合卡片流，次要区域只保留轻量筛选与统计；禁止拖拽写回、列内编辑、审批流、批量操作或项目管理扩张，继续保持 `observer-only`。
- `/session/:instanceId/:agentId` = 极简标题 + 消息流 + 输入区。桌面内容区 `max-width 880px`，主舞台固定为单列会话流；禁止 `tabs`、`sidebar`、`status panel` 与多栏控制台结构。

## 文档入口

| 文档 | 路径 | 说明 |
|------|------|------|
| 产品需求（含版本路线） | `docs/prd/2026-03-15-linpo-v0.1-observer-prd.md` | 当前有效的产品边界与版本演进路线（已收敛到 v0.6 当前约束） |
| 架构边界 | `docs/architecture/2026-03-15-observer-architecture.md` | 当前有效架构边界与 v0.6 IA/约束入口 |
| 当前执行计划 | `.sisyphus/plans/v0.6-execution-work-plan.md` | 当前活跃执行计划与最终验收门禁 |
| OpenClaw API 参考 | `OPENCLAW_API.md` | OpenClaw WebSocket API 参考 |
| 仓库治理 | `AGENTS.md` | 当前项目治理规则 |

## 当前原则
- 先做最小观测入口，再扩张平台能力
- 先定文档，再做实现
- 不复用旧 roboard 的平台世界观作为当前约束
- 不在方向未冻结前预建大而全的代码骨架
- 以最新 docs + active `.sisyphus` plan 作为当前唯一执行约束
