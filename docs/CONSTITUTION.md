# 项目章程

## 沟通语言规则

默认用中文与用户交流，除非用户明确要求使用其他语言。

## 章程修改规则

涉及本项目的关键规则（例如流程、权限、安全边界、交付标准）的新增或修改，必须先征得用户确认后，才能写入本章程。

## 迭代交付规则

每轮迭代完成后，默认进行一次 git commit；并按约定的部署流程部署到可访问环境，方便用户查看实际效果（部署方式需在项目内明确）。

- 部署使用日期型 TAG（例如 `YYYYMMDD-<git-short-sha>`）
- 经用户授权，可通过 SSH 登录 ravin（68.64.179.125）执行前端/网关/searxng 部署命令（遵守拆分部署：ravin 只跑 edge/gateway/web-frontend/searxng，本机跑重服务）

## 部署原则

- **拆分部署架构**：ravin（68.64.179.125）运行轻量级边缘服务（edge/gateway/web-frontend/searxng），本地机器运行重型服务（api-backend、agent-manager、worker-playwright 等）
- **SSH 授权状态**：用户已明确授权通过 SSH 登录 ravin 执行部署命令
