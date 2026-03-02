# Polyrepo Migration Plan (物理拆仓)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将 RoBoard 从 monorepo 逐步迁移为 polyrepo, 最终达到“各子项目可独立维护/构建/发布”, 并保留可回滚路径。

**Architecture:** 采用"meta/integrator 仓 + 各服务仓 + shared-assets 仓"的结构. 先做非破坏性的 split/导出与耦合扫描, 再逐步把 compose/scripts 从"路径耦合"改为"镜像耦合", 最后切换生产。

**Tech Stack:** Git subtree split, Docker Compose, FastAPI services.

---

## Phase 0: 契约冻结与子项目清单

**Files:**
- Modify: `session-a-docs/specs/*-api-contract.md` (如不存在, 创建)
- Modify: `subprojects/manifest.json`

**Steps:**
1. 列出所有对外 API/WS/internal API, 明确 owners.
2. 将当前子项目/服务映射写入 manifest.

## Phase 1: 生成可验证的拆仓产物 (本地)

**Files:**
- Use: `session-g-ops/scripts/polyrepo_split_subtree.py`

**Steps:**
1. 在 clean working tree 上运行 split 工具 (优先).
2. 对每个 service repo 运行其本地测试命令.

## Phase 2: 解耦构建与部署 (从路径 -> 镜像)

**Files:**
- Modify: `docker-compose.yml`
- Modify: `session-g-ops/deploy/**`
- Modify: `session-g-ops/scripts/push_*`

**Steps:**
1. 将 compose build.context 改为 image 引用 (TAG pin).
2. 由各 service repo 负责构建并推送镜像.
3. meta repo 只负责 pull + up.

## Phase 3: shared-assets 策略落地

**Options:**
1) shared-assets 独立仓 + submodule (推荐).
2) shared-assets 复制到各 service repo (短期省事, 长期难维护).

**Steps:**
1. 明确哪些资产必须共享 (config/prompts/templates).
2. 将服务端对 assets 的查找改为 env 驱动 (必要时).

## Phase 4: 远端拆仓与切换

**Steps:**
1. 在 GitHub 创建新仓 (命名与权限).
2. 推送 split repo.
3. 生产部署切换到 meta repo + pinned images.
4. 保留 monorepo 回滚标签.

---

## Rollback

- 保留 monorepo 标签与原 compose.
- 新的 meta repo 通过 TAG pin 可回退到上一版本镜像.
