# sandbox-template

## OVERVIEW
Template generator service for sandboxed skills.
Provides internal-only endpoints for skill template scaffolding.

## STRUCTURE
```
internal/sandbox-template/
├── app/              # FastAPI app
├── tests/            # pytest tests
├── requirements.txt
└── requirements-dev.txt
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| API handlers | internal/sandbox-template/app/main.py | `/templates/skill` + `/health` |
| Tests | internal/sandbox-template/tests/ | pytest `test_*.py` |

## CONVENTIONS
- Internal auth uses `X-Internal-Key` (`INTERNAL_API_KEY` required).
- Env vars: `SERVICE_NAME`, `INTERNAL_API_KEY`.
- 每改完一个服务就立即更新相关的 `AGENTS.md` 并完成该服务测试。

## OWNERSHIP
- Owned paths: `internal/sandbox-template/**`
- 禁止跨目录修改：默认不修改非 `internal/sandbox-template/**` 的文件；跨服务契约变更先落到 `docs/specs/`。
- 放弃向后兼容：模板输入/输出与契约变更必须先对齐文档。
- 验证要求：至少运行一次 `python -m pytest -q`（见 COMMANDS）。

## ANTI-PATTERNS
- Do not allow unauthenticated `/templates/*` calls.
- Do not log raw secrets or internal keys.

## COMMANDS
```bash
cd internal/sandbox-template
. .venv/bin/activate
python -m pytest -q
```
