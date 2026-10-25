#!/usr/bin/env bash
# Write a .dev.vars with made-up values, for CI and other machines without the real ones: the dev
# Worker checks its secrets as it starts (worker/src/config.ts), and the tests never reach Google.
# Leaves a .dev.vars that is already there alone.
set -euo pipefail
cd "$(dirname "$0")/../.."

if [ -e .dev.vars ]; then
  echo ".dev.vars is already there: left as it is"
  exit 0
fi
# Each NAME= line of the example gets a value that passes the Worker's checks (as in
# tests/worker.node.test.ts); the client id is the page's own (.env.development), as they must agree
client_id=$(sed -nE 's/^VITE_GOOGLE_CLIENT_ID=(.*)/\1/p' .env.development)
key=$(head -c 32 /dev/urandom | base64)
fake_api_key="AIza$(printf 'x%.0s' {1..35})"
sed -nE 's/^([A-Z_]+)=.*/\1/p' .dev.vars.example | while read -r name; do
  case "$name" in
    GOOGLE_CLIENT_ID) echo "$name=$client_id" ;;
    JWE_ENCRYPTION_KEY) echo "$name=$key" ;;
    GOOGLE_API_KEY | PICKER_API_KEY) echo "$name=$fake_api_key" ;;
    GOOGLE_REDIRECT_URI) ;;
    *) echo "$name=ci-made-up-value" ;;
  esac
done >.dev.vars
echo "Wrote .dev.vars with made-up values ($(wc -l <.dev.vars) names)"
