# shared

## OVERVIEW
Shared repo assets used by multiple services (configs, prompts, observability, SOP templates).

## STRUCTURE
```
shared/
├── config/
├── prompts/
├── observability/
├── redis/
└── sops/
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Runtime configs | shared/config/ | Mounted read-only into services |
| Runtime prompts | shared/prompts/ | Agent role/skill prompts (runtime-only) |
| Monitoring | shared/observability/ | Prometheus scrape + alerts |
| SOP templates | shared/sops/templates/ | Markdown templates |

## CONVENTIONS
- Shared assets must stay stable; changes affect multiple services.
- Config/prompts/templates are ASCII-first and must not contain secrets.

## OWNERSHIP
- Owned paths: `shared/**`
- 禁止跨目录修改：默认不修改非 `shared/**` 的文件；变更如影响跨服务契约，先更新 `docs/specs/` 并在 PR/交接中说明。
- 放弃向后兼容：共享目录的路径与挂载点以当前语义目录为准。
- 验证要求：修改共享配置后至少运行一次 `docker compose config -q`，并运行受影响服务的 `python -m pytest -q`。

## ANTI-PATTERNS
- Do not commit `.env` or real provider keys.
- Do not change shared config schema without updating docs/specs.
