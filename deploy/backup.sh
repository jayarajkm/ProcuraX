#!/usr/bin/env bash
# Backup Postgres (custom-format dump) + uploaded documents + model artefacts. Keeps the newest $KEEP (default 14).
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env.prod; set +a
C="docker compose -f docker-compose.prod.yml --env-file .env.prod"
dir="${BACKUP_DIR:-/var/backups/procurax}"; label="${1:-manual}"; ts="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$dir"; umask 077
$C exec -T postgres pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB" > "$dir/db-$ts-$label.dump"
$C run --rm --no-deps -T -v "$dir:/backup" --entrypoint tar backend czf "/backup/files-$ts-$label.tgz" -C /data uploads models
echo "backup written: $dir/db-$ts-$label.dump and files-$ts-$label.tgz"
ls -1t "$dir"/db-*.dump | tail -n +$(( ${KEEP:-14} + 1 )) | xargs -r rm -f
ls -1t "$dir"/files-*.tgz | tail -n +$(( ${KEEP:-14} + 1 )) | xargs -r rm -f
# schedule daily at 02:30:  30 2 * * * cd /home/procurax/procuraX && deploy/backup.sh daily >> /var/log/procurax-backup.log 2>&1
