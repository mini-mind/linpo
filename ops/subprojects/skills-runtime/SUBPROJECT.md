# 子项目: skills-runtime

## Scope
技能执行与 sandbox: 技能创建/执行网关与 sandbox 模板生成。

## Owned Paths
- `skill-gateway/**`
- `sandbox-template/**`

## Provides
- skill-gateway: `/skills/*`
- sandbox-template: `/templates/*`

## Consumes
- (通常由 dispatch 调用)

## Local Verification
- `cd skill-gateway && . .venv/bin/activate && python -m pytest -q`
- `cd sandbox-template && . .venv/bin/activate && python -m pytest -q`
