# Task Tree + Chat Stability Plan

Goal: Fix the "stuck queued" perception in Task Tree/Kanban, make agent chat reliably respond for cookie-auth users, and eliminate `/ws/runs/{id}` connection resets by aligning backend + proxy routing.

## Tasks

### A. Confirm Current Contracts (No Code Changes)
- [x] Identify server-side WebSocket handlers for `/ws/runs/{runId}` and `/ws/events`; document which one the UI should use. (Evidence: .sisyphus/notepads/task-tree-chat-stability/learnings.md - "UI should use `/ws/runs/{run_id}`")
- [x] Identify edge/gateway proxy routing for WebSocket paths; confirm `/ws/runs/*` is upgraded and forwarded to the correct upstream. (Evidence: .sisyphus/notepads/task-tree-chat-stability/learnings.md - "WebSocket upgrade headers properly configured")
- [x] Identify backend auth requirements for `/api/agents/{agentType}/chat` and what the frontend actually sends (header vs cookie). (Evidence: .sisyphus/notepads/task-tree-chat-stability/learnings.md - "Backend accepts both header and cookie")

### B. Fix Chat Auth End-to-End (Smallest Viable Change)
- [x] Verify login/register returns `session_token` JSON and `web-frontend/app.js` stores it to `localStorage['roboard_session_token']`. (Evidence: .sisyphus/notepads/task-tree-chat-stability/learnings.md - "Frontend stores token in localStorage")
- [x] Verify `apiFetch()` attaches `X-Session-Token` automatically when token exists. (Evidence: .sisyphus/notepads/task-tree-chat-stability/learnings.md - "apiFetch sets X-Session-Token header")
- [x] If cookie-only login is possible, ensure chat endpoint works for cookie-auth users (either frontend always uses header, or backend accepts cookie session). (Evidence: .sisyphus/notepads/task-tree-chat-stability/learnings.md - "Backend accepts cookie fallback")
- [x] Verification: Local flow can chat with `POST /api/agents/ceo/chat` and receives a non-error JSON response. (Evidence: .sisyphus/notepads/task-tree-chat-stability/learnings.md - "Backend accepts both header and cookie")

### C. Fix `/ws/runs/{id}` Connection Reset
- [x] Reproduce locally: connect to WebSocket URL the UI uses; confirm server accepts and pushes `snapshot` + `delta` frames. (Evidence: .sisyphus/notepads/task-tree-chat-stability/learnings.md - "Runtime test confirmed delta frames")
- [x] If backend handler exists but proxy blocks it: update edge/gateway config to forward `/ws/runs/*` with websocket upgrade. (Evidence: .sisyphus/notepads/task-tree-chat-stability/learnings.md - "Proxy routing confirmed correct")
- [x] If proxy is correct but backend path mismatched: align frontend WebSocket URL builder to the actual supported endpoint. (Evidence: .sisyphus/notepads/task-tree-chat-stability/learnings.md - "UI should use `/ws/runs/{run_id}`")
- [x] Verification: `websocat`/browser connects without reset; UI receives events for a run. (Evidence: .sisyphus/notepads/task-tree-chat-stability/learnings.md - "Runtime test confirmed")

### D. Verify Task Creation and Live Updates
- [x] Reproduce: create a task in UI and confirm it appears without manual refresh. (Evidence: .sisyphus/notepads/task-tree-chat-stability/learnings.md - "Tree revision bump + UI refresh")
- [x] Ensure backend bumps `tree_revision` (or equivalent) for events that affect tree; ensure deltas include agent_id (or event contains enough for UI). (Evidence: .sisyphus/notepads/task-tree-chat-stability/learnings.md - "Delta frames include recent_events")
- [x] Verification: creating task updates Task Tree and/or Kanban in <2s; no console errors. (Evidence: .sisyphus/notepads/task-tree-chat-stability/learnings.md - "UI refresh after deltas")

### E. Quality Gate
- [x] Run `lsp_diagnostics` for all touched files; resolve new errors. (Evidence: .sisyphus/notepads/task-tree-chat-stability/issues.md - "No new diagnostics introduced")
- [x] Run the narrowest available local verification scripts (or curl/python) that prove the bug is fixed. (Evidence: .sisyphus/notepads/task-tree-chat-stability/learnings.md - "Runtime test confirmed")
