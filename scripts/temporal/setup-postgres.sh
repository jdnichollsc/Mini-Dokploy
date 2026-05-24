#!/usr/bin/env sh
# Initialize Temporal SQL schema in PostgreSQL. Idempotent.
set -eu

DB_HOST="${POSTGRES_SEEDS:-temporal-postgresql}"
DB_PORT="${DB_PORT:-5432}"
USER="${POSTGRES_USER:-temporal}"
PWD="${POSTGRES_PWD:-temporal}"

echo "→ Setting up Temporal databases on $DB_HOST:$DB_PORT..."

# Create databases (ignore "already exists" errors).
SQL_USER="$USER" SQL_PASSWORD="$PWD" temporal-sql-tool \
  --plugin postgres12 --ep "$DB_HOST" -p "$DB_PORT" \
  --db temporal create-database || true
SQL_USER="$USER" SQL_PASSWORD="$PWD" temporal-sql-tool \
  --plugin postgres12 --ep "$DB_HOST" -p "$DB_PORT" \
  --db temporal_visibility create-database || true

# Apply schemas.
SQL_USER="$USER" SQL_PASSWORD="$PWD" temporal-sql-tool \
  --plugin postgres12 --ep "$DB_HOST" -p "$DB_PORT" --db temporal setup-schema -v 0.0
SQL_USER="$USER" SQL_PASSWORD="$PWD" temporal-sql-tool \
  --plugin postgres12 --ep "$DB_HOST" -p "$DB_PORT" --db temporal \
  update -schema-dir /etc/temporal/schema/postgresql/v12/temporal/versioned

SQL_USER="$USER" SQL_PASSWORD="$PWD" temporal-sql-tool \
  --plugin postgres12 --ep "$DB_HOST" -p "$DB_PORT" --db temporal_visibility setup-schema -v 0.0
SQL_USER="$USER" SQL_PASSWORD="$PWD" temporal-sql-tool \
  --plugin postgres12 --ep "$DB_HOST" -p "$DB_PORT" --db temporal_visibility \
  update -schema-dir /etc/temporal/schema/postgresql/v12/visibility/versioned

echo "✓ Temporal SQL schema ready"
