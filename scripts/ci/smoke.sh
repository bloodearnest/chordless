#!/usr/bin/env bash
# After a deploy (.github/workflows/deploy.yml): the live site is running the build that was deployed,
# and answers. Fails if it is not so within two minutes (a deploy takes a moment to reach every
# location), and the workflow rolls back.
# Usage: scripts/ci/smoke.sh <hash the deploy shipped> [site]
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1

expected=${1:?the hash the deploy shipped}
site=${2:-https://chordless.app}

for _ in $(seq 1 24); do
  live=$(scripts/ci/live-hash.sh "$site")
  [ "$live" = "$expected" ] && break
  sleep 5
done
if [ "$live" != "$expected" ]; then
  echo "The live site runs ${live:-an unknown build}, not ${expected:0:12}" >&2
  exit 1
fi

# The page, and the Worker (the API config is the Worker's own answer, not the static assets')
status=0
page=$(curl -fsS --max-time 20 "$site/") || status=1
grep -qi '<title>' <<<"$page" || { echo "$site/ is not the page" >&2; status=1; }
curl -fsS --max-time 20 "$site/api/config" | jq -e . >/dev/null || { echo "$site/api/config does not answer" >&2; status=1; }
# An unauthenticated request must reach each API, rather than being served the SPA fallback.
for path in /api/churches /api/churches/smoke/teams /api/church-invites/join /api/teams/smoke/data /api/teams/smoke/library/songs /api/account/drive/token; do
  response=$(curl -sS --max-time 20 -w $'\n%{http_code}' "$site$path") || { echo "$site$path did not answer" >&2; status=1; continue; }
  code=${response##*$'\n'}
  body=${response%$'\n'*}
  if [ "$code" != 401 ] || ! jq -e '.error | type == "string"' <<<"$body" >/dev/null; then
    echo "$site$path did not return the Worker's sign-in response (HTTP $code)" >&2
    status=1
  fi
done
# A malformed share ID must still reach the existing share handler.
share_status=$(curl -sS --max-time 20 -w $'\n%{http_code}' "$site/api/share/bad") || status=1
if [ "${share_status##*$'\n'}" != 404 ]; then
  echo "$site/api/share/bad did not reach the share handler" >&2
  status=1
fi
[ $status = 0 ] && echo "The live site runs ${expected:0:12} and answers."
exit $status
