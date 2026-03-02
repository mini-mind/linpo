#!/usr/bin/env bash
set -euo pipefail

PG_DB="${PG_DB:-roboard}"
PG_USER="${PG_USER:-postgres}"
BACKUP_DIR="${BACKUP_DIR:-backups}"
SERVICE="${SERVICE:-postgres}"

mkdir -p "$BACKUP_DIR"

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/${PG_DB}_${TIMESTAMP}.dump"

docker compose exec -T "$SERVICE" pg_dump -U "$PG_USER" -Fc "$PG_DB" > "$BACKUP_FILE"

echo "Backup created: $BACKUP_FILE"
