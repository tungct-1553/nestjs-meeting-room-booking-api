#!/usr/bin/env bash
set -euo pipefail
adopt=false
if [[ ${1:-} == --adopt-app-objects && $# == 1 ]]; then
  adopt=true
elif [[ $# != 0 ]]; then
  echo 'Usage: bootstrap.sh [--adopt-app-objects]' >&2
  exit 2
fi
: "${BOOKING_DB_PASSWORD:?BOOKING_DB_PASSWORD is required}"
: "${KEYCLOAK_DB_PASSWORD:?KEYCLOAK_DB_PASSWORD is required}"
psql -X -v ON_ERROR_STOP=1 \
  --username "${POSTGRES_USER:-postgres}" --dbname "${POSTGRES_DB:-meeting_room_booking}" \
  -v booking_password="$BOOKING_DB_PASSWORD" \
  -v keycloak_password="$KEYCLOAK_DB_PASSWORD" \
  -v adopt="$adopt" -f /opt/booking/bootstrap.sql
