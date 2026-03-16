# 灵盘（Linpo）

灵盘（Linpo）是一个从小功能闭环起步、逐步成长的平台型项目。

当前产品方向已切换为：

> **面向人类的 agent 运行观测入口：用户登录后可以查看自己的 agents，并进入单个 agent 的拓扑视图，观察其与 subagents 的结构关系、活跃状态与历史事件。**

当前仓库已完成一次项目级重置：旧版 roboard 的实现、设计与配置已迁出当前仓库根目录，仅作为仓库外本地归档参考，不再作为当前项目的权威来源。

开发阶段域名暂定为：`linpo.duckdns.org`

## 文档入口

| 文档 | 路径 | 说明 |
|------|------|------|
| v0.1 产品需求 | `docs/prd/2026-03-15-linpo-v0.1-observer-prd.md` | 当前有效的 Linpo v0.1 产品范围与边界 |
| v0.1 架构边界 | `docs/architecture/2026-03-15-observer-architecture.md` | 当前有效的 observer 架构边界与最小模型 |
| v0.1 实施计划 | `docs/plans/2026-03-15-linpo-v0.1-observer-implementation-plan.md` | 当前有效的第一阶段实施拆解 |
| v0.1 设计共识 | `docs/plans/2026-03-15-linpo-v0.1-observer-design.md` | 设计收敛过程记录与共识来源 |
| v0.1 细化设计 | `docs/plans/2026-03-16-linpo-v0.1-observer-detailed-design.md` | 最小 observer 闭环的细化实现设计 |
| demo 收敛与数据边界 | `docs/plans/2026-03-16-observer-demo-hardening-and-data-boundary-plan.md` | 稳定 demo、真实数据只读边界与手动联调准备计划 |
| 公网联调与 OpenClaw 只读接入 | `docs/plans/2026-03-16-public-access-and-openclaw-readonly-plan.md` | 公网访问配置与 OpenClaw 只读接入边界 |
| demo runbook | `docs/plans/2026-03-16-observer-demo-runbook.md` | 当前 observer 主路径的本地演示与联调检查说明 |
| 仓库治理 | `AGENTS.md` | 当前项目治理规则 |

## 当前技术原理（极简）
- 前端不直接连接 OpenClaw，只请求 Linpo 后端的 3 个 observer 只读接口：`/agents`、`/agents/{agent_id}`、`/agents/{agent_id}/nodes/{node_id}`。
- 后端在选择 `openclaw` 数据源时，会作为只读 WebSocket client 连接 OpenClaw gateway，按 `connect.challenge -> connect -> hello-ok` 完成最小握手。
- 当前监控数据主要来自 `hello-ok` 内的 `snapshot.health` 与 `snapshot.presence`，然后被映射成 Linpo 的最小 read model：`Agent`、`TopologyNode`、`EventRecord`。
- OpenClaw 失败时不会静默回退到 stub；会直接返回明确错误，避免把假数据伪装成真实运行状态。

## 当前原则
- 先做最小观测入口，再扩张平台能力
- 先定文档，再做实现
- 不复用旧 roboard 的平台世界观作为当前约束
- 不在方向未冻结前预建大而全的代码骨架
