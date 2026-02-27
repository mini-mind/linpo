# gateway

## OVERVIEW
Nginx reverse proxy for UI, API, and WebSocket routes.
Built on OSS Nginx; routing rules are RoBoard-specific.

## STRUCTURE
```
gateway/
├── nginx.conf
├── Dockerfile
└── README.md
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Routing rules | gateway/nginx.conf | `/`, `/api/`, `/ws/` mappings |
| Access notes | gateway/README.md | Port binding + usage |

## CONVENTIONS
- `/api/health` is an exact match to `api-backend:8000/health`.
- `/api/` and `/ws/` proxy to `api-backend:8000` with headers.
- Gateway is container-only by default; prod frontend compose binds `127.0.0.1:8082->80`.
- 每改完一个服务就立即更新相关的 `AGENTS.md` 并完成该服务测试。

## ANTI-PATTERNS
- Do not route `/internal/*` through gateway.
- Do not increase `client_max_body_size` without review.

## COMMANDS
```bash
docker compose up -d gateway edge
```

## NOTES
- Rate limiting is configured in `nginx.conf` via `limit_req_zone`.
