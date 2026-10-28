#!/usr/bin/env bash
# Which parts of the repository a change touches, so CI can skip the jobs it does not need (a job
# skipped this way counts as passed for `ci-ok`; a workflow skipped by `on.paths` would leave the
# required check waiting forever: docs/CI.md).
# Prints `name=true|false` lines, which CI appends to $GITHUB_OUTPUT.
# Usage: scripts/ci/changes.sh <base ref or SHA>   (no base, as on a push or a manual run: all true)
set -euo pipefail

base=${1:-}
if [ -z "$base" ]; then
  echo "code=true"
  echo "infra=true"
  exit 0
fi

files=$(git diff --name-only "$base"...HEAD)
# Anything but notes: Markdown under docs/, and TODO. Nothing in them is read by a build, a test or a
# check (docs/*.jsonl and docs/coverage-floor.json are data the scripts read, so they count as code;
# other Markdown, such as the READMEs, may ship). Keep in step with `paths-ignore` in deploy.yml
if grep -qvE '^(docs/.*\.md|TODO)$' <<<"$files"; then
  echo "code=true"
else
  echo "code=false"
fi
# The Terraform stacks, and what checks them
if grep -qE '^(infra/|scripts/infra-check\.sh$|mise\.toml$)' <<<"$files"; then
  echo "infra=true"
else
  echo "infra=false"
fi
