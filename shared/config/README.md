# config/

本目录存放静态配置 (YAML/JSON) 与示例模板。

约定:
- 任何 secrets 必须放在 `.env` 或宿主机外部文件, 不得提交到 Git。
- 配置变更如会影响跨服务契约 (headers/schema/endpoints), 先更新 `session-a-docs/specs/` 契约文档。
