# 测试/联调资源

## 单实例前置

开源版按单实例联调，启动前必须配置：

- `OPENCLAW_BASE_URL`
- `OPENCLAW_GATEWAY_TOKEN`
- `LINPO_TASK_EVENT_CALLBACK_BASE_URL`

## 本地启动命令

- 后端：`source .venv/bin/activate && fastapi dev --port 8000`
- 前端：`npm --prefix frontend run dev`

## 本地联调提示（8000 路径）

- 后端默认会自动读取仓库根目录 `.env`。
- 前端开发默认直连 `http://localhost:8000`（`npm run dev` 已固定注入）。
- 前端开发端口固定为 `5173`；端口占用会直接报错（不自动漂移）。
- `LINPO_TASK_EVENT_CALLBACK_BASE_URL` 为必填；本机联调可用 `http://localhost:8000`。

## 一键本地验收（最小串联）

先分别启动后端和前端，再在新终端执行：

```bash
set -euo pipefail
curl -fsS http://localhost:8000/api/v1/health >/dev/null
INSTANCE_ID="$(curl -fsS http://localhost:8000/api/v1/instances | jq -r '.[0].id')"
jq -n --arg instanceId "$INSTANCE_ID" \
  '{requirement:"smoke: 拆分并推进最小流程",instanceId:$instanceId,executorAgentId:"main"}' \
  > /tmp/linpo-flow-generate.json
curl -fsS -X POST http://localhost:8000/api/v1/boards/default/tasks/flow/generate \
  -H 'content-type: application/json' \
  --data @/tmp/linpo-flow-generate.json \
  > /tmp/linpo-flow-generate-resp.json
jq -n \
  --arg instanceId "$INSTANCE_ID" \
  --arg plannerSessionKey "$(jq -r '.plannerSessionKey' /tmp/linpo-flow-generate-resp.json)" \
  --arg executionSessionPrefix "$(jq -r '.executionSessionPrefix' /tmp/linpo-flow-generate-resp.json)" \
  --argjson nodes "$(jq '.nodes' /tmp/linpo-flow-generate-resp.json)" \
  --argjson edges "$(jq '.edges' /tmp/linpo-flow-generate-resp.json)" \
  '{instanceId:$instanceId,executorAgentId:"main",managerAgentId:"main",plannerSessionKey:$plannerSessionKey,executionSessionPrefix:$executionSessionPrefix,requirementTitle:"smoke-confirm",nodes:$nodes,edges:$edges}' \
  > /tmp/linpo-flow-confirm.json
curl -fsS -X POST http://localhost:8000/api/v1/boards/default/tasks/flow/confirm \
  -H 'content-type: application/json' \
  --data @/tmp/linpo-flow-confirm.json >/tmp/linpo-flow-confirm-resp.json
PLAYWRIGHT_DEPLOYED_BASE_URL=http://127.0.0.1:5173 npm --prefix frontend run e2e:deployed
```

失败优先排查：

- `health` 不通：后端未监听 `8000`。
- `generate/confirm` 异常：检查 `.env` 的 `OPENCLAW_*`。
- `ops/setup` 的 `flow_decomposition_configured` 若提示默认 `main` 不可用：按 `nextStep` 使用运行时可用 agent，并以 message 中“当前运行时可用 agents”作为可选值来源。
- `e2e:deployed` 异常：检查前端是否监听 `5173`，以及 `PLAYWRIGHT_DEPLOYED_BASE_URL` 是否正确。

## 质量命令

- 后端：`/data/projects/linpo/.venv/bin/pytest`
- 前端测试：`npm --prefix frontend run test`
- 前端构建：`npm --prefix frontend run build`

## 验收主链路

1. 打开页面（默认免注册/免登录）
2. 进入流程页生成流程
3. confirm 后任务进入看板推进
4. 审批/中断/继续动作可用
5. 结果可在任务产出与文件页预览/下载

## 说明

- 本文不再维护多实例、配对会话、挂载回执相关联调内容。
- 详细契约以 `docs/prd.md` 与 `docs/architecture.md` 为准。
