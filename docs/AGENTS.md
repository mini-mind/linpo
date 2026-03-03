# docs

## OVERVIEW
项目文档中心，负责规范、规格、流程与部署说明的统一入口。

## STRUCTURE
```
docs/
├── README.md
├── CONSTITUTION.md
├── specs/
├── plans/
├── process/
├── deployment/
├── decisions/
└── handoff/
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| 文档导航 | `docs/README.md` | 文档总入口与分层索引 |
| 项目章程 | `docs/CONSTITUTION.md` | 治理与协作边界 |
| 接口契约 | `docs/specs/` | 对外 API/WS/header/schema 约定 |
| 流程规范 | `docs/process/` | 多 session 与工作流说明 |
| 部署说明 | `docs/deployment/` | 本地与生产部署文档 |

## OWNERSHIP
- Lead: @platform

## ANTI-PATTERNS
- ❌ 在文档中提交密钥、令牌或真实凭证。
- ❌ 改动服务契约但不同步 `docs/specs/`。
- ❌ 用历史流水账替代可执行文档结构。

## LINKS
- [CONSTITUTION](CONSTITUTION.md)
