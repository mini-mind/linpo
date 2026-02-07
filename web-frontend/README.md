web-frontend: Minimal 3D Dashboard

这是一个轻量级实时仪表板，用于监控事件流。

Files:
  - index.html: 3D 仪表板 HTML 结构
  - app.js: Three.js 3D 可视化和 WebSocket 客户端
  - style.css: 最小化样式

## How to Run

### 推荐方式 (使用 gateway)

1. 启动所有服务:
```bash
docker compose up -d
```

2. 在浏览器中打开:
```
http://localhost:8082/
```

3. 输入 API Key 和 Task ID 后点击 Connect 按钮

### WebSocket 连接

WebSocket 端点格式:
```
ws://localhost:8082/ws/events?api_key=...&task_id=...
```

- 使用 gateway 同源策略
- 外部客户端使用 `api_key` + `task_id` 查询参数
- tenant_id 通过 api_key 自动解析，无需手动提供

**Required Input:**
- API Key: 连接认证必需
- Task ID: 任务标识符

注意: 旧版文档中提到的 `tenant_id` 参数仅用于内部服务，外部客户端使用 `api_key` 即可。
