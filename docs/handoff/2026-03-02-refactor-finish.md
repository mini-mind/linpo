# 2026-03-02 Refactor Finish Handoff

## 目标与结论
本轮完成了 RoBoard 仓库的“子项目化 + 语义化目录命名 + 放弃向后兼容”的重构收尾：根目录只保留必要配置与顶层子项目目录，compose 服务名与脚本/文档/监控配置全部对齐新命名（`api`/`dispatch`/`edge`/`gateway`/`web-frontend` 等），并把“每个 agent 只改自己子项目目录”的 ownership 规则写入各子项目 `AGENTS.md`。

最终顶层目录（根目录）：
```
docs/
api/
dispatch/
browser/
internal/
edge-ui/
ops/
shared/
```

## Ownership（并行推进约束）
- 每个子项目目录都有 `AGENTS.md`，定义 Owned paths 与验证要求。
- 跨目录协作默认先更新 `docs/specs/`（契约/术语/接口），再由对应 owner 在自己的目录闭环实现与验证。

新增/补齐：
- `edge-ui/edge/AGENTS.md`
- `internal/searxng/AGENTS.md`

修正：
- `internal/mcp-server/AGENTS.md`：更新 searxng 后端说明，避免提到不存在的 root compose searxng。

## 关键变更点
- 服务名彻底语义化：后端服务统一命名为 `api`，调度服务统一命名为 `dispatch`（放弃旧命名）。
- 目录语义化：旧的“按 session 分区”的命名与引用已从仓库清理；对外文档入口统一到 `docs/README.md`，接口口径统一到 `docs/specs/2026-03-02-interface-contract.md`。
- prod frontend compose 修复：searxng 路径统一到 `internal/searxng/`，并引入 `SEARXNG_ENV_FILE`（默认兜底 `.env.example`）避免缺失 `.env` 阻断 `docker compose config`。

## 验证（可重复命令 + 结果）

### 1) 旧名清零
```bash
rg -n "session-(a-docs|b-api|c-dispatch|d-browser|e-internal|f-edge-ui|g-ops|h-shared)" -S . || true
rg -n "\\bapi[-_]backend\\b|\\bagent[-_]manager\\b" -S . || true
```
结果：0 matches。

### 2) Compose 配置校验（dummy env）
```bash
TAG=dev ADMIN_API_KEY=dev INTERNAL_API_KEY=dev SEARXNG_SECRET_KEY=dev docker compose config -q
ROBOARD_ROOT=/abs/path/to/roboard TAG=dev docker compose -f ops/deploy/prod/docker-compose.frontend.yml config -q
TAG=dev INTERNAL_API_KEY=dev docker compose -f ops/deploy/worker/docker-compose.yml config -q
```
结果：全部 exit code 0。

### 3) 关键服务测试回归
```bash
cd api && .venv/bin/python -m pytest -q
cd dispatch && .venv/bin/python -m pytest -q

bash ops/scripts/verify_no_state_patch_refs.sh
bash ops/scripts/verify_no_kanban_refs.sh
bash ops/scripts/verify_no_legacy_keywords.sh
```
结果（基线）：
- api：`59 passed`
- dispatch：`7 passed`
- state patch：`OK: No state patch references found.`
- kanban legacy：`No legacy view-toggle references found.`
- legacy keywords：exit code 0

## 当前状态与注意事项
- 工作区包含大量 rename/move（重构性质），目前未做 git commit（用户未要求提交）。
- `.env`/密钥类文件仍保持不入库（`internal/searxng/.env.example` 仅为模板）。

## 后续建议（可选）
1) 让 owner 继续按子项目推进：每次改动只触碰 owned paths，并在各自目录完成验证。
2) 若需要提交：建议把当前巨量变更拆成 2-4 个原子 commit（目录/服务名重构、docs/ownership、ops/observability、补齐 AGENTS/handoff）。
3) 若需要部署：按 split 部署架构（frontend host / worker host）分别走 `ops/scripts/*`。
