#!/usr/bin/env bash
# First-time HTTPS: serve HTTP, obtain a Let's Encrypt certificate, then switch nginx to HTTPS.
# Requires: DNS A record for $DOMAIN -> this server, ports 80/443 open, .env.prod filled.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env.prod; set +a
C="docker compose -f docker-compose.prod.yml --env-file .env.prod"
deploy/render-nginx.sh http "$DOMAIN"
$C up -d nginx
$C run --rm --entrypoint certbot certbot certonly --webroot -w /var/www/certbot -d "$DOMAIN" --email "$LETSENCRYPT_EMAIL" --agree-tos --no-eff-email
deploy/render-nginx.sh https "$DOMAIN"
$C exec nginx nginx -s reload
$C --profile tls up -d certbot
echo "HTTPS enabled for $DOMAIN (certbot container renews automatically)."
