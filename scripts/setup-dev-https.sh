#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

CERT_DIR="$REPO_ROOT/certs"
CERT_PATH="$CERT_DIR/dev.crt"
KEY_PATH="$CERT_DIR/dev.key"
CERT_NAME="setalight-dev"
SYSTEM_CERT="/usr/local/share/ca-certificates/${CERT_NAME}.crt"
NSS_DB="${HOME}/.pki/nssdb"

if [[ -f "$CERT_PATH" && -f "$KEY_PATH" ]]; then
  echo "Certificate already exists at $CERT_PATH - skipping generation."
else
  echo "Generating self-signed certificate for https://localhost:8443..."
  mkdir -p "$CERT_DIR"
  openssl req -x509 -nodes -newkey rsa:4096 -sha256 -days 365 \
    -keyout "$KEY_PATH" -out "$CERT_PATH" \
    -subj "/CN=localhost" \
    -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
  echo "✓ Generated $CERT_PATH and $KEY_PATH"
fi

echo "Installing certificate into system trust store (sudo may prompt)..."
sudo install -m 0644 "$CERT_PATH" "$SYSTEM_CERT"
sudo update-ca-certificates
echo "✓ OS trust store updated"

echo "Importing certificate into Chrome/Chromium trust store..."
if command -v certutil >/dev/null 2>&1; then
  mkdir -p "$NSS_DB"
  if [[ ! -f "$NSS_DB/cert9.db" ]]; then
    certutil -d "sql:$NSS_DB" -N --empty-password
  fi
  PW_FILE="$(mktemp)"
  printf "\n" > "$PW_FILE"
  certutil -d "sql:$NSS_DB" -D -n "$CERT_NAME" -f "$PW_FILE" >/dev/null 2>&1 || true
  certutil -d "sql:$NSS_DB" -A -t "C,," -n "$CERT_NAME" -i "$CERT_PATH" -f "$PW_FILE"
  rm -f "$PW_FILE"
  echo "✓ Chrome/Chromium trust store updated"
else
  echo "certutil not found; install libnss3-tools to trust Chrome/Chromium." >&2
fi

echo "All done. Restart any open browsers so they pick up the refreshed certificates."
