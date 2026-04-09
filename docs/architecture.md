# Linpo Architecture

> 前置：`docs/prd.md`

## 1. 定位

Linpo 是 OpenClaw 与用户之间的人机协作编排层。
开源版固定为**单实例模式**：运行时不提供实例创建、配对、挂载、卸载与多实例切换。

## 2. 系统边界

- 前端：摘要、看板、流程编辑、文件。
- 后端：任务编排、流程规划、审批状态、结果预览、OpenClaw 适配。
- OpenClaw：agent 执行与会话能力。

边界约束：

- 前端不直接访问 OpenClaw。
- OpenClaw 仅通过后端适配层访问。
- 运行实例由后端启动配置提供：`OPENCLAW_BASE_URL` + `OPENCLAW_GATEWAY_TOKEN`。

## 3. 单实例运行模型

### 3.1 配置真源

开源版单实例最小必填：

- `OPENCLAW_BASE_URL`
- `OPENCLAW_GATEWAY_TOKEN`
- `LINPO_TASK_EVENT_CALLBACK_BASE_URL`

可选：

- `LINPO_ALLOW_PRIVATE_ENDPOINTS`
- `LINPO_ALLOW_LOOPBACK_ENDPOINTS`

身份模型（开源默认）：

- 默认免注册/免登录。
- 首次访问 `/api/v1/auth/me` 时自动创建并绑定本地默认用户会话。

### 3.2 API 约束

- `instanceId` 在开源单实例模式下为可选；未传时后端默认使用单实例上下文。
- `/api/v1/instances` 仅保留读取能力；写操作与配对相关路由不对外暴露。
- 流程与任务接口不再依赖用户在前端选择“当前实例”。

### 3.3 前端约束

- 不再提供实例管理入口。
- 不再提供配对回执页面入口。
- 不再依赖 `localStorage` 维护 `currentInstanceId`。

## 4. 流程与任务

主链路：

`一句话需求 -> flow.generate -> flow.confirm -> queued/running -> completed/failed/blocked_by_approval -> output-preview/output-file`

状态机最小集：

- `queued`
- `running`
- `blocked_by_approval`
- `failed`
- `completed`

## 5. 部署与验收

部署验收以 README 为准，重点检查：

1. 服务可启动（前端/后端健康）。
2. `OPENCLAW_BASE_URL` 与 `OPENCLAW_GATEWAY_TOKEN` 已配置。
3. 主链路可闭环（规划、运行、成果预览/下载）。

本地非 Docker 联调默认入口：

- 后端：`fastapi dev --port 8000`（会通过仓库根 `main.py` 自动加载 `.env`）
- 前端：`npm --prefix frontend run dev`（端口固定 `5173`）

## 6. 开源边界

- 仅 Web（PC + 移动浏览器），不含 Tauri。
- 不包含支付、会员充值、模板市场等 SaaS 扩展。
- 不提供多实例管理与运行时配对能力。
