# 灵盘（Linpo）

Linpo 是位于 OpenClaw 与人之间的人机协作编排交互层。
Linpo v0.7 主工作区收敛为 `摘要 + 看板 + 流程 + 文件`：
- 一句话描述需求，生成并编辑流程图
- 流程图解析为可并行任务队列，在看板中调度
- 敏感操作统一审批，任务产出可预览并可通过输入框调试
- 审批中心聚合待审批任务、事件流与 token 消耗趋势

ravin 测试服务域名：`linpo.duckdns.org`

## 开发环境基线

- Node.js：`20.19.0`（见 `.nvmrc` / `frontend/.nvmrc`）
- npm：`>=10`
- Python：`3.12+`

## 文档目录

- 治理规则：`AGENTS.md`（项目治理与协作规则唯一真源）
- 产品需求：`docs/prd.md`（功能范围、交互主线、路由与验收目标）
- 架构边界：`docs/architecture.md`（分层、契约与技术边界）
- 测试资源：`docs/test-resources.md`（环境、构建、联调、验收与 OpenClaw 参考）
- OpenClaw 全量接口：`docs/openclaw-api-catalog.md`（含当前接入状态与未接入项清单）

## 文档读取建议（按需，不全读）

- 默认先读：`README.md`
- 功能/交互变更：读 `docs/prd.md`
- 技术实现/边界变更：读 `docs/architecture.md`
- 测试、部署、联调或外部协议细节：读 `docs/test-resources.md`
- 查询未接入接口或当前接入状态：读 `docs/openclaw-api-catalog.md`
