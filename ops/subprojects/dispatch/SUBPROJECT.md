# 子项目: dispatch

## Scope
调度编排服务: 消费 Redis streams, 派发到 worker, 并向 api 上报事件。

## Owned Paths
- `dispatch/**`

## Provides
- 内部接口: `POST /internal/dispatch`

## Consumes
- api: `POST /api/tasks/{task_id}/events`
- worker-playwright: `POST /run`
- skill-gateway: `POST /skills/create`, `POST /skills/execute`
- llm-gateway: `POST /internal/llm/chat`

## Local Verification
- `cd dispatch && . .venv/bin/activate && python -m pytest -q`

## Notes
- 本子项目的主要耦合点是“dispatch stream payload”与“事件上报 schema”。跨项目变更先改契约。
