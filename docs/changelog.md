# Linpo 文档变更记录

## 2026-03-27

- 产品方向升级为 v0.7：主界面收敛为 `kanban + toolbar`，不再维护多页 IA 作为主产品契约。
- 文档结构改为平铺：新增 `docs/prd.md`、`docs/architecture.md`、`docs/test-resources.md`、`docs/openclaw-api-catalog.md`。
- 治理规则与 README 引用链切换到平铺路径，移除版本化文档路径。
- PRD 明确 v0.7 闭环：`一句话需求 -> 流程图 -> DAG 任务队列 -> 并行执行 -> 统一审批 -> 产出预览/调试`。
- PRD 明确 v0.8 延后项：模板市场、agent 消耗统计、agent 拓扑配置。
- Architecture 增补 Tauri 构建约束与 `claw1` 默认联调边界。
- PRD 路由口径补充 `/landing`，并新增品牌区点击跳转落地页约束（`LP/灵盘`）。
- 看板交互补充：列宽固定并支持横向滚动；agent 视图新增“新增 Agent”入口列。
- 落地页口径补充：`/landing` 支持游客直达访问，页面需突出优势并预留 Image 占位区。

## 2026-03-26

- 导航口径更新：移动端 `overview` 入口改为 IA 内 icon，移除顶部品牌栏占位；桌面端保留品牌 icon 入口。
- 导航口径追加：移动端用户信息入口并入 IA 最后一项，移除悬浮账户入口。
- PRD 补充“页面借鉴源（设计参考口径）”：明确 `overview/topology/kanban/team` 与跨页契约分别对应的 OpenClaw 参考仓库映射，统一后续设计与改造参考基线。
- 测试资源文档新增“参考项目卖点与侵入性结论（精简）”表，统一 `openclaw` 相关 5 个参考仓库的使用边界认知。
- PRD/Architecture 补充 Topology 对标约束：以 `openclaw-gateway-routing-graph` 为基线，要求骨架常显、链路高亮、业务视图与技术明细并存，并保持 Linpo 现有 realtime 链路。

## 2026-03-25

- 文档目录收敛为 `docs/` 唯一权威来源。
- 移除独立计划目录，执行约束并入 PRD 与 Architecture。
- 移除旧版与废弃文档，避免并行口径。
- 文档目录入口统一回收到 `README.md`。
- 补回关键联调资源：`ravin` 地址、OpenClaw `claw1/2/3` Token、运行时环境变量前置条件、保留字稳定转义规则。

## 维护规则

- 只记录“文档结构与治理口径”的关键变化。
- 业务功能变更仍以代码提交历史为主，不在此做流水账。
