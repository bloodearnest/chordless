#!/usr/bin/env bash
# Every package in package-lock.json comes from the npm registry, over https, with a sha512
# integrity hash (`just audit`; docs/CI.md). A change to the lockfile could otherwise point a
# package at a tarball anywhere (a fork, a gist, a mirror), which `npm ci` would fetch and trust.
# Links (workspaces) are the one exception: they have no tarball.
# Usage: scripts/check-lockfile.sh [package-lock.json]
set -euo pipefail

lockfile=${1:-package-lock.json}
bad=$(jq -r '
  .packages | to_entries[]
  | select(.key != "" and (.value.link | not))
  | select(
      ((.value.resolved // "") | startswith("https://registry.npmjs.org/") | not)
      or ((.value.integrity // "") | startswith("sha512-") | not)
    )
  | "  \(.key): \(.value.resolved // "no resolved URL") (\(.value.integrity // "no integrity hash"))"
' "$lockfile")

if [ -n "$bad" ]; then
  echo "$lockfile has packages that are not from the npm registry with a sha512 hash:"
  echo "$bad"
  exit 1
fi
echo "$lockfile: every package is from registry.npmjs.org, with a sha512 hash"
