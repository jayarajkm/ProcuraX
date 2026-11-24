#!/usr/bin/env bash
# DESTRUCTIVE: replaces the database (and optionally files) with a backup.   Usage: deploy/restore.sh db-XXXX.dump [files-XXXX.tgz]
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env.prod; set +a
C="docker compose -f docker-compose.prod.yml --env-file .env.prod"
dump="${1:?path to db dump}"; files="${2:-}"
[ -f "$dump" ] || { echo "no such file: $dump"; exit 1; }
read -r -p "This ERASES the current database '$POSTGRES_DB' and restores $dump. Type RESTORE to continue: " ok
[ "$ok" = "RESTORE" ] || { echo aborted; exit 1; }
$C stop backend worker
$C exec -T postgres psql -U "$POSTGRES_USER" -d postgres -c "DROP DATABASE IF EXISTS \"$POSTGRES_DB\" WITH (FORCE)" -c "CREATE DATABASE \"$POSTGRES_DB\""
$C exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "CREATE EXTENSION IF NOT EXISTS vector" -c "CREATE EXTENSION IF NOT EXISTS pgcrypto"
$C exec -T postgres pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner < "$dump"
if [ -n "$files" ]; then $C run --rm --no-deps -T -v "$(cd "$(dirname "$files")" && pwd):/backup:ro" --entrypoint tar backend xzf "/backup/$(basename "$files")" -C /data; fi
$C up -d backend worker
echo "restore complete"
