# 交接文档：重构收尾 + Agent 模板库

> 日期: 2026-03-02
> 状态: **已完成**
> 作者: Sisyphus Agent

## 完成状态

### 全部完成 ✅

1. **重构收尾**
   - ✅ 旧名清零检查（无 `api-backend`/`agent-manager` 残留）
   - ✅ compose 配置验证通过
   - ✅ api 测试: **64 passed** (新增 5 个模板测试)
   - ✅ dispatch 测试: 7 passed
   - ✅ edge/searxng AGENTS.md 已创建

2. **文档更新**
   - ✅ PRD v3.0 更新：3.7 节从"团队架构导出/导入"改为"Agent 模板库"
   - ✅ 新增 `docs/specs/2026-03-02-agent-template-library.md` 规格文档
   - ✅ 更新 `docs/architecture/service-map.md` 添加预制 Agent 架构

3. **预制 Agent 模板**
   - ✅ 创建 `shared/agent-templates/` 目录
   - ✅ 创建 `searcher.yaml` - 搜索专家（对接 searxng）
   - ✅ 创建 `analyzer.yaml` - 分析专家
   - ✅ 创建 `writer.yaml` - 撰写专家
   - ✅ 创建 `reviewer.yaml` - 审核专家

4. **模板库 API**
   - ✅ `api/app/template_loader.py` - 模板加载器
   - ✅ `GET /api/agent-templates` - 列出模板
   - ✅ `GET /api/agent-templates/{template_id}` - 获取模板详情

5. **测试**
   - ✅ `api/tests/test_agent_templates.py` - 5 passed

## 关键文件

### 新增文件

| 文件 | 说明 |
|------|------|
| `docs/specs/2026-03-02-agent-template-library.md` | Agent 模板库规格 |
| `shared/agent-templates/README.md` | 模板库说明 |
| `shared/agent-templates/searcher.yaml` | 搜索专家模板 |
| `shared/agent-templates/analyzer.yaml` | 分析专家模板 |
| `shared/agent-templates/writer.yaml` | 撰写专家模板 |
| `shared/agent-templates/reviewer.yaml` | 审核专家模板 |
| `api/app/template_loader.py` | 模板加载器 |
| `api/tests/test_agent_templates.py` | 模板测试 |

### 修改文件

| 文件 | 变更 |
|------|------|
| `docs/prd/2026-02-26-lingban-prd-v3.0.md` | 3.7 节改为 Agent 模板库 |
| `docs/architecture/service-map.md` | 添加预制 Agent 架构 |
| `api/app/tree_api.py` | 添加模板 API 端点 |
| `shared/AGENTS.md` | 添加 agent-templates 目录说明 |
| `docs/README.md` | 添加模板库规格引用 |

## 架构变更

### Searcher Agent 与 SearXNG 集成

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Lead      │────▶│  Searcher   │────▶│  mcp-server │
│   Agent     │     │   Agent     │     │  (searxng)  │
└─────────────┘     └─────────────┘     └─────────────┘
                          │
                   X-Internal-Key
                   POST /search
```

### 模板引用方式

```yaml
# 团队模板 YAML
agents:
  - id: searcher
    template: searcher  # 引用预制模板
    parent: lead
```

## 验证命令

```bash
# 测试
cd api && .venv/bin/python -m pytest -q
# 输出: 64 passed

cd dispatch && .venv/bin/python -m pytest -q
# 输出: 7 passed

# Compose 验证
TAG=dev ADMIN_API_KEY=dev INTERNAL_API_KEY=dev SEARXNG_SECRET_KEY=dev docker compose config -q
```

## 后续工作（下一 session 可继续）

1. **前端 UI**
   - [ ] 模板库浏览界面
   - [ ] 从模板创建 Agent 入口

2. **增强功能**
   - [ ] `POST /api/runs/{run_id}/agents/instantiate` - 从模板实例化 Agent
   - [ ] 模板验证与管理 API

## 风险与注意事项

- 模板中的工具端点仅允许内部服务地址
- `X-Internal-Key` 由系统自动注入
- 预制模板仅管理员可修改
- 保持现有 export/import API 兼容性