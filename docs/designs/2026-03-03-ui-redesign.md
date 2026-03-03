# UI 重新设计文档

**日期**: 2026-03-03  
**版本**: 1.0  
**状态**: 实施中

## 1. 设计目标

基于 PRD v3.0 和 Agent 招募机制，对现有 UI 进行简化和重构：

### 1.1 核心原则
- **简化**: 移除复杂功能，聚焦核心体验
- **聚焦**: Agent 招募和模板库
- **保持**: 核心任务管理流程

### 1.2 移除的功能
- ❌ 可信来源管理界面
- ❌ 干预控制按钮（暂停/继续/重试）
- ❌ 团队导入导出界面

### 1.3 新增的功能
- ✅ Agent 招募界面（从模板招募）
- ✅ 简化的 Agent 管理界面
- ✅ 优化的模板库界面

## 2. 信息架构

### 2.1 页面结构
```
/ (任务树首页)
├── 任务树视图 (Tree View)
├── 事件日志视图 (Log View)
└── 任务看板视图 (Kanban View)

/templates (模板库)
├── 预制 Agent 模板列表
├── 模板详情弹窗
└── 从模板创建 Agent

/agents (Agent 招募) - 新增
├── 可招募 Agent 列表
├── Agent 详情
└── 招募表单
```

### 2.2 导航结构
```
顶部导航栏
├── RoBoard 品牌标识
├── 主导航
│   ├── 任务树
│   ├── 模板库
│   └── Agent 招募 (新增)
└── 用户菜单
    ├── 语言切换
    └── 退出登录
```

## 3. 界面设计

### 3.1 任务树首页 (index.html)

#### 保留的核心功能
- ✅ 任务树/日志/看板三种视图切换
- ✅ 创建新任务 (Run)
- ✅ 任务详情查看 (状态、计划列表)
- ✅ 用户会话管理

#### 移除的功能
- ❌ 可信来源面板
- ❌ 技能管理面板
- ❌ 团队模板导出/导入
- ❌ 控制按钮（暂停/继续/重试）

#### 简化的任务详情弹窗
```html
任务详情弹窗
├── 任务状态
├── 任务摘要
└── 计划子任务列表 (TODO)
```

### 3.2 Agent 招募界面 (agents.html) - 新增

#### 页面结构
```html
Agent 招募页面
├── 页面标题区
│   ├── 标题：Agent 招募
│   └── 副标题：从预制模板或自定义创建 Agent
├── Agent 列表区
│   ├── 预制 Agent 模板卡片
│   └── 自定义 Agent 创建入口
└── Agent 详情弹窗
    ├── 基本信息（角色、职责）
    ├── 绑定技能
    ├── 工具配置
    └── 招募表单
```

#### Agent 卡片设计
```html
<article class="agent-card">
  <div class="agent-card-header">
    <div class="agent-card-icon">🤖</div>
    <div class="agent-card-title-group">
      <h3 class="agent-card-title">搜索专家</h3>
      <span class="agent-card-role">searcher</span>
    </div>
  </div>
  <p class="agent-card-description">专门用于网络搜索和信息收集的专家 Agent</p>
  <div class="agent-card-tags">
    <span class="agent-tag">搜索</span>
    <span class="agent-tag">信息收集</span>
  </div>
  <div class="agent-card-footer">
    <button class="btn btn-primary">招募此 Agent</button>
  </div>
</article>
```

### 3.3 模板库界面 (templates.html) - 优化

#### 保留的功能
- ✅ 模板卡片列表
- ✅ 模板详情查看
- ✅ 从模板创建 Agent

#### 优化的交互
- 简化弹窗内容，聚焦关键信息
- 强化"使用此模板"操作
- 改进响应式布局

## 4. 样式规范

### 4.1 颜色方案
保持现有工业夜间主题：
- 主色调：深蓝 (#070d14)
- 强调色：青色 (#3bd1ff)
- 成功状态：绿色 (#10b981)
- 警告状态：黄色 (#f59e0b)
- 错误状态：红色 (#ef4444)

### 4.2 字体
- 显示字体：Chakra Petch
- 正文字体：IBM Plex Sans

### 4.3 组件样式
- 卡片圆角：12px
- 按钮圆角：999px（胶囊形）
- 间距系统：6px 基数

## 5. 响应式设计

### 5.1 断点
- 移动端：≤768px
- 桌面端：>768px

### 5.2 移动端适配
- 导航栏简化
- 卡片网格单列布局
- 弹窗全宽显示
- 触摸友好的按钮尺寸

## 6. API 集成

### 6.1 现有 API 端点
```javascript
POST /api/runs                    // 创建 run
GET  /api/runs/{run_id}/tree      // 获取任务树
GET  /api/agent-templates         // 获取模板列表
GET  /api/agent-templates/{id}    // 获取模板详情
POST /api/runs/{run_id}/agents/instantiate  // 实例化 Agent
```

### 6.2 需要新增的 API 端点
```javascript
GET  /api/available-agents        // 获取可招募 Agent 列表
POST /api/runs/{run_id}/agents    // 招募 Agent 到 run
```

## 7. 实施计划

### Phase 1: 清理冗余功能 (2026-03-03)
- [ ] 移除可信来源面板
- [ ] 移除技能管理面板
- [ ] 移除团队模板导出/导入
- [ ] 移除控制按钮与干预入口

### Phase 2: Agent 招募界面 (2026-03-03)
- [ ] 创建 agents.html
- [ ] 创建 agents.js
- [ ] 创建 agents.css
- [ ] 实现 Agent 卡片列表
- [ ] 实现 Agent 详情弹窗
- [ ] 实现招募表单

### Phase 3: 优化模板库 (2026-03-03)
- [ ] 简化模板详情弹窗
- [ ] 优化响应式布局
- [ ] 改进交互体验

### Phase 4: 集成测试 (2026-03-03)
- [ ] 验证所有页面功能
- [ ] 测试响应式布局
- [ ] 验证 API 集成

## 8. 文件清单

### 新增文件
- `edge-ui/web-frontend/agents.html` - Agent 招募页面
- `edge-ui/web-frontend/agents.js` - Agent 招募逻辑
- `edge-ui/web-frontend/agents.css` - Agent 招募样式

### 修改文件
- `edge-ui/web-frontend/index.html` - 移除冗余功能
- `edge-ui/web-frontend/app.js` - 清理相关逻辑
- `edge-ui/web-frontend/style.css` - 清理相关样式
- `edge-ui/web-frontend/templates.html` - 优化界面
- `edge-ui/web-frontend/templates.js` - 简化逻辑
- `edge-ui/web-frontend/templates.css` - 优化样式

## 9. 设计决策

### 9.1 为什么移除控制按钮？
PRD 方向调整后仅保留 `sop.replace` 动作，控制按钮（暂停/继续/重试）已无后端能力支撑，继续保留会造成误导并增加界面复杂度。

### 9.2 为什么新增 Agent 招募界面？
PRD v3.0 将"Agent 模板库"升级为核心功能，需要独立的招募界面来展示可招募的 Agent 并简化创建流程。

### 9.3 为什么保留三种视图？
任务树/日志/看板三种视图分别满足不同场景需求：
- 树状视图：查看层级结构
- 日志视图：追踪事件流
- 看板视图：概览任务状态

## 10. 成功指标

- **任务创建时间**: 用户首次创建任务的平均时间 < 2 分钟
- **Agent 招募成功率**: 从模板成功招募 Agent 的比例 > 90%
- **用户满意度**: 界面易用性评分 > 4/5

---

本文档为 UI 重新设计的实施依据，变更需经产品确认。
