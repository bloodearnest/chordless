#!/usr/bin/env bash
# Checks on the npm packages (`just audit`, which `just lint` runs; docs/CI.md):
# - Every package is the one the registry signed, and where it publishes provenance (which repository
#   and build made it), that is genuine: not a tarball changed after publishing
# - No production dependency (what ships to users) has a known high or critical advisory. The dev
#   tools' advisories are listed but do not fail: they never reach users, and one with no fix yet
#   (in wrangler's own dependencies, say) would otherwise block every change
set -euo pipefail
cd "$(dirname "$0")/.."

npm audit signatures

npm audit --omit=dev --audit-level=high

echo
echo "The dev tools' advisories (for information):"
npm audit --include=dev --audit-level=none | grep -E '^[a-z@].*  |^[0-9]+ vulnerabilit|^found 0' || true
