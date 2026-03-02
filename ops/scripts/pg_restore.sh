#!/usr/bin/env bash
set -euo pipefail

PG_DB="${PG_DB:-web3d}"
PG_USER="${PG_USER:-postgres}"
SERVICE="${SERVICE:-postgres}"

if [ $# -ne 1 ]; then
  echo "Usage: $0 <backup_file>"
  echo "Example: $0 backups/web3d_20250207_120000.dump"
  exit 1
fi

BACKUP_FILE="$1"

if [ ! -f "$BACKUP_FILE" ]; then
  echo "Error: Backup file not found: $BACKUP_FILE"
  exit 1
fi

echo "================================"
echo "POSTGRES DATABASE RESTORE"
echo "================================"
echo ""
echo "WARNING: This will COMPLETELY ERASE and REPLACE the '$PG_DB' database!"
echo "All existing data will be lost."
echo ""
echo "Backup file: $BACKUP_FILE"
echo "Database: $PG_DB"
echo "User: $PG_USER"
echo "Service: $SERVICE"
echo ""
read -p "Type 'yes' to continue: " confirm

if [ "$confirm" != "yes" ]; then
  echo "Restore cancelled."
  exit 0
fi

echo ""
echo "[1/4] Stopping dependent services..."

DEPENDENT_SERVICES="api-backend agent-manager"
for svc in $DEPENDENT_SERVICES; do
  echo "  Stopping $svc..."
  docker compose stop "$svc" || true
done

echo ""
echo "[2/4] Dropping existing database..."
docker compose exec -T "$SERVICE" psql -U "$PG_USER" -c "DROP DATABASE IF EXISTS $PG_DB;" || true

echo ""
echo "[3/4] Creating empty database..."
docker compose exec -T "$SERVICE" psql -U "$PG_USER" -c "CREATE DATABASE $PG_DB;" || true

echo ""
echo "[4/4] Restoring data from backup..."
cat "$BACKUP_FILE" | docker compose exec -T "$SERVICE" pg_restore -U "$PG_USER" -d "$PG_DB" -Fc

echo ""
echo "[5/5] Restarting dependent services..."
for svc in $DEPENDENT_SERVICES; do
  echo "  Starting $svc..."
  docker compose start "$svc" || true
done

echo ""
echo "================================"
echo "RESTORE COMPLETE"
echo "================================"
echo ""
echo "Database '$PG_DB' has been restored from:"
echo "  $BACKUP_FILE"
echo ""
