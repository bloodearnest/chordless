#!/usr/bin/env bash
# Check wrangler.toml: a dry-run deploy of the top level and of the dev environment, which fails
# on any warning (an environment that inherits the production routes, a binding it lacks, ...).
# Nothing is deployed, and no login is needed.
set -euo pipefail

status=0
# "" is the top level (production), which wrangler wants named explicitly
for environment in "" "dev"; do
  output=$(npx wrangler deploy --dry-run --env="$environment" 2>&1) || { echo "$output"; exit 1; }
  if grep -q "WARNING" <<<"$output"; then
    echo "wrangler.toml (env: ${environment:-top level}):"
    echo "$output"
    status=1
  fi
done
exit $status
