# Agent 模板库规格

> 版本: 1.0
> 更新日期: 2026-03-02
> 状态: 草案

## 1. 概述

Agent 模板库是 RoBoard 的预制能力基础设施，支持：
- **预制 Agent 模板**：预配置的专家 Agent（如搜索专家、分析专家）
- **团队模板导出/导入**：将团队架构序列化为 YAML/JSON
- **实例化**：从模板快速创建 Agent，自动绑定技能与可信来源

## 2. 模板格式

### 2.1 Agent 模板 YAML 格式

```yaml
# shared/agent-templates/searcher.yaml
id: searcher
name: 搜索专家
description: 专门用于网络搜索和信息收集的专家 Agent
role: searcher
version: 1

# 技能配置
skills:
  - name: search_web
    builtin: true
  - name: citation_minify
    builtin: true

# 工具绑定
tools:
  - type: http
    name: searxng
    endpoint: http://mcp-server:9000/search
    auth: internal-key

# 可信来源（可选）
sources:
  - path: docs/knowledge
    label: 知识库
    readonly: true

# SOP 模板
sop: |
  # Searcher SOP
  
  职责:
  - 根据关键词进行网络搜索
  - 过滤和整理搜索结果
  - 返回带引用的结果摘要
  
  步骤:
  1. 接收搜索请求
  2. 调用 searxng 执行搜索
  3. 过滤低质量结果
  4. 整理并返回结果

# 元数据
metadata:
  author: roboard
  tags: [search, web, information]
  created_at: 2026-03-02
```

### 2.2 团队模板 YAML 格式

```yaml
version: 1
name: research-team
description: 研究分析团队模板
agents:
  - id: lead
    role: lead
    name: 团队负责人
    sop: |
      # Lead SOP
      职责: 协调团队，汇总结果
    children:
      - searcher
      - analyzer
  
  - id: searcher
    role: searcher
    template: searcher  # 引用预制模板
    parent: lead
  
  - id: analyzer
    role: analyzer
    template: analyzer
    parent: lead
    sop: |
      # Analyzer SOP
      职责: 分析搜索结果，生成报告
```

## 3. API 端点

### 3.1 模板库管理

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/agent-templates` | GET | 列出所有预制模板 |
| `/api/agent-templates/{template_id}` | GET | 获取模板详情 |
| `/api/agent-templates` | POST | 创建新模板（管理员） |
| `/api/agent-templates/{template_id}` | PUT | 更新模板（管理员） |

### 3.2 团队模板导出/导入（保留现有）

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/runs/{run_id}/team/export` | GET | 导出团队为 YAML/JSON |
| `/api/runs/team/import` | POST | 从模板创建新 run |

### 3.3 Agent 实例化

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/runs/{run_id}/agents/instantiate` | POST | 从模板实例化 Agent |

**请求示例**：
```json
{
  "template_id": "searcher",
  "parent_agent_id": "123",
  "overrides": {
    "name": "定制搜索专家",
    "sources": [
      {"path": "custom/docs", "label": "定制文档"}
    ]
  }
}
```

## 4. 预制模板清单

### 4.1 内置模板

| ID | 名称 | 说明 | 绑定技能 |
|----|------|------|----------|
| `searcher` | 搜索专家 | 网络搜索与信息收集 | search_web, citation_minify |
| `analyzer` | 分析专家 | 数据分析与报告生成 | analyze_data |
| `writer` | 撰写专家 | 文档撰写与编辑 | write_document |
| `reviewer` | 审核专家 | 内容审核与质量检查 | review_content |

### 4.2 模板存储位置

```
shared/agent-templates/
├── README.md
├── searcher.yaml
├── analyzer.yaml
├── writer.yaml
└── reviewer.yaml
```

## 5. 预制 Agent 与服务集成

### 5.1 Searcher + SearXNG

Searcher Agent 通过 mcp-server 直接调用 SearXNG：

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Lead      │────▶│  Searcher   │────▶│  mcp-server │
│   Agent     │     │   Agent     │     │  (searxng)  │
└─────────────┘     └─────────────┘     └─────────────┘
                           │
                    X-Internal-Key
                    POST /search
```

**Searcher 工具配置**：
```yaml
tools:
  - type: http
    name: searxng
    endpoint: http://mcp-server:9000/search
    auth: internal-key
    timeout: 10s
```

### 5.2 其他服务集成

| Agent | 服务 | 端点 | 用途 |
|-------|------|------|------|
| Searcher | mcp-server | `/search` | 网络搜索 |
| Browser | worker-playwright | `/run` | 浏览器自动化 |
| Analyzer | llm-gateway | `/internal/llm/chat` | 深度分析 |

## 6. 实现计划

### Phase 1: 基础设施（1 周）
- [ ] 创建 `shared/agent-templates/` 目录
- [ ] 实现模板加载器 (`api/app/template_loader.py`)
- [ ] 添加模板 API 端点

### Phase 2: 预制模板（1 周）
- [ ] 创建 searcher 模板 + searxng 集成
- [ ] 创建 analyzer 模板
- [ ] 创建 writer 模板

### Phase 3: 实例化（1 周）
- [ ] 实现 Agent 实例化逻辑
- [ ] 扩展 `hire_team_from_template` 支持预制模板
- [ ] 添加实例化 API 端点

### Phase 4: 前端 UI（1 周）
- [ ] 模板库浏览界面
- [ ] 从模板创建 Agent 入口
- [ ] 团队模板管理

## 7. 兼容性

### 7.1 现有功能保持

- `/api/runs/{run_id}/team/export` - 保持不变
- `/api/runs/team/import` - 保持不变
- `hire_default_team()` - 保持不变
- `hire_team_from_template()` - 扩展支持预制模板引用

### 7.2 迁移路径

现有团队模板 YAML 格式保持兼容，新增 `template` 字段用于引用预制模板：

```yaml
# 旧格式（保持兼容）
agents:
  - id: searcher
    role: searcher
    sop: "..."
    skills: [...]

# 新格式（引用预制模板）
agents:
  - id: searcher
    template: searcher  # 引用预制模板
    parent: lead
    # 可选：覆盖 SOP/技能
```

## 8. 安全考虑

- 模板中的工具端点仅允许内部服务地址
- `X-Internal-Key` 由系统自动注入，不暴露给用户
- 预制模板仅管理员可修改
- 租户可创建私有模板（存储在租户 FS）

---

本规格为产品与研发协作依据，功能变更需同步更新。