#!/usr/bin/env bash
set -euo pipefail

if ! command -v rg >/dev/null 2>&1; then
  echo "rg is required but was not found in PATH." >&2
  exit 1
fi

set +e
matches=$(rg -n "kanban|Kanban|kanban-column|kanban-board|view-toggle" web-frontend web-frontend/README.md web-frontend/AGENTS.md 2>&1)
rg_status=$?
set -e

if [[ ${rg_status} -eq 0 ]]; then
  echo "Kanban references found:"
  echo "${matches}"
  exit 1
fi

if [[ ${rg_status} -eq 1 ]]; then
  echo "No kanban references found."
  exit 0
fi

echo "rg failed with status ${rg_status}:" >&2
echo "${matches}" >&2
exit ${rg_status}
