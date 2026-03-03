Task Tree UI

Task Tree UI 用于创建任务、查看任务树、与任务交互和管理会话。

Files:
  - index.html: Task Tree UI HTML 结构
  - app.js: UI 逻辑和 WebSocket 客户端
  - style.css: 样式

## UI 元素

### 顶部栏
- **品牌标识**: `.brand` 和 `.brand-name` 显示 RoBoard 品牌
- **用户下拉菜单**: `.user-dropdown` 包含用户信息和操作
  - **下拉触发器**: `#user-dropdown-trigger` 显示会话标签和连接状态
  - **会话标签**: `#session-label` 显示当前会话信息（在触发器内）
  - **连接状态**: `#task-connection-pill` 显示连接状态（在触发器内）
  - **下拉菜单**: `#user-dropdown-menu` 包含语言切换和登出
    - **语言切换**: `#lang-zh` 和 `#lang-en` 切换界面语言
    - **登出按钮**: `#logout-btn` 用于退出当前会话

### 任务创建
- **添加任务按钮**: `#add-task-btn` 是浮动操作按钮，打开任务创建模态框
- **消息提示**: `#task-message` 显示操作结果消息

### 任务创建模态框
- **模态框**: `#add-task-modal` 任务创建界面
- **表单**: `#add-task-form` 任务创建表单
- **输入框**: `#task-input-nl` 自然语言任务描述输入
- **取消按钮**: `#cancel-task-btn` 取消任务创建
- **关闭按钮**: `#close-modal-btn` 关闭模态框

### 任务详情
- **详情区域**: `#task-details-section` 显示选中任务的详细信息
- **计划列表显示**: `#task-sop-display` 显示任务的 TODO/计划列表内容（来源为 `plan_subtasks`）
- **技能面板**: `#task-skills-list` 展示技能列表，`#task-skill-select` 选择社区技能并安装
- **团队模板**: `#task-team-export` 导出 YAML，`#task-team-import-form` 粘贴并导入 YAML
- **聊天消息**: `#task-chat-messages` 显示任务相关的聊天消息
- **聊天表单**: `#task-chat-form` 发送新消息的表单
- **聊天输入**: `#task-chat-input` 消息输入框

## API 端点

- `POST /api/runs` - 创建新运行
- `GET /api/runs/{run_id}/tree` - 获取运行的任务树
- `GET /api/runs/{run_id}/agents/{agent_id}/skills` - 获取技能清单
- `PUT /api/runs/{run_id}/agents/{agent_id}/skills` - 覆盖技能清单
- `GET /api/community-skills` - 获取社区技能列表
- `POST /api/runs/{run_id}/agents/{agent_id}/skills/install` - 安装社区技能
- `GET /api/runs/{run_id}/team/export` - 导出团队 YAML
- `POST /api/runs/team/import` - 导入团队 YAML
- `POST /api/runs/{run_id}/actions` - 提交 `sop.replace` 动作

## 手动验证清单

- [ ] 任务详情显示 Skills 面板（列表 + 安装按钮）
- [ ] Skills search returns results and renders list
- [ ] NL install installs top skill and updates list
- [ ] 导出 YAML 文件成功下载
- [ ] 粘贴 YAML 导入并创建新 run

## WebSocket 连接

WebSocket 端点格式:
```
wss://roboard.duckdns.org/ws/runs/{run_id}
# or (if gateway is bound to localhost:8082)
ws://localhost:8082/ws/runs/{run_id}
```

- 使用 gateway 同源策略
- 建立连接后可实时接收运行事件

接口契约规范（对外约定统一口径）：`docs/specs/2026-03-02-interface-contract.md`

## 如何运行

### 推荐方式 (使用 gateway)

注意：项目根 `docker-compose.yml` 默认不会把 gateway 暴露到宿主机端口；
本地开发如果不能直接访问 `https://roboard.duckdns.org/`，需要额外绑定 gateway 端口（例如 `127.0.0.1:8082->80`）或在目标部署机上验证。

端口约定提示：
- split 部署时，前端 host 的 API 必须通过 `API_BACKEND_URL` 指向 worker host 的 `0.0.0.0:8000`。
- 若 worker 端口未开放，将导致 `/api/*` 502。

1. 启动所有服务:
```bash
docker compose up -d
```

2. 在浏览器中打开:
```
https://roboard.duckdns.org/
# or (if gateway is bound to localhost:8082)
http://localhost:8082/
```

3. 点击 Add Task 按钮创建新任务
