# 子项目: shared-assets

## Scope
跨服务共享的配置与内容目录。该子项目的目标是让共享资产“可发现、可约束、可审计”。

## Owned Paths
- `config/**`
- `prompts/**`
- `sops/**`
- `community_skills/**`
- `redis/**`
- `observability/**`

## Notes
- 该子项目天然跨服务耦合, 变更前优先补文档与契约说明。
- secrets 只能放 `.env` 或宿主机外部文件, 不得提交到 Git。
