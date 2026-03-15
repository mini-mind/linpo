# Python + FastAPI 最小实现基线

> **Status:** 历史草案（已退役）。本文档仅保留为 2026-03-12 的工程基线记录；不代表当前接入方向。当前接入方向为 `registration API + 直接 RESTful 请求`（见 `docs/plans/2026-03-15-external-openclaw-registration-plan.md`）。

## 1. 目标

本文档用于在当前已冻结的 MVP 边界下，补充一份**实现基线**，使后续 subagents 可以在不越界扩展需求的前提下开始编码。

当前实现基线只服务于以下最小目标：

- 建立一个单服务 Python 进程承载 Linpo 的最小真相源
- 支撑 `Session`、`ClawEndpoint`、`Message`、`ReplayRecord` 的最小行为
- 为测试夹具与集成测试提供稳定入口

## 2. 选型结论

当前阶段冻结如下最小实现基线：

- 语言：Python 3.12+
- Web 框架：FastAPI
- 测试框架：pytest
- HTTP 测试：FastAPI `TestClient`
- fixture 编排：docker compose（用于真实 OpenClaw fixture，若不稳定则允许 mock fixture 先行）
- 运行方式：单服务进程
- 存储方式：先采用进程内内存存储，仅用于当前 MVP 验证

## 3. 为什么选择这条基线

选择这条基线的原因：

- 比 Flask 更容易表达请求/响应模型与最小校验边界
- 比更重的异步栈更克制，适合当前 docs-first MVP
- 能快速承接 pytest 驱动的 TDD 流程
- 单服务 + 内存存储可以验证最小闭环，而不提前引入数据库、队列或服务拆分

## 4. 当前阶段不冻结的内容

本文档不冻结以下内容：

- 数据库选型
- 持久化存储
- 鉴权方式
- 长连接 / WebSocket / ACP 协议细节
- 真实 OpenClaw 的长期联调契约
- 生产部署方式

## 5. 最小目录决策

为避免继续停留在 docs-only 状态，当前阶段允许建立以下最小目录：

```text
./
├── pyproject.toml
├── app/
│   ├── __init__.py
│   ├── main.py
│   ├── api/
│   ├── domain/
│   ├── services/
│   └── repositories/
├── tests/
│   ├── unit/
│   └── integration/
└── fixtures/
    ├── mock/
    └── openclaw/
```

约束：

- `app/` 只承载 Linpo 自身最小服务代码
- `tests/` 按 unit / integration 区分最小反馈回路
- `fixtures/` 只承载测试夹具相关配置与脚本，不属于产品代码
- 当前不引入额外 workspace、monorepo 或多服务目录

## 6. 最小实现切面到代码区域的映射

### 6.1 Session 创建与关闭

- `app/domain/`：Session 模型与约束
- `app/services/`：Session 生命周期逻辑
- `app/api/`：最小会话创建/关闭入口
- `tests/unit/`：领域与服务行为测试

### 6.2 ClawEndpoint 预配置与会话挂载

- `app/domain/`：ClawEndpoint 模型
- `app/repositories/`：预配置端点读取
- `app/services/`：挂载校验与状态变更
- `tests/unit/`：挂载规则测试

### 6.3 点对点 Message 中转

- `app/domain/`：Message 模型
- `app/services/`：消息中转规则
- `app/api/`：最小消息发送入口
- `tests/unit/`：中转规则测试
- `tests/integration/`：跨端点 happy path 与失败路径

### 6.4 ReplayRecord 读取

- `app/services/`：回放查询逻辑
- `app/api/`：回放读取入口
- `tests/unit/`：顺序与归属测试
- `tests/integration/`：端到端回放验证

## 7. TDD 执行约束

后续实现必须遵守：

1. 先写 failing test
2. 运行并确认按预期失败
3. 只写最小代码使其通过
4. 再运行测试确认通过
5. 再进入下一步

禁止：

- 先写生产代码再补测试
- 一次实现多个未被测试驱动的能力
- 借“搭骨架”为名提前铺设数据库、鉴权、队列、广播等未来能力

## 8. subagent 拆分顺序

后续实现按以下顺序派发：

1. Python/FastAPI 工程骨架与测试基线
2. fixture 基线（mock 优先可行，真实 OpenClaw fixture 随后接入）
3. Session 模型与创建/关闭
4. ClawEndpoint 预配置与会话挂载
5. 点对点 relay
6. replay 读取
7. integration tests 串联 happy path 与失败路径

## 9. 主 agent 职责

在该实现基线下：

- 主 agent 负责拆任务、派发 subagents、核对结果、处理顺序依赖
- 主 agent 不应亲自承担主要实现，除非任务极小且委派成本明显更高
- 若 subagent 产出与已冻结文档冲突，以文档为准，先修正文档或调整实现

## 10. 完成标准

当以下条件满足时，可认为“实现基线冻结完成”：

- Python + FastAPI 被明确为当前最小实现路线
- 最小目录决策已允许后续创建代码与测试文件
- fixture 被明确限制在测试拓扑，不进入产品组件边界
- 后续 subagents 可以在不补充额外架构猜测的前提下开始编码
