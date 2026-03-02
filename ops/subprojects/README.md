# subprojects/

本目录用于把 RoBoard 以“子项目”的方式表达出来, 降低对整仓结构的认知成本。

重要说明:
- 这是 monorepo 内的逻辑拆分, 不改变现有服务目录位置。
- 每个子项目都有明确的“拥有目录 (owned paths)”。默认只改自己拥有的目录。
- 跨子项目协作优先通过接口契约与文档同步 (见 `docs/process/multi-session-ownership.md`)。

## 子项目清单 (推荐)

1) `api/` - 对外 API + WebSocket
- 入口: `subprojects/api/SUBPROJECT.md`

2) `dispatch/` - 调度编排与队列消费
- 入口: `subprojects/dispatch/SUBPROJECT.md`

3) `browser-exec/` - 浏览器执行链
- 覆盖: `worker-playwright/`, `playwright-gateway/`, `playwright-runner/`
- 入口: `subprojects/browser-exec/SUBPROJECT.md`

4) `skills-runtime/` - 技能执行与 sandbox
- 覆盖: `skill-gateway/`, `sandbox-template/`
- 入口: `subprojects/skills-runtime/SUBPROJECT.md`

5) `llm-and-search/` - LLM 代理与搜索
- 覆盖: `llm-gateway/`, `mcp-server/`, `searxng/`
- 入口: `subprojects/llm-and-search/SUBPROJECT.md`

6) `edge-and-ui/` - 入口代理与前端
- 覆盖: `edge/`, `gateway/`, `web-frontend/`
- 入口: `subprojects/edge-and-ui/SUBPROJECT.md`

7) `shared-assets/` - 共享内容与配置 (跨服务)
- 覆盖: `config/`, `prompts/`, `sops/`, `community_skills/`, `redis/`, `observability/`
- 入口: `subprojects/shared-assets/SUBPROJECT.md`

建议: 让每个 agent 只负责一个子项目, 并且只在该子项目的 owned paths 内做改动。

## 物理拆仓 (polyrepo) 预备工具

本仓库提供两类非破坏性工具, 用于逐步推进物理拆仓:

1) 导出为“独立目录树”(不含 git 历史)
- `python3 scripts/polyrepo_export.py --out dist/polyrepo --project api --force`

2) 生成“带历史的独立 git repo”(使用 git subtree split)
- `python3 scripts/polyrepo_split_subtree.py --out dist/polyrepo-repos --project api --allow-dirty`

子项目清单由 `subprojects/manifest.json` 统一维护。
