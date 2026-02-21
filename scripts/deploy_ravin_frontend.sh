#!/usr/bin/env bash
set -euo pipefail

RAVIN_HOST="${RAVIN_HOST:-68.64.179.125}"
RAVIN_USER="${RAVIN_USER:-ravin}"
ROBOARD_ROOT="${ROBOARD_ROOT:-/home/ravin/roboard-root}"
DRY_RUN="${DRY_RUN:-0}"

if [ -z "${TAG:-}" ]; then
  if git rev-parse --git-dir >/dev/null 2>&1; then
    TAG="$(date +%Y%m%d)-$(git rev-parse --short HEAD)"
  else
    echo "Error: Not in a git repository and TAG not provided" >&2
    exit 1
  fi
fi

REMOTE_CMDS="cd ${ROBOARD_ROOT} && ROBOARD_ROOT=${ROBOARD_ROOT} TAG=${TAG} docker compose -f deploy/prod/docker-compose.frontend.yml pull gateway web-frontend && ROBOARD_ROOT=${ROBOARD_ROOT} TAG=${TAG} docker compose -f deploy/prod/docker-compose.frontend.yml up -d gateway web-frontend && ROBOARD_ROOT=${ROBOARD_ROOT} TAG=${TAG} docker compose -f deploy/prod/docker-compose.frontend.yml ps"

if [ "${DRY_RUN}" = "1" ]; then
  echo "DRY RUN - Would execute:"
  echo "ssh ${RAVIN_USER}@${RAVIN_HOST} '${REMOTE_CMDS}'"
else
  echo "Deploying ravin frontend services with TAG=${TAG}..."
  echo "Host: ${RAVIN_USER}@${RAVIN_HOST}"
  echo "ROBOARD_ROOT: ${ROBOARD_ROOT}"
  echo ""
  ssh "${RAVIN_USER}@${RAVIN_HOST}" "${REMOTE_CMDS}"
fi
