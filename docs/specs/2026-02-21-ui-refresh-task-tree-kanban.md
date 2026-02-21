# UI 刷新规格说明：轻量主题 + 视图切换 + 底部创建入口

**日期**: 2026-02-21  
**范围**: web-frontend  
**目标**:  lighter 视觉，简化导航，增加 Kanban 视图，移动创建入口

---

## 1. 视觉方向

### 1.1 轻量主题（默认，非深色优先）
- **背景**: 纯白 `#ffffff` → 浅灰 `#f8f9fa` 渐变
- **文字**: 深灰 `#212529`（主文字）/`#6c757d`（次要）
- **面板**: 白色 `#ffffff`，边框 `#e9ecef`
- **强调色**: 靛蓝 `#4f46e5`（主按钮）/ 琥珀 `#f59e0b`（状态）
- **字体**: `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto`（保持系统字体）
- **间距**: 8px 基础单位，卡片内 16px，区域间 32px
- **对比度**: WCAG AA 标准（文字:背景 ≥ 4.5:1）

### 1.2 现有元素调整
- 移除深色渐变背景、网格纹理
- 简化 `topbar` 阴影，改为浅色边框
- 按钮样式扁平化，减少渐变

---

## 2. 顶部导航简化

### 2.1 布局结构
```
[Brand] [View Toggle]                     [Session] [Lang] [Logout]
```

### 2.2 组件映射
- **Brand**: `.brand` (`.brand-mark` + `.brand-name`)
- **View Toggle**: 新增 `#view-toggle` 组件（Task Tree | Kanban）
- **Session**: `#session-label`（保持现有）
- **Lang**: `.lang-toggle` > `#lang-zh`, `#lang-en`（保持现有）
- **Logout**: `#logout-btn`（保持现有）
- **移除**: `#add-task-btn`（移至底部浮动）

### 2.3 交互逻辑
- View Toggle 切换 `#task-tree-view` 和 `#kanban-view` 显示
- 默认视图: Task Tree（保持向后兼容）

---

## 3. 视图定义

### 3.1 Task Tree 视图（默认）
- **容器**: `#task-tree-view`（现有）
- **结构**: 左侧树 `#task-tree-root`，右侧详情 `#task-details-section`
- **保持**: 现有 DOM 结构和交互

### 3.2 Kanban 视图（新增）
- **容器**: `#kanban-view`（新增，与 `#task-tree-view` 同级）
- **列**: 三列布局（To Do | In Progress | Done）
- **卡片**: 每个任务显示 `name`, `status`, `assignee`, `dueDate`
- **数据**: 复用 `/api/runs/{run_id}/tree` 响应，客户端分组
- **交互**: 点击卡片打开详情面板（复用现有 `#task-details-section`）

---

## 4. 创建入口迁移

### 4.1 底部浮动按钮
- **按钮**: `#floating-create-btn`（新增，右下角固定）
- **样式**: 圆形，48px，主强调色，阴影 `0 4px 12px rgba(0,0,0,0.15)`
- **图标**: `+` 符号（复用 `.add-task-icon`）
- **位置**: `position: fixed; bottom: 24px; right: 24px;`

### 4.2 快速创建器
- **容器**: `#quick-composer`（新增，绝对定位在按钮上方）
- **结构**: 
  - `textarea#quick-composer-input`（1行高度，自动扩展）
  - `button#quick-composer-submit`（提交）
- **交互**: 
  - 点击 `#floating-create-btn` 显示 `#quick-composer`
  - 按 Enter 发送（Shift+Enter 换行）
  - 提交后调用现有 `POST /api/runs` 逻辑
  - 成功后关闭并清空输入

### 4.3 模态框保留
- **保留**: `#add-task-modal`（用于复杂任务或无障碍访问）
- **触发**: 在 `#quick-composer` 中添加 "展开" 图标按钮

---

## 5. 非目标

- **后端**: 不修改 API 接口或数据库结构
- **搜索**: 不涉及 SearXNG 集成变更
- **深色模式**: 本迭代不实现深色主题切换
- **拖拽**: Kanban 列内拖拽排序不在本期范围

---

## 6. 验收标准（可验证）

### 6.1 功能流程
- [ ] 页面加载默认显示 Task Tree 视图
- [ ] 点击 View Toggle 切换到 Kanban，URL 不变（客户端状态）
- [ ] 点击底部浮动 `+` 按钮弹出快速创建器
- [ ] 输入描述按 Enter 创建任务，成功后树自动刷新
- [ ] 点击 Kanban 卡片打开右侧详情面板（复用现有）
- [ ] 语言切换、登出按钮正常工作

### 6.2 响应式
- [ ] 移动端 ≤768px: 浮动按钮大小 56px，距离边缘 16px
- [ ] 桌面端 >768px: 浮动按钮大小 48px，距离边缘 24px
- [ ] 快速创建器在移动端全宽，桌面端最小 320px

### 6.3 无错误
- [ ] 浏览器控制台无 JavaScript 错误
- [ ] 所有 API 调用返回 200/201
- [ ] 无障碍: 按钮有 `aria-label`，键盘可导航

---

## 7. 实现文件映射

```
web-frontend/
├── index.html          # 新增 #kanban-view, #floating-create-btn, #quick-composer
├── style.css           # 新增 light-theme 变量，调整 topbar 样式
└── app.js              # 新增 view toggle 逻辑，quick composer 交互
```

**具体修改点**:
- `index.html`: 在 `#task-tree-view` 后添加 `#kanban-view` 结构；在 `</main>` 前添加浮动按钮和快速创建器 DOM
- `style.css`: 在 `:root` 添加 light-theme 颜色变量；在文件末尾添加浮动按钮和快速创建器样式
- `app.js`: 在 `initTaskTreePage()` 中添加 `viewToggle` 事件监听；添加 `quickComposer` 显示/隐藏逻辑

---

## 8. Playwright MCP 验证清单

```javascript
// 测试 1: 默认视图和切换
await page.goto('https://roboard.duckdns.org/');
await expect(page.locator('#task-tree-view')).toBeVisible();
await page.click('#view-toggle [data-view="kanban"]');
await expect(page.locator('#kanban-view')).toBeVisible();

// 测试 2: 快速创建
await page.click('#floating-create-btn');
await expect(page.locator('#quick-composer')).toBeVisible();
await page.fill('#quick-composer-input', '测试任务');
await page.press('#quick-composer-input', 'Enter');
await expect(page.locator('.task-tree-node').first()).toContainText('测试任务');

// 测试 3: 响应式检查
await page.setViewportSize({ width: 375, height: 667 });
await expect(page.locator('#floating-create-btn')).toHaveCSS('width', '56px');
```

---

**备注**: 本规格假设现有后端 API 不变，所有变更集中在前端呈现层。