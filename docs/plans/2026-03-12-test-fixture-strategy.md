# 测试夹具策略：OpenClaw Fixture for Session-Scoped Ingress

## 1. 目标

本文档定义灵盘当前 MVP 阶段的测试夹具（test fixture）口径，用于支撑会话型 Claw 接入与点对点消息中转的验证。

## 2. 测试夹具的角色

当前测试环境中的 3 个 OpenClaw 实例：

- 用于模拟未来用户自己的外部 Claw
- 用于验证灵盘的最小接入与中转能力
- 不属于灵盘产品运行单元
- 不代表产品架构中的固定角色

## 3. 当前阶段为什么需要 fixture

在产品尚未完成真实外部接入生态前，测试夹具用于：

- 提供稳定的可重复接入端点
- 验证 Session 创建与 Claw 挂载
- 验证点对点消息中转
- 验证回放读取

## 4. fixture 的最小要求

至少应满足：

- 可被平台预配置为 `ClawEndpoint`
- 可在测试环境中被挂入 Session
- 可接收来自 Linpo 的中转消息
- 可返回足以验证中转结果的最小响应

## 5. fixture 与产品边界的关系

必须保持以下约束：

- fixture 存在于测试拓扑，不存在于产品部署拓扑
- fixture 可以影响测试设计，但不能倒推产品边界
- fixture 的数量、命名和部署方式不是当前产品契约的一部分

## 6. 真实 OpenClaw 与 mock fixture 策略

优先级如下：

1. 优先使用真实 OpenClaw fixture 做联调验证
2. 若真实 OpenClaw 在当前阶段不稳定，可临时使用 mock fixture 支撑平台契约开发
3. mock fixture 只用于缩短反馈回路，不替代真实 OpenClaw 验证

## 7. 后续要求

后续实现阶段，fixture 相关工作应由独立 subagent 负责，不与产品主实现边界混写。
