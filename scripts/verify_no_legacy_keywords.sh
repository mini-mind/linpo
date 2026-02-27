#!/usr/bin/env bash
set -euo pipefail

if ! command -v rg >/dev/null 2>&1; then
  echo "rg is required but not installed" >&2
  exit 2
fi

set +e
rg -n -i "schedules|templates|reporting|kanban|mvp2" \
  docs api-backend agent-manager web-frontend \
  -g "*.md" -g "*.html" -g "*.js" -g "*.css" -g "*.txt" \
  --glob "!docs/plans/**" \
  --glob "!docs/prd/**"
rg_status=$?
set -e

if [ "$rg_status" -eq 0 ]; then
  echo "Legacy keyword matches found" >&2
  exit 1
fi

if [ "$rg_status" -ne 1 ]; then
  exit "$rg_status"
fi
