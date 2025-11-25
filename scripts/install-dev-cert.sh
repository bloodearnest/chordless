#!/usr/bin/env bash
set -euo pipefail
CERT_SOURCE="certs/dev.crt"
DEST="/usr/local/share/ca-certificates/chordless-dev.crt"
if [ ! -f "$CERT_SOURCE" ]; then
  echo "Certificate $CERT_SOURCE not found; run scripts/generate-dev-cert.sh first." >&2
  exit 1
fi
if [ "$EUID" -ne 0 ]; then
  echo "This script must be run with sudo." >&2
  exit 1
fi
cp "$CERT_SOURCE" "$DEST"
update-ca-certificates
