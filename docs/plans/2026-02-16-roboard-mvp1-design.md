# RoBoard (ZhiBan) MVP(1) Technical Design

> Scope: MVP(1) only. MVP(2)/MVP(3) are brief appendices.

## Goal
Build the MVP(1) core loop:
- User inputs natural language.
- System generates a run-scoped agent team tree.
- Cockpit shows real-time status and logs.
- User can intervene (natural language) to update an agent SOP; change takes effect on the next step.

## Naming (Avoid Future Confusion)
- External API naming: use `runs` consistently.
- Internal storage: reuse and extend the existing `tasks` table as the run record.
  - `task_id == run_id`.

Compatibility during transition:
- Keep existing `/api/tasks` and `/ws/world` working.
- Add new `/api/runs/...` endpoints (or aliases) and gradually migrate UI.

## Confirmed MVP(1) Decisions (Locked)
- Topology: strict parent-child tree (no DAG/depends_on in the structure).
- SOP storage: Markdown files on a host-mounted path.
- SOP inheritance: copy full Markdown file to create a child SOP (no overlay/merge at runtime).
- SOP updates: affect the next step only (no mid-step interruption).
- SOP contents: human-readable duties + steps only.
  - Operational fields (permissions, resources, workspace, membership tier) MUST NOT be embedded in SOP.
- Resources:
  - Per-user (tenant) caps (MVP default): cpu=0.25 core, mem=2 GiB, disk=5 GiB.
  - Machine admission: max_active_users=5.
  - Fuses: stop admitting new active users when swap_used > 4 GiB OR mem_available < 500 MiB.
- Admission UX: allow run creation but queue when blocked (do not hard-reject as default).

## What Lives Where (Hard Boundary)

### SOP Markdown (Host-mounted)
Purpose: define what the agent is and how it should work (human-visible and editable).
- Contents:
  - Role / responsibilities (natural language)
  - Steps / workflow (natural language + light structure)
  - Error handling guidance
- MUST NOT contain:
  - Tool permissions
  - Workspace paths
  - CPU/mem/disk limits
  - Membership tier
  - Network allowlists

### Postgres (Durable metadata + audit)
Purpose: the system-of-record for management, audit, replay.
- Run metadata (reusing `tasks`)
- Agent instances (tree nodes)
- SOP version metadata (md_path, sha256, version)
- Actions/interventions (idempotent, auditable)
- Tool registry + per-agent permissions
- Membership tiers + resource profiles
- Events as the replay spine (extended to include agent/action references)

### Redis (Ephemeral runtime state)
Purpose: low-latency state, locks, counters, heartbeats.
- Admission control counters
- Locks for interventions and dispatch
- Idempotency keys with TTL
- Live status cache (optional; Postgres events remain the audit log)

## Current System Evidence (Existing Building Blocks)

### API Backend: tasks/events/chat/ws
  - File: `api-backend/app/main.py`
  - Existing endpoints:
    - `/api/tasks` (create)
    - `/api/tasks/{task_id}` (read)
    - `/api/tasks/{task_id}/events` (append event)
    - `/api/agents/{agent_type}/chat` and `/api/agents/{agent_type}/chat/stream`
  - Existing websockets:
    - `/ws/events` (task-scoped snapshot + stream)
  - Existing event gate:
    - `ALLOWED_EVENT_TYPES` currently contains only task-level types (task.*)

### Agent Manager: Redis Streams consumers
- File: `agent-manager/app/main.py`
  - Consumes `queue:dispatch` and `queue:a2a` via Redis Streams consumer groups.
  - Uses a Redis lock (`dispatch:lock:{task_id}`) and a done key (`dispatch:done:{task_id}`).
  - Retries up to N attempts; dead-letters to `queue:dispatch:dead` / `queue:a2a:dead`.

### Worker + Tool Execution
- File: `worker-playwright/app/main.py`
  - `/run` executes either:
    - MCP search via `mcp-server`, or
    - Browser jobs via `playwright-gateway`.
- File: `playwright-gateway/app/main.py`
  - Runs a one-off Playwright runner container.
  - Creates a per-tenant Docker volume `pw_ws_t_{tenant_id}` mounted at `/workspace`.
- File: `playwright-runner/run.js`
  - Writes artifacts under `${ARTIFACT_DIR}/${TASK_ID}/...`.
  - Returns a JSON line including `artifacts: [ ... ]`.

### Gateway
- File: `gateway/nginx.conf`
  - Proxies `/api/` to api-backend and `/ws/` upgrades to api-backend.

### Resource Decision Record
- File: `.sisyphus/notepads/project-revamp-foundation/decisions.md`
  - Captures the confirmed caps/admission/fuses.

## MVP(1) Data Model (Minimal Additions)

### Reuse/Extend Existing Tables

#### tasks (as runs)
Treat `tasks` as the canonical run table.
- Add/standardize fields (suggested):
  - `kind` (e.g., 'run')
  - `input_nl` (user natural language spec)
  - `root_agent_id` (FK to agent_instances.id)
  - `tree_revision` (int)
  - `resource_profile_snapshot` (jsonb) (tier + caps snapshot)

#### events (as the replay spine)
Keep `events` as the single durable audit log.
- Add fields (suggested):
  - `run_id` (FK tasks.id)
  - `agent_id` (nullable FK agent_instances.id)
  - `action_id` (nullable FK actions.id)
  - `cursor` / `seq` (monotonic per run for WS delta)
  - `type` (expanded beyond task.*)

### New Tables (Run-scoped)

#### agent_instances
Run-scoped "employees" that form the strict tree.
- `id`, `tenant_id`, `run_id`, `parent_agent_id`
- `name`, `role_label`
- `state` (queued|running|needs_human|completed|failed|paused)
- `current_sop_version_id`
- `workspace_id`
- `resource_allocation_snapshot` (jsonb: cpu/mem/disk)

#### sop_versions
Immutable SOP versions per agent.
- `id`, `tenant_id`, `agent_id`
- `version` (int, monotonic per agent)
- `md_path` (host-mounted relative path preferred)
- `md_sha256`
- `base_sop_version_id` (nullable)
- `created_by_user_id` / `created_by_agent_id`

#### actions
Auditable interventions (natural language -> structured apply).
- `id`, `tenant_id`, `run_id`, `target_agent_id`
- `action_type` (sop.patch|sop.replace|agent.pause|agent.resume|...)
- `params_json`
- `expected_head` (optimistic concurrency)
- `idempotency_key`
- `status` (requested|accepted|applied|rejected|failed)
- `applied_sop_version_id` (nullable)

#### tools / tool_permissions
Registry and enforcement policy.
- `tools`: key, description, schema, enabled
- `tool_permissions`: scope run/agent, allow/deny, constraints jsonb

#### membership_tiers / resource_profiles
Future-ready mapping for plan-based caps.
- `tenant -> tier`
- `tier -> default caps`
- MVP uses the fixed caps from decisions.md.

## SOP Storage Layout (Host-mounted)

Root: `ROBOARD_ROOT/sops/`
- SOP files:
  - `ROBOARD_ROOT/sops/{tenant_id}/{run_id}/{agent_id}/v{version}.md`
- Metadata in Postgres (`sop_versions`): path + sha + version + creator.

Inheritance:
- Child SOP v1 is created by copying (and editing) the parent's SOP into a new full file.

## Contracts (HTTP + WS)

### HTTP (New/Unified)
The external surface uses `runs` naming.

Run creation
- `POST /api/runs`
  - body: `{ input_nl: string }`
  - returns: `{ run_id, root_agent_id }`

Cockpit tree
- `GET /api/runs/{run_id}/tree`
  - returns: `{ run, agents: [...], edges: [...], cursor }`

Events replay
- `GET /api/runs/{run_id}/events?after=<cursor>&limit=N`
  - returns: `{ events: [...], next_cursor }`

Agent details
- `GET /api/agents/{agent_id}`
  - returns: `{ agent_instance, workspace_meta, tool_permissions_meta, current_sop_version_meta }`

SOP view
- `GET /api/agents/{agent_id}/sop?version=<id|n>`
  - returns: `{ sop_version_meta, md_text }`

Interventions
- `POST /api/runs/{run_id}/actions`
  - body: `{ target_agent_id, action_type, params, expected_head, idempotency_key }`
  - returns: `{ action_id, status }`
- `GET /api/actions/{action_id}`
  - returns: `{ action, status, applied_sop_version_id?, error? }`

Compatibility:
- Keep existing `/api/tasks` endpoints for now.
- Consider implementing `/api/runs` as an alias to `/api/tasks` with new schema.

### WebSocket
Requirement: snapshot + delta, tree + logs.

Recommended new channel:
- `/ws/runs/{run_id}?session_token=...`

Server -> Client
- `snapshot`: `{ run, agents, edges, cursor, recent_events }`
- `event.append`: `{ cursor, event }`
- `action.status`: `{ action_id, status, ... }`
- `sop.updated`: `{ agent_id, sop_version_id, version, sha256 }`

Compatibility:
- Existing `/ws/events` and `/ws/world` continue to work until UI migrates.

## Event Types (MVP(1) Minimal)

Existing task-level types (current system)
- task.created
- task.step.started
- task.step.progress
- task.step.artifact
- task.requires_input
- task.completed
- task.failed

Add (MVP(1))
- run.created
- run.admission.queued (include reason: cap reached / fuse)
- agent.hired
- agent.state.changed
- agent.step.started / agent.step.progress / agent.step.artifact / agent.step.failed / agent.step.completed
- sop.created
- sop.updated
- action.requested
- action.applied
- action.rejected
- action.failed

## Admission Control (Machine-level)

Definitions
- Active user: a tenant that currently has at least one running agent_instance.

Limits
- Per-user caps: cpu=0.25 core, mem=2 GiB, disk=5 GiB.
- Machine max_active_users: 5.

Fuses
- Stop admitting new active users when:
  - swap_used > 4 GiB, OR
  - mem_available < 500 MiB.

Behavior
- Policy A: allow run creation but set run state to queued and emit `run.admission.queued` with reason.

## Employee Lifecycle Mapping (Hire / Handoff / Offboard)

Agent instances are the system's "employees" for a run.
- Hire:
  - Create agent_instances row
  - Create workspace
  - Create sop_versions v1 and write SOP file
  - Emit `agent.hired` + `sop.created`
- Work:
  - Emit step and artifact events
- Handoff:
  - Persist all decisions and produced artifacts; events are the canonical replay log
- Offboard:
  - Terminal agent state + archive workspace (future)

Process docs (human operators)
- `.sisyphus/notepads/project-revamp-foundation/employees.md`
- `.sisyphus/notepads/project-revamp-foundation/handoffs.md`

## Appendix: MVP(2) and MVP(3) (Brief)

MVP(2)
- Add vertical scenario completeness (e.g., supplier monitoring), scheduling, and reporting.

MVP(3)
- Normalize contracts and schemas, introduce agent template reuse, and implement billing/usage accounting.
