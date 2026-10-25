#!/usr/bin/env bash
# The browser a CI job's Playwright tests run in (playwright.config.ts, CHORDLESS_BROWSER).
#   chromium, webkit  Playwright's own build, unless the cache already brought it, and on Linux the
#                     system libraries it needs (apt: not cached)
#   chrome            Google Chrome as the runner has it installed: nothing to fetch
# Usage: scripts/ci/install-browser.sh <browser> <cached: true|false>
set -euo pipefail

browser=${1:?Usage: $0 <browser> <cached>}
cached=${2:-false}

case "$browser" in
  chrome)
    exit 0
    ;;
  chromium | webkit)
    if [ "$cached" != true ]; then
      npx playwright install "$browser"
    fi
    if [ "$(uname -s)" = Linux ]; then
      npx playwright install-deps "$browser"
    fi
    ;;
  *)
    echo "No such browser: $browser"
    exit 1
    ;;
esac
