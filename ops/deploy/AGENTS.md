# deploy

## OVERVIEW
Docker Compose variants for prod and worker deployment shapes.

## STRUCTURE
```
ops/deploy/
├── prod/docker-compose.frontend.yml
├── worker/docker-compose.yml

```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Frontend host | ops/deploy/prod/docker-compose.frontend.yml | edge/gateway/web/searxng |
| Worker host | ops/deploy/worker/docker-compose.yml | playwright-gateway + docker-socket-proxy |

## CONVENTIONS
- Frontend compose binds gateway to `127.0.0.1:8082->80` for host-local access.
- Worker compose exposes `7200` and uses `docker-socket-proxy`.
- Frontend compose uses `ROBOARD_ROOT` for edge/searxng mounts.

## OWNERSHIP
- Owned paths: `ops/deploy/**`
- 禁止跨目录修改：默认不修改非 `ops/deploy/**` 的文件；如需改变服务契约先更新 `docs/specs/`。
- 放弃向后兼容：compose 内的服务名/挂载路径以当前语义目录为准。
- 验证要求：修改 compose 后至少运行一次 `docker compose -f ops/deploy/prod/docker-compose.frontend.yml config -q` 与 `docker compose -f ops/deploy/worker/docker-compose.yml config -q`。

## ANTI-PATTERNS
- Do not reference Docker Hub images on the worker host.
- Do not expose internal service ports publicly.

## COMMANDS
```bash
docker compose -f ops/deploy/prod/docker-compose.frontend.yml up -d
docker compose -f ops/deploy/worker/docker-compose.yml up -d
```

## NOTES
- Keep prod and worker compose files aligned with the latest PRD scope.
