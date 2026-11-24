#!/usr/bin/env bash
# Run ON a fresh Ubuntu 24.04 droplet as root. Installs Docker, firewall (22/80/443 only), swap, unattended upgrades.
# Review before running. Nothing here creates cloud resources.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "run as root"; exit 1; }
apt-get update && apt-get install -y ca-certificates curl git ufw fail2ban unattended-upgrades
curl -fsSL https://get.docker.com | sh
ufw default deny incoming && ufw default allow outgoing
ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp
ufw --force enable
if ! swapon --show | grep -q .; then fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile && echo '/swapfile none swap sw 0 0' >> /etc/fstab; fi
useradd -m -s /bin/bash -G docker procurax 2>/dev/null || true
echo "Done. Next: clone the repo as user 'procurax', create .env.prod, run deploy/init-tls.sh then deploy/deploy.sh"
