#!/usr/bin/env bash
# Cancel a CI run that is only waiting for a runner, so that rerun-unacquired.yml re-runs it in minutes
# and not after GitHub's own 15 (docs/CI.md, "A job that never gets a runner"). It is a job of the run
# (ci.yml: "Watch for a runner"), polling the run's jobs through the API.
#
# A job that gets a runner does so in seconds (34 of 38 macOS jobs: 6 s; the others waited 5 to 10
# minutes, and the stuck ones the whole 15). It cancels only when all of this holds, and has held for a
# minute (the moment between one job finishing and the next starting looks the same):
#   - no other job of the run is running (nothing in progress is lost to the cancel),
#   - no job of the run has failed (a real failure is not retried, so there is nothing to gain), and
#   - a job has been waiting for a runner for at least three minutes since it was queued.
# There is no way to cancel one job, so the run is cancelled; its other jobs are all done.
#
# Env: GH_TOKEN, GH_REPO, RUN_ID, RUN_ATTEMPT. In a Deploy run the CI jobs are named "CI / ...": the jobs
# looked at are those named like this job's own, minus its title. Always exits 0: it must never be what
# fails a run.
set -uo pipefail

: "${RUN_ID:?}" "${RUN_ATTEMPT:?}" "${GH_REPO:?}"
max_attempts=${MAX_ATTEMPTS:-3}
min_wait=${MIN_WAIT_SECONDS:-180}   # how long a job has waited for a runner, from when it was queued
stable=${STABLE_SECONDS:-60}        # how long it has been all that is left
poll=${POLL_SECONDS:-20}
limit=${MAX_SECONDS:-1500}          # GitHub gives up on a runner after 15 minutes: nothing to watch after
grace=${CANCEL_GRACE_SECONDS:-30}   # after cancelling, for the cancel to end this job
title='Watch for a runner'

say() { printf '%s\n' "$*"; if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then printf '%s\n' "$*" >>"$GITHUB_STEP_SUMMARY"; fi; }

if [ "$RUN_ATTEMPT" -ge "$max_attempts" ]; then
  say "Attempt $RUN_ATTEMPT of run $RUN_ID is the last ($max_attempts): not watching."
  exit 0
fi

started=$(date +%s)
stuck_since=''

while :; do
  now=$(date +%s)
  if [ $((now - started)) -ge "$limit" ]; then
    exit 0
  fi
  jobs=$(gh api "repos/$GH_REPO/actions/runs/$RUN_ID/jobs" --paginate) || { say "Could not list the jobs: not watching."; exit 0; }

  # idle: nothing waits for a runner. failed: a job failed. wait: not all that is left. stuck: it is.
  # Then, tab-separated, the names of the jobs that wait
  answer=$(jq -r --argjson now "$now" --argjson wait "$min_wait" --arg title "$title" '
    def mine: .name | test("(^|/ )" + $title + "$");
    (([.jobs[] | select(mine)] | first | .name // $title) | sub($title + "$"; "")) as $prefix
    | [.jobs[] | select(.name | startswith($prefix)) | select(mine | not) | select(.name | test("(^|/ )ci-ok$") | not)] as $jobs
    | ($jobs | map(select(.status != "completed" and .status != "in_progress" and .runner_name == null))) as $waiting
    | ($jobs | map(select(.status == "in_progress"))) as $running
    | ($jobs | map(select(.status == "completed" and .conclusion != "success" and .conclusion != "skipped"))) as $bad
    | [ (if ($waiting | length) == 0 then "idle"
         elif ($bad | length) > 0 then "failed"
         elif ($running | length) > 0 then "wait"
         elif (($waiting | map(.created_at | fromdateiso8601) | min) + $wait) > $now then "wait"
         else "stuck" end),
        ($waiting | map(.name) | join(", ")) ] | @tsv' <<<"$jobs") || { say "Could not read the jobs: not watching."; exit 0; }
  IFS=$'\t' read -r verdict waiting <<<"$answer"

  case "$verdict" in
    idle) exit 0 ;;
    failed)
      say "A job failed: leaving the run to GitHub's own timer, as a re-run would not help."
      exit 0
      ;;
    stuck)
      [ -n "$stuck_since" ] || stuck_since=$now
      if [ $((now - stuck_since)) -ge "$stable" ]; then
        say "Nothing else is running and no runner was given to: $waiting. Cancelling run $RUN_ID, to be re-run."
        gh run cancel "$RUN_ID" || say "The cancel was refused."
        # (this job is cancelled with the run)
        sleep "$grace"
        exit 0
      fi
      ;;
    *) stuck_since='' ;;
  esac
  sleep "$poll"
done
