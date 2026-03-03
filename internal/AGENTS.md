# internal

## OVERVIEW
内部服务层，聚合 LLM、搜索代理、技能执行与模板生成，默认仅内网可访问。

## STRUCTURE
```
internal/
├── llm-gateway/
├── mcp-server/
├── skill-gateway/
├── sandbox-template/
└── searxng/
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| LLM 转发 | `internal/llm-gateway/app/main.py` | `/internal/llm/chat` 入口 |
| 搜索代理 | `internal/mcp-server/app/main.py` | `/search` 到 searxng 转发 |
| 技能执行网关 | `internal/skill-gateway/app/main.py` | `/skills/*` 内部调用 |
| 模板生成 | `internal/sandbox-template/app/main.py` | `/templates/*` 模板接口 |
| 搜索配置 | `internal/searxng/config/settings.yml` | searxng 行为配置 |

## OWNERSHIP
- Lead: @platform

## ANTI-PATTERNS
- ❌ 将 internal 服务端口直接暴露到公网。
- ❌ 跳过 `X-Internal-Key` 校验。
- ❌ 在代码或文档中硬编码搜索/LLM 密钥。

## LINKS
- [CONSTITUTION](../docs/CONSTITUTION.md)
