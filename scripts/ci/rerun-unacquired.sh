#!/usr/bin/env bash
# Re-run a CI or Deploy run whose only failure is a job that GitHub never gave a runner (docs/CI.md,
# "A job that never gets a runner"): macOS arm64 runners are short of capacity at times, and a job that
# waits 15 minutes for one is cancelled with "The job was not acquired by Runner of type hosted even
# after multiple attempts". That says nothing of the code, and the run then fails as a whole (`ci-ok`).
#
# It re-runs the failed jobs only when *every* job that failed or was cancelled (`ci-ok`, which only
# counts the others, aside) either had no runner and says exactly that, or was cancelled by the run's own
# token ("canceled by @github-actions": the watchdog, scripts/ci/watch-unacquired.sh, which cancels a run
# that is only waiting for a runner, after a few minutes and not fifteen). A real failure, a job cancelled
# by a newer push ("a higher priority waiting request") or by a person, is left alone: nothing is retried
# over a test that failed, and a run that is not for the newest commit of a pull request is not re-run,
# as the re-run would cancel the newer one.
#
# Env: GH_TOKEN, GH_REPO, RUN_ID, RUN_ATTEMPT, HEAD_SHA, and PR_NUMBER (empty for a run on main).
# Always exits 0: it is a convenience, and must never be what fails a run.
set -uo pipefail

: "${RUN_ID:?}" "${RUN_ATTEMPT:?}" "${HEAD_SHA:?}" "${GH_REPO:?}"
max_attempts=${MAX_ATTEMPTS:-3}

say() { printf '%s\n' "$*"; }

if [ "$RUN_ATTEMPT" -ge "$max_attempts" ]; then
  say "Attempt $RUN_ATTEMPT of run $RUN_ID is the last ($max_attempts): not re-running."
  exit 0
fi

jobs=$(gh api "repos/$GH_REPO/actions/runs/$RUN_ID/jobs" --paginate) || { say "Could not list the jobs: not re-running."; exit 0; }

# The jobs that failed or were cancelled, other than the one that only adds the others up. A job with
# no runner has "-" for it: `read` takes a tab as white space, so an empty field would be skipped
failed=$(jq -r '.jobs[] | select(.conclusion == "failure" or .conclusion == "cancelled")
  | select(.name | test("(^|/ )ci-ok$") | not)
  | [.id, .conclusion, (.runner_name // "-"), .name] | @tsv' <<<"$jobs")

if [ -z "$failed" ]; then
  say "No job failed or was cancelled but ci-ok: nothing to re-run."
  exit 0
fi

while IFS=$'\t' read -r id conclusion runner name; do
  message=$(gh api "repos/$GH_REPO/check-runs/$id/annotations" --jq '.[].message' 2>/dev/null) || message=''
  if [ "$runner" = "-" ] && grep -q "not acquired by Runner" <<<"$message"; then
    say "'$name' was never given a runner."
  elif [ "$conclusion" = "cancelled" ] && grep -q "canceled by @github-actions" <<<"$message"; then
    say "'$name' was cancelled by the run's own token (the watchdog)."
  elif [ "$conclusion" = "failure" ]; then
    say "'$name' failed on a runner ($runner): a real failure, not re-running."
    exit 0
  else
    say "'$name' was cancelled, but not for want of a runner or by the watchdog (a newer push, or a person): not re-running."
    exit 0
  fi
done <<<"$failed"

# A re-run of a run that is not for the newest commit of its pull request would cancel the newer one
# (the two share a concurrency group)
if [ -n "${PR_NUMBER:-}" ]; then
  head=$(gh pr view "$PR_NUMBER" --json headRefOid --jq .headRefOid 2>/dev/null) || head=''
  if [ "$head" != "$HEAD_SHA" ]; then
    say "Run $RUN_ID is for $HEAD_SHA, not the head of #$PR_NUMBER ($head): not re-running."
    exit 0
  fi
fi

say "Re-running the failed jobs of run $RUN_ID (attempt $RUN_ATTEMPT of at most $max_attempts)."
gh run rerun "$RUN_ID" --failed || say "The re-run was refused."
exit 0
