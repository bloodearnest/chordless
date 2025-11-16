#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

CERT_NAME="setalight-dev"
SYSTEM_CERT="/usr/local/share/ca-certificates/${CERT_NAME}.crt"
CERT_PATH="$REPO_ROOT/certs/dev.crt"
KEY_PATH="$REPO_ROOT/certs/dev.key"
NSS_DB="${HOME}/.pki/nssdb"

echo "Removing certificate from system trust store (sudo may prompt)..."
if [[ -f "$SYSTEM_CERT" ]]; then
  sudo rm -f "$SYSTEM_CERT"
  sudo update-ca-certificates
  echo "✓ Removed from OS trust store"
else
  echo "System trust store entry not found; skipping."
fi

echo "Removing certificate from Chrome/Chromium trust store..."
if command -v certutil >/dev/null 2>&1 && [[ -f "$NSS_DB/cert9.db" ]]; then
  PW_FILE="$(mktemp)"
  printf "\n" > "$PW_FILE"
  certutil -d "sql:$NSS_DB" -D -n "$CERT_NAME" -f "$PW_FILE" >/dev/null 2>&1 || true
  rm -f "$PW_FILE"
  echo "✓ Chrome/Chromium trust store cleaned up"
else
  echo "certutil not available or Chrome NSS DB missing; skipping."
fi

echo "Deleting local certificate and key..."
rm -f "$CERT_PATH" "$KEY_PATH"
rmdir --ignore-fail-on-non-empty "$REPO_ROOT/certs" >/dev/null 2>&1 || true
echo "✓ Local keypair removed"

echo "All done. Restart browsers if they were running."
