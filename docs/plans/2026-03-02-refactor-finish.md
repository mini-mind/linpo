# Repo Refactor Finish Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 完成本次“子项目化 + 语义化命名 + 放弃向后兼容”的重构收尾，让仓库结构、服务名、文档与部署脚本完全一致，并用可重复的验证命令证明正确。

**Architecture:** 以顶层子项目目录边界作为 ownership 分区（`docs/`、`api/`、`dispatch/`、`browser/`、`internal/`、`edge-ui/`、`ops/`、`shared/`）。放弃向后兼容，统一采用当前语义目录名与 compose 服务名（`api`/`dispatch`/`web-frontend` 等）。所有跨目录变更先通过契约/文档同步，再由各 owner 在各自目录闭环实现与验证。

**Tech Stack:** Git (rename/moves), ripgrep, Docker Compose, FastAPI, pytest, Markdown.

---

### Task 1: 现状快照与“旧名清零”检查

**Files:**
- Modify: (none)

**Step 1: Run checks (must be 0 matches)**

Run:
```bash
git status --porcelain
ls
rg -n "session-(a-docs|b-api|c-dispatch|d-browser|e-internal|f-edge-ui|g-ops|h-shared)" -S . || true
rg -n "\\bapi[-_]backend\\b|\\bagent[-_]manager\\b" -S . || true
```

Expected:
- `rg ... session-(...)` 输出为空
- `rg ... api[-_]backend/agent[-_]manager` 输出为空

**Step 2: Capture root layout**

Run:
```bash
ls | sort
```

Expected: 根目录只包含必要配置文件 + 顶层子项目目录（至少包含 `docs/ api/ dispatch/ browser/ internal/ edge-ui/ ops/ shared/`）。

---

### Task 2: 补齐缺失的子项目 AGENTS.md（edge 与 searxng）

**Files:**
- Create: `edge-ui/edge/AGENTS.md`
- Create: `internal/searxng/AGENTS.md`

**Step 1: Create `edge-ui/edge/AGENTS.md`**

Write a minimal AGENTS doc consistent with repo style:
- Overview + structure
- Owned paths: `edge-ui/edge/**`
- 禁止跨目录修改（契约优先）
- 验证要求：`docker compose config -q` + 手动冒烟（edge 路由可访问）

**Step 2: Create `internal/searxng/AGENTS.md`**

Include:
- Owned paths: `internal/searxng/**`
- 提醒 `.env` 不可提交（仅用 `.env.example`）
- 验证要求：prod compose `config -q` 通过

---

### Task 3: 部署 compose 全量一致性验证（使用 dummy env）

**Files:**
- Modify: (none)

**Step 1: Validate root compose**

Run:
```bash
TAG=dev ADMIN_API_KEY=dev INTERNAL_API_KEY=dev SEARXNG_SECRET_KEY=dev docker compose config -q
```

Expected: exit code 0.

**Step 2: Validate prod frontend compose**

Run:
```bash
ROBOARD_ROOT=/abs/path/to/roboard TAG=dev docker compose -f ops/deploy/prod/docker-compose.frontend.yml config -q
```

Expected: exit code 0.

**Step 3: Validate worker compose**

Run:
```bash
TAG=dev INTERNAL_API_KEY=dev docker compose -f ops/deploy/worker/docker-compose.yml config -q
```

Expected: exit code 0.

---

### Task 4: 关键服务测试回归（必须可重复）

**Files:**
- Modify: (none)

**Step 1: Run api pytest**

Run:
```bash
cd api
.venv/bin/python -m pytest -q
```

Expected: PASS (当前基线为 `59 passed`).

**Step 2: Run dispatch pytest**

Run:
```bash
cd dispatch
.venv/bin/python -m pytest -q
```

Expected: PASS (当前基线为 `7 passed`).

**Step 3: Run ops verification scripts**

Run:
```bash
bash ops/scripts/verify_no_state_patch_refs.sh
bash ops/scripts/verify_no_kanban_refs.sh
bash ops/scripts/verify_no_legacy_keywords.sh
```

Expected:
- state patch 检查输出 `OK: No state patch references found.`
- kanban legacy 检查输出 `No legacy view-toggle references found.`
- legacy keywords 脚本 exit code 0

---

### Task 5: 清理“计划工具产物/未预期文件”并固化提交策略（可选但推荐）

**Files:**
- Modify: `.sisyphus/plans/*` (only if changes are unintended)

**Step 1: Inspect unexpected diffs**

Run:
```bash
git diff --name-only
git diff -- .sisyphus || true
```

Expected:
- 若 `.sisyphus/plans/*` 的变更只是路径/服务名替换导致的同步更新，可以保留。
- 若存在无关内容漂移，回退到合理状态（不要引入“旧名示例”）。

**Step 2: Commit plan (if user requests commit)**

建议拆分为多个原子提交（示例）：
1) `refactor: rename directories and services to semantic names`
2) `docs: align docs and ownership rules with subprojects`
3) `ops: update deploy/scripts and observability for api/dispatch`

---

### Task 6: 最终交付清单（handoff）

**Files:**
- Create: `docs/handoff/YYYY-MM-DD-refactor-finish.md`

**Step 1: Write handoff**

Include:
- 本次重构核心结论（目录/服务名最终形态）
- 关键验证命令与结果（贴 PASS 结论即可）
- 后续并行推进方式（每个 agent 只改 owned paths；跨目录先改 `docs/specs/`）

---

## Execution Options

Plan saved to `docs/plans/2026-03-02-refactor-finish.md`.

1) Subagent-Driven (same session): use `superpowers:subagent-driven-development` and execute tasks one-by-one.

2) Parallel Session (separate): open a new session and use `superpowers:executing-plans` to execute this plan task-by-task.
