#!/bin/bash
# Push secrets from .dev.vars to Cloudflare Workers
# Usage: ./push-secrets.sh

set -e

if [ ! -f .dev.vars ]; then
  echo "Error: .dev.vars not found"
  exit 1
fi

export $(grep -v '^#' .dev.vars | xargs)

if [ -z "$JWE_ENCRYPTION_KEY" ] || [ -z "$GOOGLE_CLIENT_ID" ] || [ -z "$GOOGLE_CLIENT_SECRET" ]; then
  echo "Error: Missing required variables in .dev.vars"
  exit 1
fi

echo "Pushing secrets to Cloudflare Workers..."
echo "$JWE_ENCRYPTION_KEY"   | npx wrangler secret put JWE_ENCRYPTION_KEY
echo "$GOOGLE_CLIENT_ID"     | npx wrangler secret put GOOGLE_CLIENT_ID
echo "$GOOGLE_CLIENT_SECRET" | npx wrangler secret put GOOGLE_CLIENT_SECRET

echo "Done."
