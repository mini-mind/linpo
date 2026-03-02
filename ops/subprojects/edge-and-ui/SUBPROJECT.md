# 子项目: edge-and-ui

## Scope
入口代理与前端:
- edge: 公网入口与 TLS
- gateway: 内部反向代理与路由
- web-frontend: 静态 UI

## Owned Paths
- `edge/**`
- `gateway/**`
- `web-frontend/**`

## Provides
- 对外入口: `https://.../` (edge)
- 路由: `/api/*`, `/ws/*`, `/` (gateway)
- 静态 UI: `/` (web-frontend)

## Constraints
- 禁止通过 gateway 暴露 `/internal/*`

## Local Verification
- 手工验证为主 (静态前端无 build): `docker compose up -d edge gateway web-frontend`
