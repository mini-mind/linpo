# P1 Agent 招募机制（MVP）Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将 P1 从“团队导入/导出（YAML）”调整为“Agent 招募机制”，基于现有模板库与实例化能力，实现最小可用的招募闭环（申请 → 审核 → 加入）。

**Architecture:** 保持现有 Agent 模板库与 Agent 实例化 API 不变，在 `api` 增加轻量招募资源（recruitment requests）与两个招募入口（模板招募/自定义招募），审核通过后调用既有实例化流程将 Agent 加入当前 run。Skill 自举与社区技能保留为“暂缓”状态，不在本轮实现。

**Tech Stack:** FastAPI, SQLAlchemy, pytest, vanilla JS/HTML/CSS

---

## 1. 背景与范围

### 1.1 方向调整
- 旧方向（废弃）：团队架构导出/导入（YAML）
- 新方向（本计划）：Agent 招募机制

### 1.2 本期 MVP 范围（做）
- 从模板招募 Agent
- 自定义招募 Agent（用户提供角色与技能清单）
- 招募申请流转：`pending -> approved/rejected`
- 审核通过后加入当前 run（复用现有实例化能力）
- 基础查询能力：列表与详情

### 1.3 非目标（不做）
- 团队 YAML 导出/导入
- 复杂审批流（多级审批、并行会签）
- 跨 run 批量招募
- Skill 自举与社区技能新功能扩展（仅保留计划，标记暂缓）

---

## 2. Agent 角色与职责

### 2.1 招募申请人（Requester）
- 发起模板招募或自定义招募
- 填写最小字段：目标 run、角色、能力描述（或模板 id）
- 查看申请状态与审核意见

### 2.2 审核人（Reviewer）
- 审核申请是否符合 run 当前目标
- 决策：批准或拒绝
- 填写审核备注（拒绝原因/补充说明）

### 2.3 系统执行者（System Executor）
- 对通过申请执行 Agent 实例化
- 写入 run-agent 关联
- 记录审计事件（谁在何时批准并加入）

---

## 3. API 设计（MVP）

> 说明：以下为对外 API 设计草案；鉴权、返回包装遵循现有接口契约。

### 3.1 创建招募申请（模板）
`POST /api/runs/{run_id}/recruitments`

请求体：
```json
{
  "mode": "template",
  "template_id": "agent_template_researcher_v1",
  "nickname": "市场研究员",
  "reason": "需要补充竞品调研能力"
}
```

响应体（201）：
```json
{
  "id": "rec_123",
  "run_id": 101,
  "mode": "template",
  "status": "pending"
}
```

### 3.2 创建招募申请（自定义）
`POST /api/runs/{run_id}/recruitments`

请求体：
```json
{
  "mode": "custom",
  "role": "analyst",
  "display_name": "数据分析师",
  "skills": ["sql_analysis", "report_summary"],
  "sop": "负责分析 run 过程中产出数据并提供结论",
  "reason": "需要补齐数据洞察链路"
}
```

响应体（201）：与模板模式一致，`mode=custom`。

### 3.3 查询招募申请
- `GET /api/runs/{run_id}/recruitments`（列表）
- `GET /api/runs/{run_id}/recruitments/{recruitment_id}`（详情）

状态字段：
- `pending`：待审核
- `approved`：已通过
- `rejected`：已拒绝

### 3.4 审核招募申请
`POST /api/runs/{run_id}/recruitments/{recruitment_id}/review`

请求体：
```json
{
  "decision": "approved",
  "comment": "角色明确，符合当前任务目标"
}
```

成功响应（200）：
```json
{
  "id": "rec_123",
  "status": "approved",
  "hired_agent_id": 998
}
```

拒绝时：`status=rejected`，`hired_agent_id=null`。

---

## 4. 招募流程（申请 → 审核 → 加入）

### Step 1: 申请
- 用户在 run 下发起模板/自定义招募
- 系统创建 recruitment 记录，初始状态 `pending`

### Step 2: 审核
- 审核人执行 `review` 接口
- 若拒绝：状态改为 `rejected`，流程结束
- 若通过：状态改为 `approved`，进入实例化阶段

### Step 3: 加入
- 系统调用现有 Agent 实例化能力创建 Agent
- 将 Agent 挂载到当前 run 的 agent 树
- 返回 `hired_agent_id`，并记录审计事件

失败处理（MVP）：
- 审核通过但实例化失败时，接口返回错误并保留 `approved` 状态，同时记录 `join_failed` 错误信息用于人工重试

---

## 5. 与模板库集成

### 5.1 复用项
- 复用现有模板检索能力（模板 id、角色元数据、默认技能）
- 复用现有 Agent 实例化 API（避免重复造轮子）

### 5.2 新增适配层
- 在招募模块增加模板到实例化参数的映射
- 统一模板招募与自定义招募输出结构，保证审核与加入流程一致

### 5.3 兼容性要求
- 不修改模板库已有数据结构
- 不改变模板库现有查询接口行为
- 不影响已上线实例化流程

---

## 6. 数据模型（建议）

新增 `recruitment_requests`（或同义命名）表：
- `id`
- `run_id`
- `mode` (`template`/`custom`)
- `payload_json`（模板参数或自定义参数）
- `status` (`pending`/`approved`/`rejected`)
- `review_comment`
- `reviewed_by`
- `hired_agent_id`（可空）
- `error_message`（可空）
- `created_at` / `updated_at`

---

## 7. 里程碑与验收

### M1: API 骨架可用
- 可创建模板/自定义招募申请
- 可列表/详情查询

### M2: 审核流转可用
- 可执行批准/拒绝
- 状态流转正确且不可逆回退（MVP）

### M3: 加入 run 可用
- 审核通过后成功加入 Agent
- 返回 `hired_agent_id`
- 失败可追踪（有错误记录）

验收标准（MVP）：
- 端到端跑通一条模板招募与一条自定义招募
- 不引入团队导入/导出功能
- 不破坏模板库与既有实例化能力

---

## 8. 暂缓项（明确保留）

以下 P1 方向保留为“暂缓”，不删除：
- Skill 自举（初版）
- 社区技能安装（初版）

> 说明：暂缓仅代表本轮优先级下调，不代表取消。
