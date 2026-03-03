# Agent 模板库规格

> 版本: 1.0
> 更新日期: 2026-03-02
> 状态: 草案

## 1. 概述

Agent 模板库是 RoBoard 的预制能力基础设施，支持：
- **预制 Agent 模板**：预配置的专家 Agent（如搜索专家、分析专家）
- **团队模板导出/导入**：将团队架构序列化为 YAML/JSON
- **实例化**：从模板快速创建 Agent，自动绑定技能

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
| `/api/agent-templates/{id}` | GET | 获取模板详情 |

> 说明：模板管理通过 `shared/agent-templates/*.yaml` 文件维护，当前不提供模板创建/更新 API。

**鉴权方式**：
- 当前实现为公开只读（无需鉴权）。

**响应 schema（`GET /api/agent-templates`，200）**：
```json
[
  {
    "id": "string",
    "name": "string",
    "description": "string",
    "role": "string",
    "version": 1
  }
]
```

**响应 schema（`GET /api/agent-templates/{id}`，200）**：
```json
{
  "id": "string",
  "name": "string",
  "description": "string",
  "role": "string",
  "version": 1,
  "skills": [{"name": "string"}],
  "tools": [{"type": "http"}],
  "sop": "string | null",
  "metadata": {"key": "value"}
}
```

**错误码说明**：
- `404`：模板不存在（`GET /api/agent-templates/{id}`）

### 3.2 团队模板导出/导入（保留现有）

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/runs/{run_id}/team/export` | GET | 导出团队为 YAML/JSON |
| `/api/runs/team/import` | POST | 从模板创建新 run |

**鉴权方式**：
- 租户鉴权（`X-API-Key`，或 `X-Internal-Key + X-Tenant-ID`，或 `X-Session-Token`/会话 Cookie）。

**响应 schema（`GET /api/runs/{run_id}/team/export`，200）**：
```json
{
  "format": "yaml | json",
  "yaml": "string | null",
  "content": "string | null"
}
```

**请求/响应 schema（`POST /api/runs/team/import`）**：
```json
{
  "yaml": "string"
}
```
```json
{
  "run_id": "string",
  "root_agent_id": "string"
}
```

**错误码说明**：
- `400`：模板 YAML 非法或不满足导入约束（空内容、版本不支持、结构错误等）
- `404`：导出目标 run 不存在

### 3.3 Agent 实例化

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/runs/{run_id}/agents/instantiate` | POST | 从模板实例化 Agent |

**鉴权方式**：
- 必须使用会话鉴权（`session_token`），不支持 `X-API-Key`。
- 推荐通过 `X-Session-Token` 头传递，或使用浏览器会话 Cookie。

**请求字段说明**：
- `template_id` (string, 必填)：模板 ID。
- `parent_agent_id` (string, 可选)：父 Agent ID。不传时默认挂到 `run.root_agent_id`；传入时必须是当前 run 内存在的 Agent。
- `overrides` (object, 可选)：覆盖模板字段。
  - `role` (string, 可选)：覆盖角色标识（`role_label`）。
  - `sop` (string, 可选)：覆盖 SOP 文本（`mission.md` 内容）。
  - `skills` (array, 可选)：覆盖技能清单（不传则沿用模板技能）。
  - `tools` (array, 可选)：覆盖工具清单（不传则沿用模板工具）。每个元素必须严格满足 `{type, name, endpoint, auth}` 四个必填字符串字段，且不允许额外字段；非法请求返回 `422` 并包含字段级错误定位。
  - `name` (string, 可选)：覆盖实例显示名称。

**请求示例（最小）**：
```json
{
  "template_id": "searcher",
  "parent_agent_id": "123",
  "overrides": {
    "name": "定制搜索专家"
  }
}
```

**请求示例（完整）**：
```json
{
  "template_id": "searcher",
  "parent_agent_id": "123",
  "overrides": {
    "role": "web_researcher",
    "sop": "# Web Research SOP\n\n1. 搜索\n2. 过滤\n3. 汇总",
    "skills": [
      {
        "name": "search_web",
        "filename": "search_web.py",
        "code": "def run(query: str):\n    return query"
      },
      {
        "name": "citation_minify",
        "filename": "citation_minify.py"
      }
    ],
    "tools": [
      {
        "type": "http",
        "name": "searxng",
        "endpoint": "http://mcp-server:9000/search",
        "auth": "internal-key"
      }
    ],
    "name": "定制搜索专家"
  }
}
```

**响应 schema（`200`）**：
```json
{
  "id": "string",
  "parent_agent_id": "string | null",
  "role_label": "string | null",
  "state": "string",
  "current_sop_version_id": "string | null",
  "name": "string | null",
  "current_step": "string | null",
  "plan_subtasks": []
}
```

**错误码说明**：
- `401`：缺少或无效会话（仅支持 session 鉴权）
- `404`：run 不存在、父 Agent 不存在、模板不存在
- `409`：`idempotency_key` 冲突（重复实例化请求）
- `400`：请求参数非法（例如 `template_id` 为空、技能文件名非法、技能 code 非法）
- `500`：实例化后文件落盘失败（`Failed to materialize agent files`）

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
