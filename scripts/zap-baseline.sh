#!/usr/bin/env bash
# DAST: ZAP's baseline scan of the site (`just zap`, and weekly in CI: .github/workflows/zap.yml;
# docs/CI.md). Passive only: ZAP crawls the site (with a browser too, as it is a single page app)
# and inspects what it is sent (headers, cookies, what pages give away); it sends no attacks, so
# it is safe to point at production. The rules are in .zap/rules.tsv: a FAIL rule that matches
# fails the scan, a WARN one is reported. The report is left in zap-report/.
# ZAP runs from its Docker image, pinned by digest (a newer one: ZAP's own "out of date" warning).
# Usage: scripts/zap-baseline.sh [https://chordless.app]
set -euo pipefail
cd "$(dirname "$0")/.."

IMAGE=ghcr.io/zaproxy/zaproxy@sha256:7840969c7c9fead565bf9734b12f49f6886db90b1d35b1f74d79710bbd081dab # 2.16.1
target=${1:-https://chordless.app}

mkdir -p zap-report
cp .zap/rules.tsv zap-report/rules.tsv
# (ZAP runs as a user of its own, which must be able to write the report)
chmod 777 zap-report

# -j: the browser crawl too; -m 2: two minutes of crawling; -I: warnings alone do not fail
docker run --rm -v "$PWD/zap-report:/zap/wrk:rw" "$IMAGE" \
  zap-baseline.py -t "$target" -c rules.tsv -r report.html -J report.json -j -m 2 -I
