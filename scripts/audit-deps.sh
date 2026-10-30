#!/usr/bin/env bash
# Checks on the npm packages that do not change with the date (`just audit`, which `just lint` runs;
# docs/CI.md):
# - Every package in the lockfile comes from the npm registry, with a sha512 hash
#   (scripts/check-lockfile.sh)
# - Every package is the one the registry signed, and where it publishes provenance (which repository
#   and build made it), that is genuine: not a tarball changed after publishing
# Known advisories are not here: a new one fails with no change of ours, so they are their own check
# (`just advisories`, scripts/advisories.sh, the Advisories workflow)
set -euo pipefail
cd "$(dirname "$0")/.."

scripts/check-lockfile.sh

npm audit signatures
