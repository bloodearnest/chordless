#!/usr/bin/env bash
# `just test`: the suites at once, as each uses only part of the machine (more Playwright workers
# make each test slower, not the run shorter, with most processors still idle). The node and browser unit
# tests run in the background while the Help pictures are taken and then the Playwright tests run
# (after the pictures: tests/help.playwright.ts loads them). The background suites' output is kept
# in .stats/<suite>.log and shown when they are done: all of it for a suite that failed.
set -uo pipefail

mkdir -p .stats

# The servers the Playwright runs use (the ports of playwright.config.ts), started first so they
# start while other things run: a run uses a server that is already on its port. Each in a session
# of its own, so it can be stopped with what it started (vite, workerd)
export CHORDLESS_SERVERS_STARTED=1
CHORDLESS_PORT=8791 setsid npm run dev >.stats/dev-server.log 2>&1 &
servers=($!)
setsid bash -c 'npm run build && npm run preview -- --port 8792 --strictPort' >.stats/built-server.log 2>&1 &
servers+=($!)
stop_servers() {
  for server in "${servers[@]}"; do kill -- -"$server" 2>/dev/null; done
}
trap stop_servers EXIT
# (a run that found nothing on its port would start a server of its own there, and fail)
wait_for() {
  for _ in $(seq 240); do
    curl -sf -o /dev/null "$1" && return 0
    sleep 0.5
  done
  echo "Nothing answered at $1: see .stats/$2"
  return 1
}

just test-node >.stats/node.log 2>&1 &
node=$!
just test-unit >.stats/unit.log 2>&1 &
unit=$!

wait_for http://localhost:8791 dev-server.log &&
  just help-images &&
  wait_for http://localhost:8792 built-server.log &&
  just test-browser-headless
e2e=$?
wait $node
node_status=$?
wait $unit
unit_status=$?

report() {
  local name=$1 status=$2 log=$3 summary=$4
  if [ "$status" -ne 0 ]; then
    echo
    echo "==== $name failed: its output (also in $log)"
    cat "$log"
  else
    echo "$name: $(grep -E "$summary" "$log" | tr -s ' ' | paste -sd ' ')"
  fi
}
echo
report "Node tests" $node_status .stats/node.log '^ℹ (tests|pass|fail) '
report "Browser unit tests" $unit_status .stats/unit.log 'Finished running tests'
[ $e2e -eq 0 ] || echo "Playwright tests (or the Help pictures) failed: see above"

[ $node_status -eq 0 ] && [ $unit_status -eq 0 ] && [ $e2e -eq 0 ]
