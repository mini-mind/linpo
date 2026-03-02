# gateway

## OVERVIEW
Nginx reverse proxy for UI, API, and WebSocket routes.
Built on OSS Nginx; routing rules are RoBoard-specific.

## STRUCTURE
```
edge-ui/gateway/
├── nginx.conf
├── Dockerfile
└── README.md
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Routing rules | edge-ui/gateway/nginx.conf | `/`, `/api/`, `/ws/` mappings |
| Template config | edge-ui/gateway/default.conf.template | `API_BACKEND_URL` via envsubst |
| Access notes | edge-ui/gateway/README.md | Port binding + usage |

## CONVENTIONS
- `/api/health` is an exact match to `api:8000/health`.
- `/api/` and `/ws/` proxy to `api:8000` with headers.
- `API_BACKEND_URL` can override upstream for split deployment.
- Gateway config now uses envsubst template `default.conf.template` for upstream override.
- Gateway is container-only by default; prod frontend compose binds `127.0.0.1:8082->80`.
- 每改完一个服务就立即更新相关的 `AGENTS.md` 并完成该服务测试。

## OWNERSHIP
- Owned paths: `edge-ui/gateway/**`
- 禁止跨目录修改：默认不修改非 `edge-ui/gateway/**` 的文件；如需调整对外路由契约先更新 `docs/specs/`。
- 安全边界：禁止代理 `/internal/*`（见 ANTI-PATTERNS）。
- 验证要求：更新路由/模板后，至少运行一次 `python -m pytest -q`（`edge-ui/gateway/tests/test_gateway_template.py`）。

## ANTI-PATTERNS
- Do not route `/internal/*` through gateway.
- Do not increase `client_max_body_size` without review.

## COMMANDS
```bash
docker compose up -d gateway edge
```

## NOTES
- Rate limiting is configured in `nginx.conf` via `limit_req_zone`.
- 2026-02-27: Gateway supports `API_BACKEND_URL` override for split deployment.
- 2026-02-28: Gateway README WebSocket examples aligned to `/ws/runs/{run_id}`.
