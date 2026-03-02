# 多 Session 并行推进: 目录所有权与协作规则

[← 返回文档中心](../README.md)

本文档用于将 RoBoard 按“目录/服务边界”拆分为多个并行 Session 推进, 并提供最小耦合的同步规则。

目标:
- 并行推进时尽量避免冲突 (git 冲突/语义冲突/接口漂移)
- 将跨服务耦合点收敛为少数“契约文件”, 其余改动各自闭环
- 让后续推进可以按子目录独立开工、独立验证、独立回滚

非目标:
- 不移动/重命名现有目录
- 不修改 `session-a-docs/CONSTITUTION.md` 中的章程 (本文为工程协作约定, 不替代章程)

---

## 核心原则

1) 单一同步锚点: 接口契约
- 所有跨服务协作默认以“接口契约文档”为准, 口头约定无效。
- 契约变更必须先落到 `session-a-docs/specs/` (由 Session A 维护), 其他 Session 再按契约实现。

2) 目录所有权: 每个 Session 只改自己目录
- 每个 Session 有明确的“允许修改目录清单”。
- 默认禁止跨目录修改; 若确实需要跨目录, 先改契约再由对应所有者落地。

3) 兼容优先: 先新增后弃用
- 破坏性变更必须先在契约里标记 `deprecated`, 保留一个窗口期。
- 实现侧“新增不删”优先, 直到全链路切换完成。

4) 独立验证: 每个 Session 必须能独立跑测试/验证
- 任何实现改动都要在本服务目录下可验证 (pytest/build/手工清单)。

---

## Session 划分与目录所有权

推荐 6 个 Session (外加可选 G), 每个 Session 对应目录边界:

### Session A: 接口契约与文档总控 (同步锚点)

负责目录:
- `session-a-docs/`

负责内容:
- 维护接口契约与术语表 (建议新增/维护 `session-a-docs/specs/YYYY-MM-DD-api-contract.md`)
- 对齐各服务 README 的接口章节 (只改文档, 不改代码)

禁止范围:
- 禁止修改任何 `*/app/`、`*/tests/` 代码

### Session B: api-backend (外部 HTTP/WS)

负责目录:
- `session-b-api/`

负责内容:
- 外部 API + WebSocket 实现与测试
- `session-b-api/README.md`, `session-b-api/AGENTS.md`

### Session C: agent-manager (调度与队列)

负责目录:
- `session-c-dispatch/`

负责内容:
- `/internal/dispatch`、Redis streams 消费/重试/死信
- 对 api-backend 的事件上报一致性
- `session-c-dispatch/README.md`, `session-c-dispatch/AGENTS.md`

### Session D: 浏览器执行链 (worker-playwright + playwright-gateway)

负责目录:
- `session-d-browser/worker-playwright/`
- `session-d-browser/playwright-gateway/`

负责内容:
- 两套 `/run` 的输入/输出契约落地
- 内部鉴权头与 trace 传递

### Session E: 内部能力网关 (skill/llm/mcp)

负责目录:
- `session-e-internal/skill-gateway/`
- `session-e-internal/llm-gateway/`
- `session-e-internal/mcp-server/`

负责内容:
- `/skills/*`, `/internal/llm/chat`, `/search` 的接口与测试

### Session F: 入口与前端 (gateway/edge/web)

负责目录:
- `session-f-edge-ui/gateway/`
- `session-f-edge-ui/edge/`
- `session-f-edge-ui/web-frontend/`

负责内容:
- 路由/缓存/CORS/WS 转发路径
- 前端调用路径与文案术语统一

硬约束:
- 不允许通过 gateway 暴露 `/internal/*`

### (可选) Session G: 部署与可观测性 (当冲突变多时再启用)

负责目录:
- `session-g-ops/deploy/`
- `session-g-ops/scripts/`
- `session-h-shared/observability/`

负责内容:
- Compose 变体, 部署脚本, Prometheus 配置等

---

## 允许修改/禁止修改清单 (按 glob)

为了便于执行, 给出每个 Session 的允许修改 glob:

- Session A: `session-a-docs/**`
- Session B: `session-b-api/**`
- Session C: `session-c-dispatch/**`
- Session D: `session-d-browser/**`
- Session E: `session-e-internal/**`
- Session F: `session-f-edge-ui/**`
- Session G: `session-g-ops/**`, `session-h-shared/observability/**`

默认禁止:
- 在 Session X 中修改 Session Y 的目录
- 直接修改 `session-a-docs/CONSTITUTION.md` (需要单独确认流程)

---

## 接口契约工作流 (强制)

当你需要跨服务协作时, 统一走下面流程:

1) Session A 更新契约文档
- 记录: 端点、方法、鉴权头、请求/响应 schema、错误码、兼容策略。
- 任何“新增字段/更改语义/弃用字段”都必须体现在契约里。

2) 相关服务 Session 按契约落地
- 每个服务只在自己目录实现。
- 变更必须带本服务的验证证据 (pytest 或可重复手工验证步骤)。

3) 不允许“只改实现不改契约”
- 若实现已经改变但契约没变, 视为接口漂移, 需要立即补契约。

---

## 并行 Session 的同步产物 (handoff)

为了让多个 Session 可同步推进且互不阻塞, 每个 Session 每次输出 1 份可复制的 handoff 片段, 建议写到:
- `session-a-docs/handoff/YYYY-MM-DD-session-<A|B|C|D|E|F|G>.md`

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

- 每个 Session 使用独立分支: `session/<A|B|C|D|E|F|G>/<topic>`
- 使用 git worktree 并行: `.worktrees/session-A-...`, `.worktrees/session-B-...`
- 禁止在同一 worktree 同时推进多个 Session, 避免未提交改动交叉污染

---

## 常见冲突与处理

1) 文档与实现不一致
- 先补契约 (Session A)
- 再改实现 (对应服务 Session)

2) 两个 Session 同时需要改一个字段
- 先在契约里定最终名字/语义
- 需要兼容时: 新字段 + deprecated 旧字段

3) 需要跨目录快速修 bug
- 允许紧急修复, 但必须补一条“契约/文档对齐” TODO, 并在同日补齐
