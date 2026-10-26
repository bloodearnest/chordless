#!/usr/bin/env bash
# Terraform in CI (.github/workflows/terraform.yml; docs/CI.md). The state is in R2 (infra/README.md);
# the credentials come from the job's environment.
#   plan [<base sha>]  plan each stack CI looks after that changed since <base> (all, with no base),
#                      without taking the state's lock (the `infra` environment's R2 key only reads);
#                      a plan that changes something is saved in plans/<stack>.tfplan for `apply`, and
#                      shown in the job's summary. Prints changed=true|false (for $GITHUB_OUTPUT)
#   apply              apply the saved plans, exactly (the `infra-apply` environment, after approval)
#   drift              plan every stack CI looks after; fail if any would change (nightly)
set -euo pipefail
cd "$(dirname "$0")/.."

# The stacks CI has credentials for. The others (cloudflare, google-*) join as theirs are made
# (the TODO): until then they are planned and applied by hand, and checked by `just predeploy`.
CI_STACKS=(github)

tf() { mise exec -- terraform "$@"; }
summary() { if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then cat >>"$GITHUB_STEP_SUMMARY"; else cat >/dev/null; fi; }

mode=${1:-}
case "$mode" in
  plan | drift)
    base=${2:-}
    [ "$mode" = drift ] && base=
    mkdir -p plans
    changed=false
    drifted=false
    for stack in "${CI_STACKS[@]}"; do
      if [ -n "$base" ] && git diff --quiet "$base" HEAD -- "infra/$stack"; then
        echo "$stack: not changed since ${base:0:7}" >&2
        continue
      fi
      tf -chdir="infra/$stack" init -input=false -no-color >/dev/null
      set +e
      tf -chdir="infra/$stack" plan -input=false -no-color -lock=false -detailed-exitcode \
        -out="$PWD/plans/$stack.tfplan" >"plans/$stack.txt" 2>&1
      status=$?
      set -e
      # A `check` that fails (infra/github's merge settings) is only a warning to Terraform: drift here
      if [ $status != 1 ] && grep -q "Check block assertion failed" "plans/$stack.txt"; then
        drifted=true
        echo "$stack: a check failed:" >&2
        failure=$(grep -A30 "Check block assertion failed" "plans/$stack.txt" | grep -Ev '^ *([0-9]+:.*)?$')
        echo "$failure" >&2
        { echo "### $stack: a check failed"; echo '```'; echo "$failure"; echo '```'; } | summary
      fi
      case $status in
        0)
          echo "$stack: no changes" >&2
          rm -f "plans/$stack.tfplan"
          ;;
        2)
          changed=true
          echo "$stack: changes:" >&2
          sed -n '/Terraform will perform/,/^Plan:/p' "plans/$stack.txt" >&2
          { echo "### $stack"; echo '```'; sed -n '/Terraform will perform/,/^Plan:/p' "plans/$stack.txt"; echo '```'; } | summary
          ;;
        *)
          cat "plans/$stack.txt" >&2
          echo "$stack: the plan failed" >&2
          exit 1
          ;;
      esac
    done
    if [ "$mode" = drift ] && { [ "$changed" = true ] || [ "$drifted" = true ]; }; then
      echo "Drift: what is real differs from infra/ (see above): put the change in the code, or undo it" >&2
      exit 1
    fi
    echo "changed=$changed"
    ;;
  apply)
    shopt -s nullglob
    for plan in plans/*.tfplan; do
      stack=$(basename "$plan" .tfplan)
      tf -chdir="infra/$stack" init -input=false -no-color >/dev/null
      tf -chdir="infra/$stack" apply -input=false -no-color "$PWD/$plan"
    done
    ;;
  *)
    echo "Usage: $0 plan [<base sha>] | apply | drift"
    exit 2
    ;;
esac
