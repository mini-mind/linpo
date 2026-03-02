# docs

## OVERVIEW
Human documentation hub with layered navigation and dated records.

## STRUCTURE
```
docs/
├── README.md          # L0-L4 navigation
├── deployment/        # local/prod guides
├── plans/             # implementation plans (YYYY-MM-DD-*)
├── specs/             # specs (YYYY-MM-DD-*)
├── prd/               # product docs
├── decisions/         # decision records
├── process/           # workflow conventions
└── handoff/           # development handoff guides
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Doc index | docs/README.md | L0-L4 navigation |
| Workflow rules | docs/process/sisyphus-workflow.md | `.sisyphus` conventions |
| Governance | docs/CONSTITUTION.md | Project rules |
| Deployment | docs/deployment/local.md | Local compose flows |

## CONVENTIONS
- Dated files use `YYYY-MM-DD-<topic>.md`.
- Plans/specs/decisions are additive; avoid overwriting history.
- 尽可能用中文与写文档，除非用户明确要求使用其他语言。

## OWNERSHIP
- Owned paths: `docs/**`
- 禁止跨目录修改：默认不修改非 `docs/**` 的文件；跨目录协作先在文档对齐（契约/接口/术语），再由对应 owner 实现。
- 契约优先：对外接口/headers/schema 的变更先更新 `docs/specs/`。
- 交接要求：跨子项目协作必须补充 `docs/handoff/YYYY-MM-DD-<topic>.md`（目标/影响/验证/遗留/风险）。

## ANTI-PATTERNS
- Do not include secrets in docs.
- Do not change legacy docs without noting current status.

## NOTES
- Remove or archive docs that contradict the current PRD.
- 2026-02-27: 文档已对齐 PRD v3（intervention 流程）。
