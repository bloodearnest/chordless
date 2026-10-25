#!/usr/bin/env bash
# The browser a CI job's Playwright tests run in (playwright.config.ts, CHORDLESS_BROWSER).
#   chromium, webkit  Playwright's own build, unless the cache already brought it, and on Linux the
#                     system libraries it needs (apt: not cached)
#   chrome, msedge    Google Chrome or Microsoft Edge, as the runner has it installed: nothing to fetch
# Usage: scripts/ci/install-browser.sh <browser> <cached: true|false>
set -euo pipefail

# The system packages the browser lacks, as Playwright lists them, but for the fonts of other
# scripts (Chinese, Japanese, Thai: no test shows them) and xvfb (a display, for headed runs only):
# `playwright install-deps` fetches all of them, which on a slow mirror took longer than the tests.
# The runner's image has Chrome, so it usually lacks nothing else, and nothing is fetched
install_linux_libraries() {
  local packages
  packages=$(npx playwright install-deps --dry-run "$1" | sed -nE 's/^ +([a-z0-9.+-]+)$/\1/p' |
    grep -vE '^(x?fonts-.*|xvfb)$' || true)
  if [ -z "$packages" ]; then
    echo "No system packages missing for $1"
    return
  fi
  echo "Installing: $packages"
  sudo apt-get update -q
  # (word splitting on purpose: one argument per package)
  # shellcheck disable=SC2086
  sudo apt-get install -y -q --no-install-recommends $packages
}

browser=${1:?Usage: $0 <browser> <cached>}
cached=${2:-false}

case "$browser" in
  chrome | msedge)
    exit 0
    ;;
  chromium | webkit)
    if [ "$cached" != true ]; then
      npx playwright install "$browser"
    fi
    if [ "$(uname -s)" = Linux ]; then
      install_linux_libraries "$browser"
    fi
    ;;
  *)
    echo "No such browser: $browser"
    exit 1
    ;;
esac
