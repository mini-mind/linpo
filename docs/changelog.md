# Linpo 文档变更记录

## 2026-03-26

- 导航口径更新：移动端 `overview` 入口改为 IA 内 icon，移除顶部品牌栏占位；桌面端保留品牌 icon 入口。
- 导航口径追加：移动端用户信息入口并入 IA 最后一项，移除悬浮账户入口。
- PRD 补充“页面借鉴源（设计参考口径）”：明确 `overview/topology/kanban/team` 与跨页契约分别对应的 OpenClaw 参考仓库映射，统一后续设计与改造参考基线。
- 测试资源文档新增“参考项目卖点与侵入性结论（精简）”表，统一 `openclaw` 相关 5 个参考仓库的使用边界认知。
- PRD/Architecture 补充 Topology 对标约束：以 `openclaw-gateway-routing-graph` 为基线，要求骨架常显、链路高亮、业务视图与技术明细并存，并保持 Linpo 现有 realtime 链路。
- PRD/Architecture 追加 Topology 交互与实时约束：默认全页面可交互画布（平移/缩放/fit），详情覆盖层承载；实时优先采用 observer 推送触发并由聚合接口回补。
- PRD/Architecture 调整 Topology 交互约束：移除技术事件明细弹窗，改为 console 输出；顶部控制收敛为悬浮按钮展开；节点新增类型化详情弹窗与纵向拖拽（不持久化）。

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
