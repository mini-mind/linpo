#!/usr/bin/env bash
set -euo pipefail

patterns=(
  'PATCH /api/runs/{run_id}/agents/{agent_id}/state'
  'updateAgentState'
)
targets=(
  "session-f-edge-ui/web-frontend/app.js"
  "session-f-edge-ui/web-frontend/README.md"
  "session-a-docs/README.md"
  "session-a-docs/agent-framework.md"
)

if ! command -v rg >/dev/null 2>&1; then
  echo "Error: rg is required but not found in PATH." >&2
  exit 2
fi

for pattern in "${patterns[@]}"; do
  set +e
  matches=$(rg -n --fixed-strings "$pattern" "${targets[@]}")
  status=$?
  set -e

  if [[ $status -eq 0 ]]; then
    echo "Found forbidden reference: $pattern" >&2
    echo "$matches" >&2
    exit 1
  fi

  if [[ $status -ne 1 ]]; then
    echo "Error: rg failed for pattern: $pattern" >&2
    exit $status
  fi
done

echo "OK: No state patch references found."
