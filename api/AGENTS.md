# api

## OVERVIEW
FastAPI service providing external API, internal admin endpoints, and WebSocket event streams.
Built on FastAPI + PostgreSQL + Redis; Agent execution logic remains custom.

## STRUCTURE
```
api/
├── app/              # FastAPI app, models, WS handlers
├── alembic/          # DB migrations
├── tests/            # pytest tests
├── requirements.txt
└── requirements-dev.txt
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| HTTP + WS handlers | api/app/main.py | Large entrypoint, auth + WS snapshots |
| Agent tree API | api/app/tree_api.py | Tree endpoints + FS integration |
| SOP storage | api/app/sop_store.py | SOP reads/writes in agent FS |
| Migrations | api/alembic/versions/ | Schema history |
| Tests | api/tests/ | pytest `test_*.py` |

## CONVENTIONS
- External auth uses `X-API-Key`; internal auth uses `X-Internal-Key` + `X-Tenant-ID`; admin uses `X-Admin-Key`.
- WS connects send a `snapshot` first, then stream incremental events.
- Task event types are mapped to status (`queued|running|needs_human|completed|failed`).
- 每改完一个服务就立即更新相关的 `AGENTS.md` 并完成该服务测试。

## OWNERSHIP
- Owned paths: `api/**`
- 禁止跨目录修改：默认不修改非 `api/**` 的文件；跨服务契约变更先落到 `docs/specs/`，再由各 owner 分别实现。
- 放弃向后兼容：文档与脚本示例统一使用当前语义目录/服务名（不保留旧目录名示例）。
- 验证要求：至少运行一次 `python -m pytest -q`（见 COMMANDS）。

## ANTI-PATTERNS
- Do not expose `/internal/*` via gateway.
- Do not log or store secrets in task events or notifications.

## COMMANDS
```bash
cd api
. .venv/bin/activate
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
python -m pytest -q
```

## NOTES
- Local compose binds `127.0.0.1:8005->8000` for host access.
- Migrations are Alembic-driven; keep schema changes in `alembic/versions`.
- 2026-02-27: Added agent skills manifest API + FS layout for skills, with tests for roundtrip and layout.
- 2026-02-27: Added community skills registry + install API, plus team export/import YAML endpoints.
- 2026-02-27: Added community skill search + NL install, skill catalog tiers (builtin/platform/tenant), and skill bootstrap enqueue endpoint.
- 2026-02-27: Added skill invoke enqueue endpoint `/api/skills/{skill_key}/invoke` for `queue:skill-exec`, and allowed skill.create/execute event types.
- 2026-02-27: Added placeholder Alembic revision `20260219_0006` to repair migration chain.
- 2026-02-27: 新增 `/api/runs/{run_id}/events` 与 `/api/runs/{run_id}/kanban`，测试覆盖见 `tests/test_runs_events_kanban.py`。
- 2026-02-27: 接口删减建议（仅评估）：若前端已完全切换到 run 视图，可评估是否逐步弃用旧的 task 结果/通知接口（`/api/tasks/{task_id}/result`、`/api/tasks/{task_id}/notifications`）及 `ws/events` 路径；需先核实外部依赖后再决定。
- 2026-02-28: 补齐接口文档说明，覆盖 auth、社区技能搜索、NL 安装与 `/ws/runs/{run_id}`。
- 2026-02-28: `/api/agents/{agent_id}/sop` 增加 `version` 返回；默认读取 `mission.md`，显式 version 参数读取对应版本；更新 `test_tree_api.py` 与 `test_actions_sop_replace.py`。
- 2026-02-28: API README 补充 SOP 术语说明（与计划列表并存）。
- 2026-02-28: 新增可选 DISPATCH_URL, 后台调用 /internal/dispatch; 未配置则回退 Redis queue:dispatch。
- 2026-03-03: 移除 P0 可信来源与干预控制能力：删除 `/api/runs/{run_id}/agents/{agent_id}/sources` 与 `/api/runs/{run_id}/interventions`；`/api/runs/{run_id}/actions` 仅保留 `sop.replace`。
