#!/usr/bin/env bash
set -euo pipefail

bootstrap_action=$(python - <<'PY'
import os
import sys

from sqlalchemy import create_engine, inspect

url = os.getenv("DATABASE_URL")
if not url:
    print("DATABASE_URL is not set", file=sys.stderr)
    sys.exit(1)

engine = create_engine(url)
try:
    with engine.connect() as connection:
        inspector = inspect(connection)
        has_alembic = inspector.has_table("alembic_version")
        business_tables = ("tenants", "tasks", "events", "notifications")
        has_business = any(inspector.has_table(name) for name in business_tables)
finally:
    engine.dispose()

if has_alembic:
    print("upgrade")
elif has_business:
    print("stamp")
else:
    print("upgrade")
PY
)

case "${bootstrap_action}" in
    stamp)
        echo "Database has tables without alembic_version; stamping head"
        alembic stamp head
        ;;
    upgrade)
        echo "Applying alembic migrations"
        alembic upgrade head
        ;;
    *)
        echo "Unknown bootstrap action: ${bootstrap_action}" >&2
        exit 1
        ;;
esac

exec "$@"
