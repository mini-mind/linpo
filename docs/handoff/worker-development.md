# Worker 开发交接指南

本文档用于把后续开发工作从本机迁移到 worker 主机进行（主要原因：本机内存过小）。

重要：本交接仅涉及“开发工作位置”迁移，不改变现网各服务的运行位置。

## 当前运行位置（保持不变）

- 前端相关服务：仍在本机器运行
- 租户工作空间相关服务：仍在 worker 上运行

我们只把“代码编辑/调试/迭代开发”迁移到 worker 上承接。

## Worker 基本信息

- 主机：`175.178.213.10`
- 用户：`ubuntu`
- 目标目录：`~/projects/roboard`

## 在 worker 上安装/配置 opencode

opencode 配置文件路径（复制自本机）：

- `~/.config/opencode/opencode.json`

可执行文件路径（复制自本机）：

- `~/.opencode/bin/opencode`

建议在 `~/.bashrc` 中加入：

```bash
export PATH="$HOME/.opencode/bin:$PATH"
```

## 代码同步策略

优先目标：确保 worker 上的代码与本机一致，包含本机未提交但需要交接的文档变更。

推荐方式：使用 rsync 同步整个仓库到 worker（排除 `.env` 等敏感文件）。

说明：如果你选择仅 `git clone`，则无法带上本机未提交的文档与改动；但后续可以在 worker 上自行提交。

## 开发约束（务必遵守）

1. 人类文档与运行时 prompts 分离
   - `docs/`：面向人类/产品/研发/运维
   - `prompts/`：运行时角色提示词（仅供应用内 Agent 使用）

2. P0 优先级（来自最新决策）
   - 状态协议（前端生命线）
   - 允许停下来向用户确认（open questions / human-in-the-loop）
   - 放弃 Vercel 动态部署独立子域，复用现有能力

## 交接完成的判定

- worker 上可以运行 `opencode --version`
- worker 上 `~/projects/roboard` 目录存在且内容为最新
- 在 worker 上以最新 PRD 为准推进开发：`docs/prd/2026-02-26-lingban-prd-v3.0.md`
