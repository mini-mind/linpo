# Sisyphus 工作流

[← 返回文档中心](../README.md)

本文档描述 `.sisyphus/` 决策/过程系统的使用方法。

## 目的

`.sisyphus/` 用于管理开发计划、草稿和决策记录，确保过程可追溯且本地笔记不污染版本历史。

## 目录结构

```
.sisyphus/
├── boulder.json          # 追踪当前激活的计划/会话 ID（Git 追踪）
├── plans/                # 已批准的计划（Git 追踪，只读）
│   ├── web3d-agent-mvp.md
│   └── office-3d-product.md
├── drafts/               # 计划草稿（Git 追踪）
│   └── web3d-agent-mvp.md
└── notepads/             # 笔记（Git 忽略，本地仅存）
    ├── web3d-agent-mvp/
    │   ├── learnings.md   # 模式/成功经验
    │   ├── decisions.md   # 架构选择与理由
    │   ├── issues.md      # 问题/阻塞点
    │   └── problems.md    # 未解决的技术债务
    └── agent-framework/
        └── ...
```

## Git 追踪规则

| 路径 | 状态 | 说明 |
|------|------|------|
| `.sisyphus/boulder.json` | ✅ 追踪 | 记录当前激活计划 |
| `.sisyphus/plans/*.md` | ✅ 追踪 | 只读，执行时不可修改 |
| `.sisyphus/drafts/*.md` | ✅ 追踪 | 草稿版本 |
| `.sisyphus/notepads/` | ❌ 忽略 | 本地笔记，不提交 |

**重要警告**: `.sisyphus/notepads/` 已在 `.gitignore` 中，内容仅存在于本地，不会出现在 Git 历史中。

## 使用规则

### Plans（只读）

- 计划批准后移至 `.sisyphus/plans/`
- **执行期间只读**：由 Orchestrator 管理状态，执行者不可修改
- 使用 `boulder.json` 指向当前激活计划

### Notepads（仅追加）

- 每个计划对应 `.sisyphus/notepads/{plan-name}/` 子目录
- 四个标准文件（仅追加，不覆盖）：
  - `learnings.md` - 记录发现的模式、成功方法
  - `decisions.md` - 记录架构选择 + 理由 + 验证证据
  - `issues.md` - 记录遇到的问题、阻塞点
  - `problems.md` - 记录未解决的技术债务

### 决策记录模板

```markdown
## 决策: <标题>

**日期**: YYYY-MM-DD
**上下文**: <为什么做这个决定>

**选择**:
- <选项 1>
- <选项 2>（选择）

**理由**: <为什么选这个选项>

**验证证据**:
- <测试结果/日志/指标>
- [链接到相关代码/文档]
```

### 渐进式描述

决策记录应包含：
1. **上下文** - 为什么需要做决策
2. **选项** - 考虑过的替代方案
3. **理由** - 选择当前方案的原因
4. **验证证据** - 证明方案可行的证据（日志、测试结果、代码链接）

## 快速链接

- [当前主计划: web3d-agent-mvp](../../.sisyphus/plans/web3d-agent-mvp.md)
- [草稿版本: web3d-agent-mvp](../../.sisyphus/drafts/web3d-agent-mvp.md)
- [所有计划目录](../../.sisyphus/plans/)
