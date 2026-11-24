#!/usr/bin/env bash
# Build and (re)start the stack. Migrations run automatically (migrate service). Records the version for rollback.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env.prod ] || { echo ".env.prod missing"; exit 1; }
chmod 600 .env.prod
set -a; . ./.env.prod; set +a
C="docker compose -f docker-compose.prod.yml --env-file .env.prod"
[ -f deploy/nginx/conf.d/default.conf ] || deploy/render-nginx.sh http "$DOMAIN"
if docker volume ls -q | grep -q "_pgdata$"; then deploy/backup.sh pre-deploy || echo "WARNING: pre-deploy backup failed"; fi
prev="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
echo "$prev" >> deploy/.deployed_versions
APP_VERSION="$prev" $C up -d --build
$C ps
echo "Waiting for backend health..."
for i in $(seq 1 30); do $C exec -T backend python -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8000/health',timeout=3)" 2>/dev/null && { echo healthy; break; }; sleep 4; done
echo "First deploy only: seed demo data ->  $C run --rm backend python -m app.database.seed && $C run --rm backend python -m app.workers.runner --enqueue-uploaded --once && $C run --rm backend python -m app.ml.train"
