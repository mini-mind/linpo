# 多子项目并行推进: 目录所有权与协作规则

[← 返回文档中心](../README.md)

本文档用于将 RoBoard 按“目录/服务边界”拆分为多个并行子项目推进, 并提供最小耦合的同步规则。

目标:
- 并行推进时尽量避免冲突 (git 冲突/语义冲突/接口漂移)
- 将跨服务耦合点收敛为少数“契约文件”, 其余改动各自闭环
- 让后续推进可以按子目录独立开工、独立验证、独立回滚

非目标:
- 不修改 `docs/CONSTITUTION.md` 中的章程 (本文为工程协作约定, 不替代章程)

---

## 核心原则

1) 单一同步锚点: 接口契约
- 所有跨服务协作默认以“接口契约文档”为准, 口头约定无效。
- 契约变更必须先落到 `docs/specs/`（由 `docs/` owner 维护），其他 owner 再按契约实现。

2) 目录所有权: 每个子项目只改自己目录
- 每个子项目有明确的“允许修改目录清单”。
- 默认禁止跨目录修改; 若确实需要跨目录, 先改契约再由对应所有者落地。

3) 破坏性变更显式化
- 本仓库默认不做向后兼容；破坏性变更必须先落到契约文档并标记 breaking change。
- 实现侧与文档必须同步更新，禁止“只改实现不改契约”。

4) 独立验证: 每个子项目必须能独立跑测试/验证
- 任何实现改动都要在本服务目录下可验证 (pytest/build/手工清单)。

---

## 子项目划分与目录所有权

推荐 6 个子项目（外加可选 ops/observability）, 每个子项目对应目录边界:

### docs: 接口契约与文档总控 (同步锚点)

负责目录:
- `docs/`

负责内容:
- 维护接口契约与术语表 (建议新增/维护 `docs/specs/YYYY-MM-DD-api-contract.md`)
- 对齐各服务 README 的接口章节 (只改文档, 不改代码)

禁止范围:
- 禁止修改任何 `*/app/`、`*/tests/` 代码

### api: 对外 HTTP/WS

负责目录:
- `api/`

负责内容:
- 外部 API + WebSocket 实现与测试
- `api/README.md`, `api/AGENTS.md`

### dispatch: 调度与队列

负责目录:
- `dispatch/`

负责内容:
- `/internal/dispatch`、Redis streams 消费/重试/死信
- 对 api 的事件上报一致性
- `dispatch/README.md`, `dispatch/AGENTS.md`

### browser: 浏览器执行链 (worker-playwright + playwright-gateway)

负责目录:
- `browser/worker-playwright/`
- `browser/playwright-gateway/`

负责内容:
- 两套 `/run` 的输入/输出契约落地
- 内部鉴权头与 trace 传递

### internal: 内部能力网关 (skill/llm/mcp)

负责目录:
- `internal/skill-gateway/`
- `internal/llm-gateway/`
- `internal/mcp-server/`

负责内容:
- `/skills/*`, `/internal/llm/chat`, `/search` 的接口与测试

### edge-ui: 入口与前端 (gateway/edge/web-frontend)

负责目录:
- `edge-ui/gateway/`
- `edge-ui/edge/`
- `edge-ui/web-frontend/`

负责内容:
- 路由/缓存/CORS/WS 转发路径
- 前端调用路径与文案术语统一

硬约束:
- 不允许通过 gateway 暴露 `/internal/*`

### (可选) ops: 部署与可观测性 (当冲突变多时再启用)

负责目录:
- `ops/deploy/`
- `ops/scripts/`
- `shared/observability/`

负责内容:
- Compose 变体, 部署脚本, Prometheus 配置等

---

## 允许修改/禁止修改清单 (按 glob)

为了便于执行, 给出每个子项目的允许修改 glob:

- docs: `docs/**`
- api: `api/**`
- dispatch: `dispatch/**`
- browser: `browser/**`
- internal: `internal/**`
- edge-ui: `edge-ui/**`
- ops: `ops/**`, `shared/observability/**`

默认禁止:
- 在子项目 X 中修改子项目 Y 的目录
- 直接修改 `docs/CONSTITUTION.md` (需要单独确认流程)

---

## 接口契约工作流 (强制)

当你需要跨服务协作时, 统一走下面流程:

1) docs 更新契约文档
- 记录: 端点、方法、鉴权头、请求/响应 schema、错误码、兼容策略。
- 任何“新增字段/更改语义/弃用字段”都必须体现在契约里。

2) 相关服务 owner 按契约落地
- 每个服务只在自己目录实现。
- 变更必须带本服务的验证证据 (pytest 或可重复手工验证步骤)。

3) 不允许“只改实现不改契约”
- 若实现已经改变但契约没变, 视为接口漂移, 需要立即补契约。

---

## 并行子项目的同步产物 (handoff)

为了让多个子项目可同步推进且互不阻塞, 每个 owner 每次输出 1 份可复制的 handoff 片段, 建议写到:
- `docs/handoff/YYYY-MM-DD-<docs|api|dispatch|browser|internal|edge-ui|ops>.md`

最小 handoff 模板:

```markdown
## 今日变更
- 变更点 1 (文件/端点)
- 变更点 2

## 契约影响
- 是否需要改契约: 是/否
- 若是: 需要修改的条目

## 验证
- 命令: ...
- 结果: ...

## 风险与回滚
- 风险: ...
- 回滚方式: ...
```

---

## 分支与 worktree 约定 (建议)

- 每个子项目使用独立分支: `subproject/<docs|api|dispatch|browser|internal|edge-ui|ops>/<topic>`
- 使用 git worktree 并行: `.worktrees/docs-...`, `.worktrees/api-...` 等
- 禁止在同一 worktree 同时推进多个子项目, 避免未提交改动交叉污染

---

## 常见冲突与处理

1) 文档与实现不一致
- 先补契约 (docs)
- 再改实现 (对应服务 owner)

2) 两个子项目同时需要改一个字段
- 先在契约里定最终名字/语义
- 需要兼容时: 新字段 + deprecated 旧字段

3) 需要跨目录快速修 bug
- 允许紧急修复, 但必须补一条“契约/文档对齐” TODO, 并在同日补齐
