# api

## OVERVIEW
对外 FastAPI 服务，提供 HTTP 接口、WebSocket 事件流与内部管理端点。

## STRUCTURE
```
api/
├── app/
├── alembic/
├── tests/
├── requirements.txt
└── requirements-dev.txt
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| API/WS 入口 | `api/app/main.py` | 外部接口、鉴权与事件推送 |
| 运行树与动作 | `api/app/tree_api.py` | run tree、agent 动作与审核相关逻辑 |
| SOP 存储 | `api/app/sop_store.py` | agent FS 中 SOP 读写 |
| 数据库迁移 | `api/alembic/versions/` | schema 变更历史 |
| 回归测试 | `api/tests/` | `pytest` 用例集合 |

## OWNERSHIP
- Lead: @platform

## ANTI-PATTERNS
- ❌ 通过网关暴露 `/internal/*`。
- ❌ 在事件、日志或响应中输出密钥。
- ❌ 把 API 契约变更只写代码不更新 `docs/specs/`。

## LINKS
- [CONSTITUTION](../docs/CONSTITUTION.md)

## NOTES
- 2026-03-03: 已移除历史兼容接口（旧招募、旧团队导入导出、旧 task 视角 WS）；招募能力统一为 run 作用域接口。
