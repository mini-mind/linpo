# browser

## OVERVIEW
浏览器执行链路，负责接收任务、编排 Playwright runner 并返回执行结果。

## STRUCTURE
```
browser/
├── worker-playwright/
└── playwright-gateway/
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Worker API | `browser/worker-playwright/app/main.py` | `/run` 与任务入口校验 |
| Runner 编排 | `browser/playwright-gateway/app/main.py` | Docker runner 创建与回收 |
| Worker 测试 | `browser/worker-playwright/tests/` | worker 回归用例 |
| Gateway 测试 | `browser/playwright-gateway/tests/` | gateway 回归用例 |
| 部署口径 | `docs/worker-deployment.md` | worker 主机部署说明 |

## OWNERSHIP
- Lead: @platform

## ANTI-PATTERNS
- ❌ 未鉴权直接开放 `/run`。
- ❌ 运行时临时拉取未受控 runner 镜像。
- ❌ 吞掉 Docker 异常导致不可观测失败。

## LINKS
- [CONSTITUTION](../docs/CONSTITUTION.md)
