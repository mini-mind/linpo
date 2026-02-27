# sandbox-template

## OVERVIEW
Template generator service for sandboxed skills.
Provides internal-only endpoints for skill template scaffolding.

## STRUCTURE
```
sandbox-template/
├── app/              # FastAPI app
├── tests/            # pytest tests
├── requirements.txt
└── requirements-dev.txt
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| API handlers | sandbox-template/app/main.py | `/templates/skill` + `/health` |
| Tests | sandbox-template/tests/ | pytest `test_*.py` |

## CONVENTIONS
- Internal auth uses `X-Internal-Key` (`INTERNAL_API_KEY` required).
- Env vars: `SERVICE_NAME`, `INTERNAL_API_KEY`.
- 每改完一个服务就立即更新相关的 `AGENTS.md` 并完成该服务测试。

## ANTI-PATTERNS
- Do not allow unauthenticated `/templates/*` calls.
- Do not log raw secrets or internal keys.

## COMMANDS
```bash
cd sandbox-template
. .venv/bin/activate
python -m pytest -q
```
