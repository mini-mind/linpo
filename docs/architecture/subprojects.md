# 子项目化视图 (降低认知成本)

[← 返回文档中心](../README.md)

本页以“子项目”的视角重新组织 RoBoard, 让每个 agent 只需要理解自己负责的那一块。

重要说明:
- 仓库仍是 monorepo, 不改变现有服务目录位置。
- 每个子项目都有明确 owned paths, 默认不跨目录修改。
- 跨子项目协作优先通过接口契约同步, 见 `docs/process/multi-session-ownership.md`。

## 子项目入口

- `ops/subprojects/api/SUBPROJECT.md`
- `ops/subprojects/dispatch/SUBPROJECT.md`
- `ops/subprojects/browser-exec/SUBPROJECT.md`
- `ops/subprojects/skills-runtime/SUBPROJECT.md`
- `ops/subprojects/llm-and-search/SUBPROJECT.md`
- `ops/subprojects/edge-and-ui/SUBPROJECT.md`
- `ops/subprojects/shared-assets/SUBPROJECT.md`

## 子项目清单 (机器可读)

- `ops/subprojects/manifest.json`

## polyrepo 预备工具

- `ops/scripts/polyrepo_export.py`: 导出子项目为独立目录树 (无 git 历史)
- `ops/scripts/polyrepo_split_subtree.py`: 使用 `git subtree split` 生成带历史的独立 repo
- `ops/scripts/polyrepo_bootstrap_root.py`: 生成本地编排仓 `dist/roboard-root` 并把 split repos 作为 submodules 挂载回原路径

## 什么时候需要真正拆成多仓 (可选)

当你满足以下条件时, 才建议做“物理拆仓 (polyrepo)”:
- 部署/构建系统已完成去耦 (compose/scripts 不再硬编码顶层目录名)
- 接口契约稳定, 且已具备兼容策略与版本窗口
- 团队已能接受跨仓 CI 与版本发布的复杂度

在当前阶段, 推荐先用 subprojects 视图降低认知成本, 再逐步去耦构建/部署脚本。
