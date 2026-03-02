# Agent 模板库

本目录存放预制 Agent 模板（YAML 格式），用于快速实例化专家 Agent。

## 模板列表

| ID | 名称 | 说明 |
|----|------|------|
| searcher | 搜索专家 | 网络搜索与信息收集，对接 searxng |
| analyzer | 分析专家 | 数据分析与报告生成 |
| writer | 撰写专家 | 文档撰写与编辑 |
| reviewer | 审核专家 | 内容审核与质量检查 |

## 模板格式

```yaml
id: searcher              # 模板 ID（唯一）
name: 搜索专家            # 显示名称
description: ...          # 描述
role: searcher            # Agent 角色
version: 1                # 模板版本

skills:                   # 绑定技能
  - name: search_web
    builtin: true

tools:                    # 工具绑定
  - type: http
    name: searxng
    endpoint: http://mcp-server:9000/search
    auth: internal-key

sources:                  # 可信来源（可选）
  - path: docs/knowledge
    label: 知识库

sop: |                    # SOP 模板
  # Searcher SOP
  ...
```

## 使用方式

### API 调用

```bash
# 列出模板
GET /api/agent-templates

# 获取模板详情
GET /api/agent-templates/searcher

# 从模板实例化 Agent
POST /api/runs/{run_id}/agents/instantiate
{
  "template_id": "searcher",
  "parent_agent_id": "123"
}
```

### 团队模板引用

```yaml
agents:
  - id: searcher
    template: searcher    # 引用预制模板
    parent: lead
```

## 文件说明

- `searcher.yaml` - 搜索专家模板，对接 mcp-server/searxng
- `analyzer.yaml` - 分析专家模板
- `writer.yaml` - 撰写专家模板
- `reviewer.yaml` - 审核专家模板