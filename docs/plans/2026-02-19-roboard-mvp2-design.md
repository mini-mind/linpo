# RoBoard MVP(2) Design

**Scope:** MVP(2) only. This is an expansion of the MVP(2) appendix in `docs/plans/2026-02-16-roboard-mvp1-design.md`.

**Inputs / PRD Constraints:**
- Product positioning + P0 direction: `docs/decisions/positioning-2026-02-13.md`, `docs/plans/p0-development-plan-2026-02-13.md`
- Existing MVP(1) architecture: `docs/plans/2026-02-16-roboard-mvp1-design.md`
- Deployment constraints: `docs/prod-deployment.md` (compose-first, minimal ops friction)

---

## Goal

Add *vertical scenario completeness*, *scheduling*, and *reporting* on top of MVP(1) runs + realtime cockpit.

Concretely, MVP(2) should let an operator:
- Choose a scenario template (start with supplier monitoring).
- Create a run immediately, or create a schedule that will create runs on a cadence.
- View a lightweight report for a run (summary + key events) that is trustworthy and derived from the event log.

---

## Non-Goals

- No complex workflow orchestration platform.
- No new billing/usage accounting (MVP(3)).
- No template reuse system beyond a small fixed set of server-side templates.
- No new infrastructure dependencies beyond what exists (FastAPI, Postgres, Redis, agent-manager).

---

## Architecture (Minimal)

### Scheduling

Introduce a small persisted schedule entity that can create runs on a cadence.

Option A (simplest): agent-manager owns a periodic loop:
- Every N seconds, query api-backend for due schedules.
- For each due schedule, call `POST /api/runs` to create a new run (with the schedule's input/template params).
- Emit events into the run's event stream that tie it back to the schedule.

This keeps all scheduling logic server-side and does not require external cron.

### Scenario templates

Templates are server-side "compilers" that transform user inputs into a normalized run input payload.

Start with exactly one:
- `supplier.monitoring`

The output should be a normal `POST /api/runs` payload (e.g. `input_nl` + structured `input`).

### Reporting

Reports should be derived from `runs/tasks + events` as the canonical log.

MVP(2) report:
- A single endpoint that returns:
  - Run metadata
  - Agent list (optional)
  - A deterministic summary derived from events (counts, latest status, key milestones)

No LLM required for report generation in MVP(2) (trust > prose quality).

---

## Data Model (Proposed)

### schedules (new)

Fields (minimum viable):
- id
- tenant_id
- template_key (e.g. `supplier.monitoring`)
- params_json (template-specific inputs)
- interval_sec (integer)
- next_run_at (datetime)
- enabled (bool)
- created_at / updated_at

### schedule -> run linkage

For MVP(2), linkage can be event-based:
- When a run is created by a schedule, emit an event on the run:
  - `schedule.run.created` with `schedule_id`

Optionally also add a nullable column on Task (run) later.

---

## API Surface (Proposed)

Scheduling:
- `POST /api/schedules` create schedule
- `GET /api/schedules` list schedules
- `POST /api/schedules/{schedule_id}/disable` disable schedule
- `POST /api/schedules/{schedule_id}/enable` enable schedule

Templates:
- `GET /api/templates` list available templates
- `POST /api/templates/{template_key}/compile` -> returns `{input_nl, input}`

Reporting:
- `GET /api/runs/{run_id}/report` -> returns deterministic report computed from run + events

---

## Open Questions

These should be resolved before implementation begins (or choose defaults):

1) Schedule trigger semantics
- Does a schedule create a new run every interval, or only if prior run completed?
- Default for MVP(2): always create a new run, and let admission control queue if needed.

2) Report retention
- How many events should the report include / summarize?
- Default: summarize all events but return only last N events (e.g. 50) in payload.

3) Template parameters
- For `supplier.monitoring`, what is the minimal input schema?
- Default: supplier list + query keywords + frequency.
