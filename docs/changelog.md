# Linpo 文档变更记录

## 2026-03-25

- 文档目录收敛为 `docs/` 唯一权威来源。
- 文档命名改为短名：`v0.6.md`、`test-resources.md`。
- 移除独立计划目录，执行约束并入 PRD 与 Architecture。
- 移除旧版与废弃文档，避免并行口径。
- 合并 `operations + reference` 为 `docs/resources/test-resources.md`。
- 文档目录入口统一回收到 `README.md`。
- 补回关键联调资源：`ravin` 地址、OpenClaw `claw1/2/3` Token、运行时环境变量前置条件、保留字稳定转义规则。
- 新增治理规则：subagent 默认模型为 `gpt-5.3-codex`。
- 补回并更新 OpenClaw 全量接口文档：`docs/resources/openclaw-api-catalog.md`（切换为 v0.6 接入状态口径，含未接入项）。
- 校正文档漂移：`chat.send` / `chat.abort` / `sessions.reset` / `sessions.delete` 状态更新为 `✅ 已接入（Adapter+HTTP）`，并补充 v0.6 路由映射。

## 维护规则

- 只记录“文档结构与治理口径”的关键变化。
- 业务功能变更仍以代码提交历史为主，不在此做流水账。
