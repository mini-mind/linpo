# skill-gateway

## OVERVIEW
Docker sandbox executor gateway for skill creation and execution.
Currently a minimal placeholder that validates internal auth and echoes input.

## STRUCTURE
```
internal/skill-gateway/
├── app/              # FastAPI app
├── tests/            # pytest tests
├── requirements.txt
└── requirements-dev.txt
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| API handlers | internal/skill-gateway/app/main.py | `/skills/create` + `/skills/execute` + `/health` |
| Health tests | internal/skill-gateway/tests/test_health.py | Minimal smoke test |

## CONVENTIONS
- Internal auth uses `X-Internal-Key` (`INTERNAL_API_KEY` required, comma-separated allowed).
- Env vars: `SERVICE_NAME`, `SKILL_RUNNER_IMAGE` (optional, placeholder), `INTERNAL_API_KEY`.
- Request context uses `X-Request-ID` + contextvars for trace/tenant/task.
- 每改完一个服务就立即更新相关的 `AGENTS.md` 并完成该服务测试。

## OWNERSHIP
- Owned paths: `internal/skill-gateway/**`
- 禁止跨目录修改：默认不修改非 `internal/skill-gateway/**` 的文件；跨服务契约变更先落到 `docs/specs/`。
- 放弃向后兼容：沙箱执行器契约变更必须先对齐文档。
- 验证要求：至少运行一次 `python -m pytest -q`（见 COMMANDS）。

## ANTI-PATTERNS
- Do not allow unauthenticated `/skills/*` calls.
- Do not log raw secrets or internal keys.

## COMMANDS
```bash
cd internal/skill-gateway
. .venv/bin/activate
python -m pytest -q
```
