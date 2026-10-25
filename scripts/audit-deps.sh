#!/usr/bin/env bash
# Checks on the npm packages (`just audit`, which `just lint` runs; docs/CI.md):
# - Every package is the one the registry signed, and where it publishes provenance (which repository
#   and build made it), that is genuine: not a tarball changed after publishing
# - No production dependency (what ships to users) has a known high or critical advisory with a fix
#   released over a week ago (scripts/audit-deps.ts): a younger fix waits for the cooldown, as
#   Dependabot does. The dev tools' advisories are listed, not failed
set -euo pipefail
cd "$(dirname "$0")/.."

npm audit signatures

node scripts/audit-deps.ts
