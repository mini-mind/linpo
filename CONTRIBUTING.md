# Contributing

## 开始前

1. 先阅读 [AGENTS.md](AGENTS.md)（治理唯一真源）。
2. 功能/架构边界变更遵循 Doc-First：先更新文档，再改实现。

## 开发环境

- Python `3.12+`
- Node.js `20.19.0`

## 本地验证

- 后端测试：`/data/projects/linpo/.venv/bin/pytest`
- 前端测试：`cd frontend && npm test -- --run`

提交 PR 前，请至少完成与你改动相关的最小测试集。

## 提交规范

1. 一个 PR 聚焦一个目标，避免混入无关改动。
2. 说明变更动机、影响范围与验证方式。
3. 涉及 API/架构边界变化时，附上对应文档更新。
