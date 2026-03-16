# Linpo v0.1 Observer Demo Hardening & Real-Data Boundary Plan

> **状态**：当前有效的下一阶段收敛计划
>
> **前置文档**：
> - `docs/prd/2026-03-15-linpo-v0.1-observer-prd.md`
> - `docs/architecture/2026-03-15-observer-architecture.md`
> - `docs/plans/2026-03-15-linpo-v0.1-observer-implementation-plan.md`
> - `docs/plans/2026-03-16-linpo-v0.1-observer-detailed-design.md`

## 1. 文档目的

本计划用于承接当前已经落地的 v0.1 observer 最小闭环，并把后续工作收敛到三个目标：

1. 把现有实现打磨成**更稳的可演示版本**
2. 定义**真实数据接入边界**，为后续联调留出只读接入口
3. 为后续**手动联调验证**准备清晰的运行与检查基线

本计划不是 v0.2 规划，也不是控制面扩张计划。所有新增工作都必须继续服从 observer-only 边界。

---

## 2. 当前已完成基线

当前仓库已经具备以下最小 observer 主路径：

- `GET /agents`
- `GET /agents/{agent_id}`
- `GET /agents/{agent_id}/nodes/{node_id}`
- agents 列表页
- agent 详情页
- 拓扑树视图
- 节点详情侧栏
- 最小事件历史展示

因此，下一阶段的重点不再是“从零实现 observer”，而是让这条主路径在演示、验证和未来接入真实数据时更稳、更清晰。

---

## 3. 本阶段目标

### 3.1 更稳的可演示版本

本阶段所说的“更稳”，仅指以下范围：

- 关键页面在常见演示场景下稳定渲染
- 关键交互在数据切换与请求延迟时表现稳定
- 当前字段语义清晰，不误导观察者
- 有最小 smoke test 覆盖主路径
- 有清晰的手动演示/联调说明

### 3.2 真实数据接入边界

本阶段所说的“真实数据接入”，仅指：

> 为 observer 提供一个**只读映射边界**，使外部运行时数据能够转换为 Linpo 当前最小对象模型。

这不等于：

- 冻结大而全接入协议
- 接管 agent 运行时
- 增加控制按钮
- 增加持久化、鉴权、websocket、编排或任务系统

### 3.3 手动联调准备

本阶段所说的“联调准备”，仅指：

- 明确 backend/frontend 启动方式
- 明确环境变量和样例访问路径
- 明确主路径人工检查表
- 明确 stub 与未来真实数据接入的切换边界

这不等于现在就完成正式对接。

---

## 4. 需要收敛的实现问题

### 4.1 契约语义问题

当前实现中，以下语义需要先收敛：

- `AgentDetailResponse.child_count` 容易被误读为总节点数，但当前实际更接近 root 的直接子节点数
- 前端通过 `parent_id === null` 猜测 root 节点，缺少显式 `root_node_id`
- 时间字段当前为普通字符串，需要冻结为 RFC3339 UTC 语义

这些问题如果不先处理，会直接影响演示可信度和后续真实数据映射。

### 4.2 前端稳定性问题

需要优先保证：

- 节点切换时详情侧栏不会短暂显示上一个节点的数据
- 页面在较窄视口下仍能完成“列表 → 详情 → 节点详情”演示主路径
- 错误与空态文案足够清楚，便于人工联调排查

### 4.3 验证缺口

需要补齐：

- 最小前端 smoke test
- 契约 invariant 测试
- 一份手动演示/联调 runbook

---

## 5. 真实数据接入边界

### 5.1 推荐边界形态

后端后续应从“直接读取 `stub_data.py`”演进为“读取一个只读观察数据源接口”。

建议边界层次如下：

1. **API 层**：继续暴露当前 3 个 observer 只读接口
2. **Read Model / Service 层**：负责组装 observer 所需最小对象
3. **Observer Data Source 接口层**：抽象真实数据来源或 stub 数据来源
4. **具体实现**：
   - `StubObserverDataSource`
   - 未来的 `RuntimeObserverDataSource`

### 5.2 数据源接口职责

该接口只需要回答当前 v0.1 所需的 3 类查询：

- 列出可见 agents
- 获取单个 agent 的拓扑详情
- 获取某个节点的详情与事件历史

它不承担：

- 启动/停止 agent
- 写入状态
- 写入事件
- 调度 subagents
- 协议协商

### 5.3 推荐映射原则

未来真实数据接入时，必须把外部系统的数据映射到 Linpo 当前冻结的最小 read model：

- `AgentListItem`
- `AgentDetailResponse`
- `TopologyNodeItem`
- `NodeDetailResponse`
- `EventRecordItem`

真实系统若字段更多，只能做后置映射或裁剪，不能反向迫使 v0.1 UI 膨胀。

### 5.4 暂时保持 stub 的部分

在进入正式真实数据接入之前，以下部分继续保持 stub：

- agent 样例集合
- topology 样例树
- 节点事件历史样例
- 演示期间的本地默认数据源

这样可以保证在外部系统尚未准备好时，Linpo 仍能独立演示 observer 主路径。

---

## 6. 本阶段建议交付物

### 6.1 文档

- 一份当前计划文档（本文）
- 一份手动演示/联调 runbook
- 在 README 中补充到这些文档的入口

### 6.2 代码

- 契约语义收敛：显式 root 节点标识、child count 语义澄清、时间语义冻结
- 详情侧栏节点切换稳定性修复
- 最小响应式/演示布局优化
- 数据源边界占位结构
- 最小 smoke test

### 6.3 验证

- 后端契约测试继续通过
- 新增契约 invariant 测试通过
- 前端最小 smoke test 通过
- `npm run build` 通过
- 有人工 runbook 可执行

---

## 7. 当前明确不做

本阶段即使参考 Clawith，也明确不做以下事项：

- agent 创建/编辑/控制
- Pulse / Trigger / Focus 作为 Linpo 自有产品主对象
- workspace 编辑
- tool / skill / MCP 管理
- 审批流
- Plaza / 社交 feed
- websocket 实时流接入
- 鉴权体系
- 数据库存储
- 外部协议冻结

Clawith 只作为架构与交互借鉴源，不作为 Linpo 当前产品边界。

---

## 8. 建议执行顺序

1. 先落本文档与 README 入口
2. 再补手动演示/联调 runbook
3. 先用测试锁定契约收敛项与关键前端稳定性问题
4. 再做最小代码修改
5. 最后运行 build / test / diagnostics，形成联调前基线
