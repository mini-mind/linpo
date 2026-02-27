# deploy

## OVERVIEW
Docker Compose variants for prod, worker, and legacy deployment shapes.

## STRUCTURE
```
deploy/
├── prod/docker-compose.frontend.yml
├── worker/docker-compose.yml
└── (no legacy compose)
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Frontend host | deploy/prod/docker-compose.frontend.yml | edge/gateway/web/searxng |
| Worker host | deploy/worker/docker-compose.yml | playwright-gateway + docker-socket-proxy |

## CONVENTIONS
- Frontend compose binds gateway to `127.0.0.1:8082->80` for host-local access.
- Worker compose exposes `7200` and uses `docker-socket-proxy`.
- Frontend compose uses `ROBOARD_ROOT` for edge/searxng mounts.

## ANTI-PATTERNS
- Do not reference Docker Hub images on the worker host.
- Do not expose internal service ports publicly.

## COMMANDS
```bash
docker compose -f deploy/prod/docker-compose.frontend.yml up -d
docker compose -f deploy/worker/docker-compose.yml up -d
```

## NOTES
- Keep prod and worker compose files aligned with the latest PRD scope.
