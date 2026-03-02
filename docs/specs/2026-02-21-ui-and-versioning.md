# 前端 UI 与版本管理规范

**日期**: 2026-02-21
**背景**: 修复 Task Tree UI 在 dirty tag 中丢失后重新部署的规范记录

## 当前前端形态

- **Task Tree UI**: 当前生产环境前端形态
  - 关键 DOM id: `add-task-btn`, `task-tree-root`, `task-sop-display`
  - 功能: 目录树 + TODO/计划列表展示
  - 术语说明: 本文 SOP 指 TODO/计划列表，来源为 `plan.md` 并解析为 `plan_subtasks`。当前实现仍保留 SOP 模板与计划列表并存。

## 版本与 TAG 规则

- **生产环境禁止**: dirty tag、latest tag
- **TAG 格式**: `YYYYMMDD-<git-short-sha>` (例如: `20260220-1226d16`)
- **一致性要求**: 前端与网关必须使用同一个 TAG

## 拆分部署边界

- **ravin 主机**: `68.64.179.125`，只跑 `edge/gateway/web-frontend/searxng`
  - searxng 稳定不重启
- **本机/worker**: 跑重服务 (api, dispatch, worker-playwright 等)

## 操作入口

- `ops/scripts/push_frontend_images.sh` - 推送前端镜像
- `ops/scripts/deploy_ravin_frontend.sh` - 部署 ravin 前端
- `ops/scripts/deploy_worker_host.sh` - 部署 worker 服务
