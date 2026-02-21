web-frontend: Task Tree UI

Task Tree UI 用于创建任务、查看任务树、与任务交互和管理会话。

Files:
  - index.html: Task Tree UI HTML 结构
  - app.js: UI 逻辑和 WebSocket 客户端
  - style.css: 样式

## UI 元素

### 顶部栏
- **会话标签**: `#session-label` 显示当前会话信息
- **登出按钮**: `#logout-btn` 用于退出当前会话

### 任务创建
- **添加任务按钮**: `#add-task-btn` 打开任务创建模态框
- **连接状态**: 状态指示器 `#task-connection-pill` 显示连接状态
- **消息提示**: `#task-message` 显示操作结果消息

### 任务创建模态框
- **模态框**: `#add-task-modal` 任务创建界面
- **表单**: `#add-task-form` 任务创建表单
- **输入框**: `#task-input-nl` 自然语言任务描述输入
- **取消按钮**: `#cancel-task-btn` 取消任务创建
- **关闭按钮**: `#close-modal-btn` 关闭模态框

### 任务详情
- **详情区域**: `#task-details-section` 显示选中任务的详细信息
- **SOP 显示**: `#task-sop-display` 显示任务的 SOP 内容
- **聊天消息**: `#task-chat-messages` 显示任务相关的聊天消息
- **聊天表单**: `#task-chat-form` 发送新消息的表单
- **聊天输入**: `#task-chat-input` 消息输入框

## API 端点

- `POST /api/runs` - 创建新运行
- `GET /api/runs/{run_id}/tree` - 获取运行的任务树

## WebSocket 连接

WebSocket 端点格式:
```
ws://localhost:8082/ws/runs/{run_id}
```

- 使用 gateway 同源策略
- 建立连接后可实时接收运行事件

## 如何运行

### 推荐方式 (使用 gateway)

1. 启动所有服务:
```bash
docker compose up -d
```

2. 在浏览器中打开:
```
http://localhost:8082/
```

3. 点击 Add Task 按钮创建新任务
