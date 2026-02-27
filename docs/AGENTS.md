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

## ANTI-PATTERNS
- Do not include secrets in docs.
- Do not change legacy docs without noting current status.

## NOTES
- Remove or archive docs that contradict the current PRD.
