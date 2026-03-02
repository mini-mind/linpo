# web-frontend

## OVERVIEW
Static HTML/CSS/JS Task Tree UI served via nginx or gateway.

## STRUCTURE
```
session-f-edge-ui/web-frontend/
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
| UI markup | session-f-edge-ui/web-frontend/index.html | Main UI page |
| App logic | session-f-edge-ui/web-frontend/app.js | Client state + WS handling |
| Styles | session-f-edge-ui/web-frontend/style.css | UI styling |
| Static serving | session-f-edge-ui/web-frontend/nginx.conf | Routes + caching |

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
- 2026-02-27: Added skills search + NL install entry and mobile quick actions layout; manual UI check only.
- 2026-02-27: Task tree UI updated with industrial night theme and three views (tree/log/kanban); manual UI check only.
- 2026-02-28: Task tree views moved to Alpine.js state (CDN) for tabs/tree/log/kanban; keep no-build deployment.
- 2026-02-28: Kanban labels + status strings i18n; active tab styling clarified.
- 2026-02-28: README clarifies task details show TODO/plan list (plan_subtasks).
