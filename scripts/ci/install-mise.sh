#!/usr/bin/env bash
# Install mise in CI, from its GitHub release, checked against the SHA-256 recorded here (not with a
# third-party action, nor a `curl | sh` installer: docs/CI.md). mise then installs the tools pinned
# in mise.toml, and checks their own checksums.
# To move to a newer mise: take the sums of the five binaries from that release's SHASUMS256.txt
# (gh release download vX -R jdx/mise -p SHASUMS256.txt), choosing a release at least two weeks old.
# Usage: scripts/ci/install-mise.sh <dir to put mise in>
set -euo pipefail

VERSION=2026.10.8
dir=${1:?Usage: $0 <dir>}

case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) platform=linux-x64 sum=c72477ae6c3a8e7d817a322f43da70e4643e75ee5c21265f1c19c894273b7428 ;;
  Linux-aarch64) platform=linux-arm64 sum=6ee0bd8173f1347514f4974d55fb1fae13aa7f6de0a55338adbefa0667cad7e5 ;;
  Darwin-arm64) platform=macos-arm64 sum=dd77de9a7574e38d8409fb06fa85e1581415896639d075987791d8c4e5a57b73 ;;
  Darwin-x86_64) platform=macos-x64 sum=a122fd04db5f2da07d24528ed61109bc82142ca44e821d4faafa05650f6ba627 ;;
  MINGW*-x86_64 | MSYS*-x86_64) platform=windows-x64.exe sum=9147c464c607be2444b4a6f0684dd253ecf0a0ec5d1fe9db639005a8c81fe013 ;;
  *) echo "No mise binary recorded for $(uname -s)-$(uname -m)"; exit 1 ;;
esac

name=mise
[[ $platform == *.exe ]] && name=mise.exe
mkdir -p "$dir"
curl --fail --silent --show-error --location --retry 3 --output "$dir/$name" \
  "https://github.com/jdx/mise/releases/download/v$VERSION/mise-v$VERSION-$platform"

# (from stdin: given a path with a backslash, as on Windows, sha256sum puts one before the sum)
if command -v sha256sum >/dev/null; then
  actual=$(sha256sum <"$dir/$name" | cut -d' ' -f1)
else
  actual=$(shasum -a 256 <"$dir/$name" | cut -d' ' -f1)
fi
if [ "$actual" != "$sum" ]; then
  rm -f "$dir/$name"
  echo "mise $VERSION ($platform): SHA-256 $actual, expected $sum"
  exit 1
fi
chmod +x "$dir/$name"
echo "mise $VERSION installed in $dir"
