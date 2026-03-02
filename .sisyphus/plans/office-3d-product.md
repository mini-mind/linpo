# Office 3D Product Plan - Landing, Auth, 3D World, Chat, MCP

> **目标**: 沉浸式 3D 办公环境，用户通过登录进入，与 PM/工程师 Agent 交互，Agent 可调用 MCP 工具
> **技术栈**: Vanilla HTML/JS/CSS + Three.js (CDN) + FastAPI + PostgreSQL + Redis
> **关键体验**: Landing Cover → Auth Modal → 3D Office World → Click Agent Chat → Agent Call MCP Tools

---

## 1. 目标与范围

### 目标（MVP 必须达成）
- 用户通过 Landing Cover 进入系统，点击 "Enter" 触发 Auth Modal
- 支持用户注册/登录（email + password），登录后进入全屏 3D Office
- 3D 场景包含：工作台 + 2 个 Agent（PM + 工程师）+ 墙面看板
- 点击看板元素可缩放查看，点击 Agent 可打开聊天面板
- Agent 在对话中可调用 MCP 工具（如 search、file I/O 等）

### 已确认决策（基于现有架构）
- **前端**: 保持 Vanilla JS/CSS/HTML 无构建框架，Three.js 通过 CDN 加载
- **路由**: 使用轻量级客户端路由（History API）在 `/` 和 `/world` 之间切换
- **3D 场景**: 使用 Three.js 构建办公室环境（桌椅、Agent、看板）
- **Auth 后端**: 扩展 api 添加用户认证（email + password），现有 tenant/auth 并行存在
- **WebSocket**: 复用现有 `/ws/events` 端点模式，新增 `/ws/conversations` 用于聊天流式响应
- **Agent 逻辑**: 新增 agent-runtime 服务处理 LLM 对话和工具调用
- **MCP**: 扩展现有 mcp-server 支持工具调用协议（JSON-RPC over HTTP）

### 明确不做（硬护栏）
- 不做多人协作 3D 场景（单用户视角）
- 不做复杂的 3D 动画（基础定位 + 点击交互即可）
- 不做语音输入/输出（纯文本聊天）
- 不做 Agent 之间的自动协作（仅响应用户消息）
- 不做持久化 Agent 记忆（对话历史在会话周期内保留）

---

## 2. 核心体验流程

### 体验闭环（Wow-factor）
1. **Landing Cover**: 全屏视觉冲击 + "Enter" 按钮
2. **Auth Modal**: 邮箱密码登录/注册，点击确认进入 3D 世界
3. **3D Office World**: 第一人称视角，看到办公桌、两个 Agent、墙面看板
4. **Click Agent**: 点击 PM 或工程师 Agent，弹出聊天面板
5. **Chat with Agent**: 发送消息，Agent 流式回复，可调用 MCP 工具
6. **Click Kanban**: 点击看板上的任务卡片，缩放查看详情

### 差异化叙事
- 不是传统的 Dashboard UI，而是"可探索的 3D 工作空间"
- Agent 不只是聊天机器人，而是"活体角色"（有视觉实体，可被点击）
- MCP 工具调用对用户透明可见，展示 Agent 的能力边界

---

## 3. 架构扩展（基于现有服务）

### 新增/修改服务
- **web-frontend** (修改): 添加 Landing 页面、Auth Modal、客户端路由、3D 场景扩展
- **api** (扩展): 添加用户认证 endpoints (`/api/auth/login`, `/api/auth/register`)
- **agent-runtime** (新增): 处理 Agent 对话逻辑，LLM 调用，工具绑定
- **mcp-server** (扩展): 实现工具调用协议，添加工具 catalog

### 数据模型扩展（PostgreSQL）
- **users**: `id, email, password_hash, created_at`
- **sessions**: `id, user_id, session_token, created_at, expires_at`
- **conversations**: `id, user_id, agent_type, created_at`
- **messages**: `id, conversation_id, role (user/agent/tool), content, created_at`

### 路由方案（客户端）
- `/` → Landing Cover
- `/world` → 3D Office World（需登录验证）
- 未登录访问 `/world` → 重定向到 `/` 并显示 Auth Modal

---

## 4. 关键技术决策

### Assumptions/Decisions Needed

#### 1. Auth Strategy
**决策**: 添加用户 email/password 认证，与现有 tenant auth 并行存在
- **原因**: 用户需要注册/登录体验，但保留 admin key 租户管理
- **实现**: 
  - 新增 users/sessions 表
  - `/api/auth/register`: 创建用户（返回 session_token）
  - `/api/auth/login`: 验证密码（返回 session_token）
  - 前端存储 session_token 在 localStorage
  - API 调用时通过 `X-Session-Token` header 认证

#### 2. Routing Approach
**决策**: 使用轻量级 History API 客户端路由
- **原因**: SPA 体验流畅，无页面刷新，状态保持简单
- **实现**:
  - `router.js`: 简单的 path-to-component 映射
  - `pages/landing.js`: Landing Cover + "Enter" button + Auth Modal
  - `pages/world.js`: 3D Office World + Agent 点击处理 + Chat UI

#### 3. 3D Tech Choice
**决策**: 保持 Three.js（已通过 CDN 加载），扩展现有场景
- **原因**: 无需引入新依赖，现有代码可复用
- **实现**:
  - 扩展 `app.js` 中的 Three.js 场景
  - 添加 office 环境模型（桌椅、墙面、看板）
  - 添加 raycasting 检测点击 Agent/Kanban

#### 4. Agent Logic & Tool Calling
**决策**: 新增 agent-runtime 服务，调用 LLM + MCP 工具
- **原因**: dispatch 专注任务编排，对话逻辑需要独立服务
- **实现**:
  - agent-runtime: `/api/conversations` endpoints, 处理消息生成
  - LLM: OpenAI/Anthropic API（环境变量配置）
  - 工具调用: mcp-server 提供 `/tools` 和 `/tools/{name}/execute`

---

## 5. 验收标准（可命令验证）

### M0: Landing Cover
- 访问 `/` 显示 Landing 页面
- "Enter" 按钮触发 Auth Modal
- Modal 显示 Login/Register 切换

### M1: Auth Endpoints
- `POST /api/auth/register` 创建用户，返回 session_token
- `POST /api/auth/login` 验证登录，返回 session_token
- `GET /api/auth/me` 通过 session_token 返回用户信息

### M2: 3D Office World
- 访问 `/world` 显示全屏 3D 办公室
- 场景包含：工作台、2 个 Agent 可视体、墙面看板
- Three.js 无控制台错误

### M3: Click Interactions
- 点击 Agent 触发 raycasting 检测
- 打开聊天面板（UI overlay）
- 点击看板触发缩放动画

### M4: Agent Chat
- `POST /api/conversations` 创建对话
- `POST /api/conversations/{id}/messages` 发送消息
- WebSocket `/ws/conversations?conversation_id=...` 流式接收 Agent 回复

### M5: MCP Tool Calling
- `GET /mcp/tools` 返回可用工具列表
- `POST /mcp/tools/{name}/execute` 执行工具调用
- Agent 在对话中调用工具（日志中可见 tool_calls）

---

## 6. 里程碑（Milestones）

### M0: Landing Cover + Auth Modal UI
- [ ] 修改 `web-frontend/index.html` 为 Landing Cover 页面结构
- [ ] 添加 Landing 视觉设计（全屏背景 + "Enter" 按钮 + 标题文案）
- [ ] 实现 Auth Modal UI（隐藏初始，点击 "Enter" 显示）
- [ ] Modal 包含 Login/Register 标签页切换
- [ ] Login 表单：email + password + "Sign In" 按钮
- [ ] Register 表单：email + password + confirm password + "Create Account" 按钮
- [ ] 添加 `web-frontend/js/router.js` 客户端路由（`/` → Landing, `/world` → World）
- [ ] Landing 页面点击 "Enter" 显示 Modal（不跳转）
- [ ] Modal 提交后路由到 `/world`
- [ ] 测试：打开 `/`，点击 Enter，显示 Modal，提交后路由到 `/world`
- [ ] **Commit**: `git commit -m "M0: Landing Cover + Auth Modal UI (no backend yet)"`

### M1: Auth Backend + User/Session Model
- [ ] 添加 `api/app/models/user.py`（User, Session 模型）
- [ ] 添加数据库 migrations（alembic revision for users/sessions tables）
- [ ] 实现 `/api/auth/register` endpoint（创建 User + Session，返回 session_token）
- [ ] 实现 `/api/auth/login` endpoint（验证密码，创建 Session，返回 session_token）
- [ ] 实现 `/api/auth/me` endpoint（通过 X-Session-Token header 返回用户信息）
- [ ] 更新 `api/app/main.py` 添加 auth 路由
- [ ] 测试：`curl -X POST http://localhost:8000/api/auth/register` 创建用户
- [ ] 测试：`curl -X POST http://localhost:8000/api/auth/login` 登录获取 token
- [ ] 测试：`curl -H "X-Session-Token: $TOKEN" http://localhost:8000/api/auth/me` 返回用户
- [ ] **Commit**: `git commit -m "M1: Auth backend endpoints (register/login/me)"`

### M2: Frontend Auth Integration + 3D Office World
- [ ] 更新 `web-frontend/js/router.js` 添加登录验证（访问 `/world` 检查 localStorage session_token）
- [ ] 实现前端 API 客户端（`web-frontend/js/api.js`）：`register()`, `login()`, `getUser()`
- [ ] 绑定 Modal 表单提交到 Auth API（存储 session_token 到 localStorage）
- [ ] 创建 `web-frontend/js/world.js` 初始化全屏 3D Office 场景
- [ ] 扩展 Three.js 场景（添加办公桌模型：THREE.Mesh with BoxGeometry）
- [ ] 添加 2 个 Agent 可视体（PM: 蓝色 Box, Engineer: 绿色 Box，固定位置）
- [ ] 添加墙面看板（大 RectangleGeometry，贴图或简单颜色，包含任务卡片）
- [ ] 调整 Camera 位置（第一人称视角：y=1.7）
- [ ] 禁用 OrbitControls（改为第一人称 WASD 移动，可选）
- [ ] 测试：注册/登录后进入 `/world`，看到 3D 场景
- [ ] 测试：未登录访问 `/world` 自动重定向到 `/`
- [ ] **Commit**: `git commit -m "M2: Frontend auth integration + 3D office world base scene"`

### M3: Click Interactions (Raycasting)
- [ ] 实现 raycasting 逻辑（`web-frontend/js/world.js` 监听 click 事件）
- [ ] 为 Agent 可视体添加 `userData.agentType` 属性（'pm' 或 'engineer'）
- [ ] 为看板添加 `userData.type='kanban'` 属性
- [ ] 点击 Agent 触发 `openChatPanel(agentType)` 函数
- [ ] 点击 Kanban 触发 `zoomToKanban()` 函数（Camera 动画）
- [ ] 创建 `web-frontend/js/chat.js` Chat UI 面板（初始隐藏）
- [ ] Chat UI 包含：Agent 名称、消息列表、输入框、发送按钮
- [ ] Chat UI 定位为 overlay（absolute position, z-index 高）
- [ ] 测试：点击 PM Agent，弹出 "Chat with PM" 面板
- [ ] 测试：点击 Engineer Agent，弹出 "Chat with Engineer" 面板
- [ ] 测试：点击看板，Camera 缩放动画
- [ ] **Commit**: `git commit -m "M3: 3D click interactions (raycasting + chat UI + kanban zoom)"`

### M4: Conversation Backend + Chat Endpoints
- [ ] 添加 `api/app/models/conversation.py`（Conversation, Message 模型）
- [ ] 添加数据库 migrations（alembic revision for conversations/messages tables）
- [ ] 实现 `/api/conversations` endpoint（创建对话）
- [ ] 实现 `/api/conversations/{id}` endpoint（获取对话详情）
- [ ] 实现 `/api/conversations/{id}/messages` endpoint（发送用户消息）
- [ ] 实现 `/api/conversations/{id}/messages` GET（获取消息历史）
- [ ] 创建 `agent-runtime` service（Dockerfile + docker-compose.yml）
- [ ] agent-runtime 实现 LLM 调用（OpenAI/Anthropic API）
- [ ] agent-runtime 实现 Agent 逻辑（PM persona vs Engineer persona）
- [ ] agent-runtime 连接到 PostgreSQL（读写 conversations/messages）
- [ ] 测试：`POST /api/conversations` 创建对话
- [ ] 测试：`POST /api/conversations/{id}/messages` 发送消息
- [ ] 测试：agent-runtime 生成 Agent 回复并保存到 messages 表
- [ ] **Commit**: `git commit -m "M4: Conversation backend + agent-runtime service (LLM integration)"`

### M5: WebSocket Streaming + MCP Tool Calling
- [ ] 扩展 `api/app/main.py` 添加 `/ws/conversations` WebSocket endpoint
- [ ] WebSocket 参数：`conversation_id`, `session_token`
- [ ] WebSocket 连接后推送新消息（agent_runtime 写入 messages 后触发）
- [ ] 扩展 `mcp-server` 添加 `/tools` endpoint（返回工具 catalog）
- [ ] 扩展 `mcp-server` 添加 `/tools/{name}/execute` endpoint（执行工具）
- [ ] 实现工具 catalog（search, file_read, file_write, 等）
- [ ] agent-runtime 实现工具调用逻辑（LLM function calling）
- [ ] agent-runtime 调用 mcp-server `/tools/{name}/execute`
- [ ] 前端 `web-frontend/js/chat.js` 连接 WebSocket `/ws/conversations`
- [ ] 前端流式接收 Agent 回复（实时追加到消息列表）
- [ ] 测试：发送消息 "Search for X"，Agent 调用 search 工具
- [ ] 测试：WebSocket 流式接收 Agent 回复（字符/消息级）
- [ ] 测试：工具调用日志可见（messages 表 role='tool'）
- [ ] **Commit**: `git commit -m "M5: WebSocket streaming + MCP tool calling (agent-runtime tools)"`

---

## 7. 风险与降级策略

| 风险 | 影响 | 降级策略 |
|------|------|---------|
| LLM API 限流/成本 | Agent 无法响应 | 降级为静态回复，显示工具调用占位符 |
| 3D 场景性能低端 | 卡顿/掉帧 | 简化 3D 模型（降低面数，禁用阴影） |
| WebSocket 连接不稳定 | 消息丢失 | 添加重连逻辑 + 消息去重 |
| MCP 工具调用超时 | Agent 挂起 | 设置超时限制 + 返回错误消息 |
| Session Token 泄露 | 账户安全风险 | 添加过期时间 + 短时效 Token 策略 |

---

## 8. 下一步

确认本计划后，执行以下命令启动工作：
```bash
# 初始化 git（如果未初始化）
git init
git add .
git commit -m "baseline: office-3d-product plan created"

# 开始执行 M0
```
