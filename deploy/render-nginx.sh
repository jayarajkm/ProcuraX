#!/usr/bin/env bash
# Usage: deploy/render-nginx.sh http|https DOMAIN   -> writes deploy/nginx/conf.d/default.conf
set -euo pipefail
mode="${1:?http|https}"; domain="${2:?domain}"
cd "$(dirname "$0")/nginx"
sed "s/__DOMAIN__/${domain}/g" "${mode}.conf.template" > conf.d/default.conf
echo "rendered ${mode} config for ${domain}"
