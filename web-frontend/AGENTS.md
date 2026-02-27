# web-frontend

## OVERVIEW
Static HTML/CSS/JS Task Tree UI served via nginx or gateway.

## STRUCTURE
```
web-frontend/
├── index.html
├── login.html
├── app.js
├── style.css
├── nginx.conf
└── Dockerfile
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| UI markup | web-frontend/index.html | Main UI page |
| App logic | web-frontend/app.js | Client state + WS handling |
| Styles | web-frontend/style.css | UI styling |
| Static serving | web-frontend/nginx.conf | Routes + caching |

## CONVENTIONS
- No build step; assets are served as-is.
- WebSocket connects via gateway `/ws/*` (same origin).

## ANTI-PATTERNS
- Do not add bundler assumptions or npm build steps.
- Do not hardcode internal service URLs; use gateway paths.

## COMMANDS
```bash
docker compose up -d web-frontend gateway edge
```

## NOTES
- Root `package.json` is tooling-only (Playwright), not a web build pipeline.
- 2026-02-27: Chat input submits interventions via `/api/runs/{run_id}/interventions`.
- 2026-02-27: Added Sources panel and control buttons (pause/resume/retry) in task details; manual UI check only.
- 2026-02-27: Added Skills panel + team template export/import UI in task details; manual UI check only.
