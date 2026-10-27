#!/usr/bin/env bash
# The hash of the build the live site is running (scripts/build-hash.ts, served as /version.json), or
# nothing when it does not say (an older deploy, the site down): the caller then treats it as
# different. Usage: scripts/ci/live-hash.sh [site]
set -uo pipefail

site=${1:-https://chordless.app}
# no-cache, and a query to get past any cache in between: this must be what is running now
curl -fsS --max-time 20 -H 'Cache-Control: no-cache' "$site/version.json?$(date +%s)" 2>/dev/null |
  jq -er '.hash // empty' 2>/dev/null || true
