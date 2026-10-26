#!/usr/bin/env bash
# The development server for trying live sync (docs/LIVE_SYNC.md): `just serve-live`.
#
# `just serve` (Vite with the Cloudflare plugin) runs the Worker inside Vite, which cannot pass a
# WebSocket upgrade to it. So here the Worker is `wrangler dev` in a process of its own, and Vite,
# on the same port as ever (8787: the origin the browser's data and sign-in belong to), hands it
# the paths it answers, upgrades included. Use `just serve` for everything else: it is one process.
set -euo pipefail

worker_port=${CHORDLESS_WORKER_PORT:-8789}
worker="http://localhost:${worker_port}"

# wrangler's own process, not npx's, so that stopping it stops the Worker's runtime with it
node_modules/.bin/wrangler dev --env dev --port "$worker_port" &
wrangler=$!
trap 'kill "$wrangler" 2>/dev/null || true' EXIT

echo "Waiting for the Worker on ${worker}..."
for _ in $(seq 1 60); do
  if curl -sf -o /dev/null "${worker}/api/config"; then break; fi
  if ! kill -0 "$wrangler" 2>/dev/null; then
    echo "The Worker did not start." >&2
    exit 1
  fi
  sleep 1
done

CHORDLESS_WORKER_URL="$worker" npm run dev
