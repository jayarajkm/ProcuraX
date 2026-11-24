#!/usr/bin/env bash
# Roll the CODE back to the previously deployed git version and rebuild. Database is NOT reverted automatically
# (migrations are forward-only); if a migration must be undone, restore the pre-deploy backup with deploy/restore.sh.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f deploy/.deployed_versions ] || { echo "no deploy history"; exit 1; }
target="$(tail -n 2 deploy/.deployed_versions | head -n 1)"
read -r -p "Roll code back to $target ? (y/N) " a; [ "$a" = y ] || exit 1
git checkout "$target"
deploy/deploy.sh
