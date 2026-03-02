# 子项目: llm-and-search

## Scope
LLM 内部代理与搜索:
- llm-gateway: 统一的内部 LLM 调用入口
- mcp-server: 搜索代理 (SearXNG proxy)
- searxng: 搜索引擎配置与数据

## Owned Paths
- `llm-gateway/**`
- `mcp-server/**`
- `searxng/**`

## Provides
- llm-gateway: `POST /internal/llm/chat`
- mcp-server: `POST /search`

## Local Verification
- `cd llm-gateway && . .venv/bin/activate && python -m pytest -q`
- `cd mcp-server && . .venv/bin/activate && python -m pytest -q`
