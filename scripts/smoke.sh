#!/usr/bin/env bash
set -euo pipefail
base="${1:?Pass the HTTPS frontend base URL}"
base="${base%/}"
[[ "$base" == https://* ]]
status() { curl -sS --max-time 20 -o /dev/null -w '%{http_code}' "$base$1"; }
root="$(curl -fsS --max-time 20 "$base/")"
deep="$(curl -fsS --max-time 20 "$base/bookings/123")"
[[ "$root" == "$deep" ]] && [[ "$root" == *'FestFlow'* ]]
curl -fsS --max-time 20 "$base/auth-config.json" | jq -e '.loginUrl and .clientId'
curl -fsS --max-time 20 "$base/api/events" | jq -e 'type=="array" and length>=1'
[[ "$(status /api/me)" == 401 ]]
[[ "$(status /api/does-not-exist)" == 404 ]]
echo 'SPA fallback, login configuration, seeded catalog, protected API and missing API route passed.'
