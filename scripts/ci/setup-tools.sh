#!/usr/bin/env bash
# Put the tools a CI job needs on its PATH: mise (scripts/ci/install-mise.sh), then the given tools
# at the versions mise.toml pins (a job installs only its own: never gcloud). Locally, `mise install`.
# Usage: scripts/ci/setup-tools.sh <tool>...
set -euo pipefail
cd "$(dirname "$0")/../.."

bin="${RUNNER_TEMP:?not in CI: run mise install}/mise-bin"
scripts/ci/install-mise.sh "$bin"
echo "$bin" >>"$GITHUB_PATH"
PATH="$bin:$PATH"

# Where mise keeps the tools, named so the cache step knows it (.github/actions/setup)
case "$(uname -s)" in
  MINGW* | MSYS*) MISE_DATA_DIR=$(cygpath -w "$HOME/AppData/Local/mise") ;;
  *) MISE_DATA_DIR="$HOME/.local/share/mise" ;;
esac
export MISE_DATA_DIR
echo "MISE_DATA_DIR=$MISE_DATA_DIR" >>"$GITHUB_ENV"

mise install "$@"
# Each tool's own directory, rather than mise's shims, which differ on Windows
mise bin-paths "$@" >>"$GITHUB_PATH"
