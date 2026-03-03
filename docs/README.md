# 文档中心

[← 返回根 README](../README.md)

本文档是项目文档的导航中心，按渐进式分层结构组织。

## L0: 这是什么？从哪里开始

**项目简介**: RoBoard（灵板）是一个多服务的多智能体团队指挥平台，包含 Agent 框架、浏览器自动化等组件。

**产品需求文档（最新）**:
- [灵板 PRD v3.0](prd/2026-02-26-lingban-prd-v3.0.md)

**快速启动**:
- [快速开始 - 本地运行所有服务](../README.md#快速开始)

## L1: 本地运行与快速验证

**端到端验证**:
- [快速验证 - 租户创建、任务执行、WebSocket 连接](../README.md#快速验证)

**对外契约（推荐口径）**:
- [接口契约规范 (2026-03-02)](specs/2026-03-02-interface-contract.md) - 对齐 PRD v3 的对外接口/鉴权/WS
- [Agent 模板库规格 (2026-03-02)](specs/2026-03-02-agent-template-library.md) - 预制 Agent 与模板库设计
- [接口契约规范 (2026-03-02)](specs/2026-03-02-interface-contract.md) - 对齐 PRD v3 的对外接口/鉴权/WS

**服务组件概述**: 参考 [README.md 服务架构](../README.md#服务架构)

## L2: 架构与 Agent 机制

- [Agent Framework 文档](agent-framework.md) - LLM Gateway、配置分离、安全指南
  - 配置示例与常见错误

**架构与目录索引**:
- [仓库目录结构 (面向多 Session 并行)](architecture/repo-layout.md)
- [服务地图 (多 Session 并行推进)](architecture/service-map.md)
- [子项目化视图 (降低认知成本)](architecture/subprojects.md)

## L2.5: 计划与路线图

- [P1 Agent 招募机制计划 (2026-03-03)](plans/2026-03-03-agent-recruitment-mechanism.md) - P1 主方向：模板/自定义招募、审核与加入 run
- [P1 Skill 生态与团队复用计划 (2026-02-27, 已废弃)](plans/2026-02-27-prd3-p1-skill-ecosystem-implementation-plan.md) - 团队导入/导出方向已下线，Skill 自举与社区技能保留为暂缓

## L3: 部署与运维

**Worker 部署**:
- [Worker Deployment Guide](worker-deployment.md) - 镜像构建、ACR 推送、远程部署
- [Worker Operations Manual](worker-ops.md) - 运维手册、故障排查、磁盘回滚

**生产部署**:
- [Production Deployment Guide](prod-deployment.md) - 生产环境部署配置、镜像备份策略
- [Local Deployment Guide](deployment/local.md) - Docker Compose 本地部署快速指南

**部署脚本**:
- `ops/scripts/deploy_local.sh` - 本地/单机快速部署核心服务（本地构建镜像）
- `ops/scripts/deploy_worker_host.sh` - 本地/拆分部署：仅部署后端重服务（本地构建镜像）
- `ops/scripts/push_worker_images.sh` - 推送 worker 镜像到 Aliyun ACR
- `ops/scripts/deploy_worker.sh` - 在 worker 主机上部署服务
- `ops/scripts/push_frontend_images.sh` - 推送 frontend 镜像到 Aliyun ACR
- `ops/scripts/deploy_ravin_frontend.sh` - 在 ravin(frontend host) 部署 gateway/web-frontend
- `ops/scripts/push_core_images.sh` - 推送全量 core 镜像到 Aliyun ACR
- `ops/scripts/pg_backup.sh` / `ops/scripts/pg_restore.sh` - 数据库备份与恢复

**生产配置**（根 README）:
- [生产配置建议 - Secrets 管理、限流、邮件配置](../README.md#生产配置建议)
- [HTTPS 配置 - Caddy + Let's Encrypt](../README.md#https-配置)
- [数据备份与恢复](../README.md#数据备份与恢复)

## L3.5: 开发交接

- [Worker 开发交接指南](handoff/worker-development.md) - 在 worker 上继续开发（不改变现网运行位置）

## L4: 流程与决策记录

- [项目章程](CONSTITUTION.md) - 项目治理与沟通规则
- [Sisyphus 工作流](process/sisyphus-workflow.md) - 计划、草稿、决策记录系统（`.sisyphus/` 在仓库根目录）
- [多子项目并行推进规则](process/multi-session-ownership.md) - 目录所有权、接口契约同步与并行协作约定
- [产品定位决策记录 (2026-02-13)](decisions/positioning-2026-02-13.md) - 业务专家构建权、长期服务与 P0 方向
- [前端 UI 与版本管理规范 (2026-02-21)](specs/2026-02-21-ui-and-versioning.md) - Task Tree UI 形态、版本 TAG 规则、拆分部署边界
