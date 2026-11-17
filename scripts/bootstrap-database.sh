#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
docker compose exec -T postgres bash /docker-entrypoint-initdb.d/10-bootstrap.sh "$@"
