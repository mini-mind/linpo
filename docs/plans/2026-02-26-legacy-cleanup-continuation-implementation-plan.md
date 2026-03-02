# Legacy Cleanup Continuation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove remaining Kanban UI and legacy endpoint references, align frontend/docs with PRD v3.0, and verify no legacy residues remain.

**Architecture:** This is a documentation + static frontend cleanup; no new runtime features. The approach is to delete obsolete UI blocks/styles, remove references to deleted endpoints, and then verify the repo is free of legacy strings and broken references.

**Tech Stack:** Static HTML/CSS/JS, FastAPI (Python) services, pytest, rg.

---

### Task 1: Remove Kanban UI and view toggle from the frontend

**Files:**
- Modify: `session-f-edge-ui/web-frontend/index.html`
- Modify: `session-f-edge-ui/web-frontend/app.js`
- Modify: `session-f-edge-ui/web-frontend/style.css`
- Modify: `session-f-edge-ui/web-frontend/README.md`
- Modify: `session-f-edge-ui/web-frontend/AGENTS.md`
- Create: `session-g-ops/scripts/verify_no_kanban_refs.sh`

**Step 1: Write the failing test**

Create a tiny verification script so the check fails while kanban strings remain.

```bash
#!/usr/bin/env bash
set -euo pipefail

rg -n "kanban|Kanban|kanban-column|kanban-board|view-toggle" web-frontend
```

Save it to `session-g-ops/scripts/verify_no_kanban_refs.sh`.

**Step 2: Run test to verify it fails**

Run: `bash session-g-ops/scripts/verify_no_kanban_refs.sh`
Expected: Non-zero exit with matches in web-frontend files.

**Step 3: Write minimal implementation**

Remove the Kanban UI from `session-f-edge-ui/web-frontend/index.html`, strip Kanban rendering logic and view toggle from `session-f-edge-ui/web-frontend/app.js`, and delete Kanban CSS blocks from `session-f-edge-ui/web-frontend/style.css`. Update `session-f-edge-ui/web-frontend/README.md` and `session-f-edge-ui/web-frontend/AGENTS.md` to remove Kanban mentions.

**Step 4: Run test to verify it passes**

Run: `bash session-g-ops/scripts/verify_no_kanban_refs.sh`
Expected: Exit 0, no matches.

**Step 5: Commit**

```bash
git add session-f-edge-ui/web-frontend/index.html session-f-edge-ui/web-frontend/app.js session-f-edge-ui/web-frontend/style.css session-f-edge-ui/web-frontend/README.md session-f-edge-ui/web-frontend/AGENTS.md session-g-ops/scripts/verify_no_kanban_refs.sh
git commit -m "chore: remove kanban UI remnants"
```

---

### Task 2: Remove legacy agent state patch references in frontend/docs

**Files:**
- Modify: `session-f-edge-ui/web-frontend/app.js`
- Modify: `session-f-edge-ui/web-frontend/README.md`
- Modify: `session-a-docs/README.md`
- Modify: `session-a-docs/agent-framework.md`

**Step 1: Write the failing test**

Add a simple check script that fails if the deleted endpoint is referenced.

```bash
#!/usr/bin/env bash
set -euo pipefail

rg -n "PATCH /api/runs/.*/agents/.*/state|agents/.*/state" docs web-frontend
```

Save it to `session-g-ops/scripts/verify_no_state_patch_refs.sh`.

**Step 2: Run test to verify it fails**

Run: `bash session-g-ops/scripts/verify_no_state_patch_refs.sh`
Expected: Non-zero exit if references still exist.

**Step 3: Write minimal implementation**

Remove any UI/UX flows or docs referencing the `PATCH /api/runs/{run_id}/agents/{agent_id}/state` endpoint.

**Step 4: Run test to verify it passes**

Run: `bash session-g-ops/scripts/verify_no_state_patch_refs.sh`
Expected: Exit 0, no matches.

**Step 5: Commit**

```bash
git add session-f-edge-ui/web-frontend/app.js session-f-edge-ui/web-frontend/README.md session-a-docs/README.md session-a-docs/agent-framework.md session-g-ops/scripts/verify_no_state_patch_refs.sh
git commit -m "docs: remove legacy agent state patch references"
```

---

### Task 3: Repo-wide legacy residue sweep and verification

**Files:**
- Modify: `session-a-docs/README.md`
- Modify: `session-a-docs/handoff/worker-development.md`
- Modify: `session-a-docs/prod-deployment.md`
- Modify: `session-a-docs/deployment/local.md`

**Step 1: Write the failing test**

Create a script that fails if any legacy keywords remain.

```bash
#!/usr/bin/env bash
set -euo pipefail

rg -n "schedules|templates|reporting|kanban|mvp2|MVP2" docs api-backend agent-manager web-frontend
```

Save it to `session-g-ops/scripts/verify_no_legacy_keywords.sh`.

**Step 2: Run test to verify it fails**

Run: `bash session-g-ops/scripts/verify_no_legacy_keywords.sh`
Expected: Non-zero exit if any matches remain.

**Step 3: Write minimal implementation**

Remove or update remaining references so all docs align with PRD v3.0. If a reference is still valid in a historical context, reword it to avoid implying the feature exists now.

**Step 4: Run test to verify it passes**

Run: `bash session-g-ops/scripts/verify_no_legacy_keywords.sh`
Expected: Exit 0, no matches.

**Step 5: Run service checks**

Run:
```bash
cd api-backend && .venv/bin/python -m pytest -q
cd agent-manager && .venv/bin/python -m pytest -q
```
Expected: All tests pass.

**Step 6: Commit**

```bash
git add session-a-docs/README.md session-a-docs/handoff/worker-development.md session-a-docs/prod-deployment.md session-a-docs/deployment/local.md session-g-ops/scripts/verify_no_legacy_keywords.sh
git commit -m "docs: align remaining references to PRD v3"
```
