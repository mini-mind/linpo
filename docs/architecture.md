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

可选：

- `LINPO_TASK_EVENT_CALLBACK_BASE_URL`（用于任务事件回调诊断与兼容路径，不再是 `flow/generate` 的前置条件）
- `LINPO_ALLOW_PRIVATE_ENDPOINTS`
- `LINPO_ALLOW_LOOPBACK_ENDPOINTS`

身份模型（开源默认）：

- 默认无登录页面，未携带会话时会自动映射到本地 bootstrap 用户。
- 若部署方设置 `LINPO_AUTH_REQUIRED=1`，则接口会要求有效会话鉴权。
- 无会话访问时后端会回退到 bootstrap 用户；是否创建会话由鉴权接口显式决定。

### 3.2 API 约束

- `instanceId` 在开源单实例模式下为可选；未传时后端默认使用单实例上下文。
- `/api/v1/instances` 仅保留读取能力；写操作与配对相关路由不对外暴露。
- 流程与任务接口不再依赖用户在前端选择“当前实例”。
- `POST /api/v1/boards/{board_id}/tasks/flow/drafts` 采用乐观并发保护：
  - 创建草稿时可不传 `revision`（或传 `0`），返回记录包含 `revision`。
  - 更新已有草稿时必须携带当前 `revision`，后端仅在版本匹配时写入并将 `revision + 1`。
  - 版本不匹配返回 `409 Conflict`，`detail` 为 `flow draft revision conflict`。

### 3.3 前端约束

- 不再提供实例管理入口。
- 不再提供配对回执页面入口。
- 不再依赖 `localStorage` 维护 `currentInstanceId`。

### 3.4 草稿持久化契约（前端真源）

本节定义流程草稿的唯一持久化口径。`frontend/src/components/flowDraftStore.ts` 仅负责本地存储实现；远端同步、冲突处理、降级策略由 `frontend/src/components/FlowPage.tsx` 负责。

#### 3.4.1 真源优先级

- 编辑时采用“本地先写、远端异步同步”：
  - 先写本地（内存 + `localStorage`），保证编辑不阻塞。
  - 再按 flow 维度串行上送远端草稿 API。
- 远端成功返回后，用服务端返回记录回填本地，确保本地 `revision/updated_at` 与后端对齐。
- 页面初始 hydration 时：
  - 路由目标草稿（当前打开草稿）优先采用远端版本；
  - 非路由目标草稿按 `revision` 优先，`revision` 相同再比较 `updated_at`。

#### 3.4.2 冲突处理（409）

- 更新远端草稿必须携带当前 `revision`，由后端做乐观并发校验。
- 返回 `409 Conflict`（`flow draft revision conflict`）时：
  - 前端提示“草稿版本冲突，已重拉最新草稿”；
  - 立即重拉远端草稿并覆盖本地对应草稿；
  - 后续编辑继续按新版本再次上送。

#### 3.4.3 API 不可用行为

- 当草稿 API 返回 `404`（接口不可用）时，前端将草稿远端能力标记为 `disabled`。
- `disabled` 状态下：
  - 草稿新增/编辑/删除仅落本地，不再调用远端草稿写删 API；
  - 不额外弹“同步失败”告警，避免把“能力缺失”误报为“瞬时故障”。
- 其他非 404 错误视为同步失败：保留本地草稿，提示“草稿未同步，继续编辑将自动重试”。

### 3.5 文件页读写约束

- 文件页对“流程产物文件（task output）”提供最小 CRUD：
  - 读：列表、预览、下载；
  - 写：文本内容覆盖写入（可用于创建缺失文件）；
  - 删：删除文件；
  - 查：按关键字过滤列表。
- 所有写删操作必须经过任务输出路径白名单校验（仅允许该任务可访问的 `/tmp/linpo/...` 路径）。
- Agent 文档（如 `SOUL.md`）在文件页固定为只读，不提供编辑/删除入口。

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
