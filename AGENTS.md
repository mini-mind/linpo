# PROJECT KNOWLEDGE BASE

**Generated:** 2026-02-26 12:12:23Z
**Commit:** 661b5cc
**Branch:** main

## OVERVIEW
RoBoard is a multi-service FastAPI backend + static frontend system orchestrated via Docker Compose.
Each service owns its own `app/main.py` entrypoint and `requirements*.txt` dependencies.

## STRUCTURE
```
./
├── docs/       # Human docs and plans
├── api/        # api service
├── dispatch/   # dispatch service
├── browser/    # worker-playwright + playwright-gateway + runner
├── internal/   # llm-gateway + mcp-server + skill-gateway + sandbox-template + searxng
├── edge-ui/    # edge + gateway + web-frontend
├── ops/        # deploy + scripts + runtime artifacts
└── shared/     # shared configs/prompts/templates/observability
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| API/WS behavior | api/app/main.py | FastAPI app, auth, WS events/snapshots |
| Dispatch | dispatch/app/main.py | Redis streams, scheduler, dispatch |
| LLM proxy | internal/llm-gateway/app/main.py | `/internal/llm/chat` only |
| SearXNG proxy | internal/mcp-server/app/main.py | `/search` only |
| Worker API | browser/worker-playwright/app/main.py | `/run` internal-only |
| Playwright runner | browser/playwright-gateway/app/main.py | Docker runner orchestration |
| Skill gateway | internal/skill-gateway/app/main.py | `/skills/*` internal-only |
| Sandbox template | internal/sandbox-template/app/main.py | `/templates/*` internal-only |
| UI | edge-ui/web-frontend/index.html + app.js | No build step |
| Routing | edge-ui/gateway/nginx.conf + edge-ui/edge/Caddyfile | `/api`, `/ws`, `/` routing |
| Deployment | ops/deploy/* | prod/worker compose |
| Ops scripts | ops/scripts/* | deploy/push/backup/verify |

## CODE MAP
| Symbol | Type | Location | Refs | Role |
|--------|------|----------|------|------|
| app | FastAPI | api/app/main.py | high | Core API + WS entrypoint |
| app | FastAPI | dispatch/app/main.py | high | Dispatch + scheduler entrypoint |
| app | FastAPI | browser/worker-playwright/app/main.py | high | Worker API entrypoint |
| app | FastAPI | browser/playwright-gateway/app/main.py | high | Runner orchestration entry |
| app | FastAPI | internal/llm-gateway/app/main.py | high | LLM proxy entrypoint |
| app | FastAPI | internal/mcp-server/app/main.py | high | SearXNG proxy entry |

## CONVENTIONS
- Services use `app/main.py` + `tests/` with pytest-style `test_*.py`.
- Auth headers are split by boundary: `X-API-Key`, `X-Internal-Key`, `X-Admin-Key`.
- Local compose binds `api` to `127.0.0.1:8005->8000` by default.
- No CI config files; builds are via Docker Compose + scripts.
- 每改完一个服务就立即更新相关的 `AGENTS.md` 并完成该服务测试。
- 每次完成版本更新（TAG/镜像）必须完成测试、commit、部署。
- 复杂任务尽量拆分给子代理并行推进。
- 2026-03-01: 多子项目并行推进规则见 `docs/process/multi-session-ownership.md`。
- 必须用中文交流与写文档，除非用户明确要求使用其他语言。
- 禁止多轮压缩；仅允许在执行过程中“不得已”压缩一次，且必须在任务完成后明确告知是否发生压缩。
- 若已发生压缩：必须及时补齐交接文档，并提供新 session 的开头指令模板。
- 每个 agent 必须使用 ReAct 框架执行分配任务（先推理，再行动，最后复盘）。
- 问题一律先追根因：任何“测不通/卡住/报错/没效果”的问题，必须先定位根因并把根因修掉；禁止用“兜底/降级/绕过”把问题掩盖成“好像能用”。如确实需要临时兜底来不中断演示/验收，需要记录到文档中并说明问题的原因，并告知用户。

交接新 session 开头指令模板（发生压缩时必须提供）：
```text
请读取上一轮交接文档并继续：
- 交接文档路径: <path>
- 当前状态: <progress summary>
- 剩余任务: <remaining tasks>
- 关键约束: <constraints>
```

## ANTI-PATTERNS (THIS PROJECT)
- Never commit secrets (see `docs/agent-framework.md`).
- Do not log secrets; keep provider keys out of repo.
- Worker images must not pull from Docker Hub on the worker host.
- Do not assume `npx playwright test` is configured.

## UNIQUE STYLES
- JSON logging with context IDs (trace/tenant/task) in backend services.
- Internal endpoints under `/internal/*` bypass gateway; require internal/admin auth.
- `agent_fs` helpers are duplicated across services; no shared utils package.

## COMMANDS
```bash
# Local compose (core stack)
docker compose up -d

# Deploy helpers
bash ops/scripts/deploy_local.sh
bash ops/scripts/deploy_worker_host.sh

# Worker deployment
INTERNAL_API_KEY=... TAG=YYYYMMDD-<sha> ./ops/scripts/deploy_worker.sh

# Tests (per service)
cd api && .venv/bin/python -m pytest -q
```

## CONSTITUTION

### 沟通语言规则
- 默认用中文与用户交流，除非用户明确要求使用其他语言。

### 章程修改规则
- 涉及本项目的关键规则（例如流程、权限、安全边界、交付标准）的新增或修改，必须先征得用户确认后，才能写入本章程。

### 迭代交付规则
- 每轮迭代完成后，默认进行一次 git commit；并按约定的部署流程部署到可访问环境，方便用户查看实际效果（部署方式需在项目内明确）。
- 部署使用日期型 TAG（例如 `YYYYMMDD-<git-short-sha>`）。
- 经用户授权，可通过 SSH 登录 ravin（68.64.179.125）执行前端/网关/searxng 部署命令（遵守拆分部署：ravin 只跑 edge/gateway/web-frontend/searxng，本机跑重服务）。

### 部署原则
- 拆分部署架构：ravin（68.64.179.125）运行轻量级边缘服务（edge/gateway/web-frontend/searxng），本地机器运行重型服务（api、dispatch、worker-playwright 等）。
- Agent 执行规范：所有 agent 执行任务必须采用 ReAct（先推理、再行动、最后复盘）。
- SSH 授权状态：用户已明确授权通过 SSH 登录 ravin 执行部署命令。

## REACT 执行规范

所有 agent 处理分配任务时必须使用 ReAct，输出结构固定为三段：

1) 推理：
- 明确目标、约束与假设
- 列出需要检查的文件/命令

2) 行动：
- 按步骤执行，记录关键结果（文件、命令、输出）
- 遇到阻塞必须记录原因与下一步

3) 复盘：
- 说明完成情况与验证结果
- 标记遗留问题与风险
- AGENTS.md follows directory precedence: the closest file to the working area applies.
- `.env` is required for secrets; `.env` and `.env.*` are gitignored.
- `.gitignore` also ignores `backups/`, `data/`, `screenshots/`, and `sops/*` (except templates).
- Root `package.json` exists for Playwright tooling; it is ignored by `.gitignore` so changes may not show.
- `docs/` uses dated filenames (`YYYY-MM-DD-*`) for plans/specs/decisions.
