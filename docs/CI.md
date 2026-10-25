# CI and pull requests

Changes reach `main` through pull requests, checked by GitHub Actions. Each check is a `just` recipe,
so what CI runs can be run, and fixed, locally.

## How a change gets to main

1. Work on a branch (`<agent>/<topic>`, in a worktree of its own when several agents work at once).
   Commit as you go, one logical step per commit.
2. Before asking for review: `git fetch && git rebase origin/main`, then `just ci`, then
   `git push --force-with-lease`. Open the pull request with `gh pr create` (a draft until `just ci`
   passes), using the template.
3. The pull request needs `ci-ok` to pass, on a branch up to date with `main` (GitHub's "Update branch"
   rebases it), and the approvals the ruleset asks for. It is merged with **Rebase and merge**: no
   merge commits, no squash.
4. Deploys are still `just deploy`, by hand.

The rules are in Terraform (`infra/github/`), and no one bypasses them, the owner included. To get out
of a CI that cannot pass, set the ruleset's `enforcement = "disabled"` there and apply.

"Rebase and merge" gives the commits new SHAs on `main`, so `docs/test-catches.jsonl` names a fix by its pull request (`"#42"`), and
`docs/stats.jsonl` records each run's tree as well as its commit (the trees are the same on `main`).

## The checks (`.github/workflows/ci.yml`)

| Job | Runs on | Recipe | Waits for |
|---|---|---|---|
| Lint | Linux | `just lint` (Biome, tsc, knip, wrangler, Terraform, actionlint, zizmor) | - |
| Node tests | Linux | `just test-node` | - |
| Unit tests | Linux, Chromium | `just test-unit` | - |
| Coverage | Linux | `just coverage-check`, on the two runs' reports | node, unit |
| End to end | Linux, Chromium | `just test-e2e chromium` | - |
| End to end | macOS, WebKit | `just test-e2e webkit` | - |
| End to end | Windows, Chrome | `just test-e2e chrome` | - |
| Terraform | Linux | `just lint-infra` | only when `infra/` changed |
| `ci-ok` | | every job above passed or was skipped | all |

`ci-ok` is the one required check, so jobs can be renamed, split or skipped without touching the
ruleset. The macOS and Windows jobs are new to CI: they show their result, but `ci-ok` does not wait for
them and they are `continue-on-error`. Make them required (add `e2e` to `ci-ok`'s `needs`, drop
`continue-on-error`) once they have been green for a while.

`just ci` runs the Linux jobs' checks in order, and fails if they changed any file. CI never writes to
the repository: it does not retake the Help pictures (fonts differ between machines), record stats or
lower the coverage floor; `just test` still does all three locally.

The end-to-end jobs run three Playwright workers (`CHORDLESS_WORKERS`); with two, the tests took
3.8 minutes on macOS and 4.2 on Windows (2026-10-25). Locally it is one for every two processors.

On a failure, the end-to-end jobs keep the Playwright report and traces as an artifact for a week, and
the failing tests are marked on the pull request's diff.

## Actions, and why so few

Workflows use only GitHub's own actions (`actions/*`), each pinned to a full commit SHA with its
version in a comment. Everything else is a script in `scripts/` or `scripts/ci/`: a third-party action
runs with the job's token and secrets, and a SHA pin alone does not prove the commit is one its
authors published (a fork's commit can be reached through the parent repository's name). So:

- GitHub refuses any action that is not GitHub's own or not pinned by SHA (`infra/github/`).
- `just lint-actions` runs actionlint (with shellcheck on `run:` steps) and zizmor, whose
  `impostor-commit` audit checks each pinned SHA is on a branch or tag of the action's own repository,
  and whose other audits catch template injection, broad permissions, credentials left in a checkout
  and cache poisoning.
- Dependabot proposes new versions (new SHAs) weekly, a week after their release.

To use a third-party action anyway: ask first, say what it does that a script cannot, pin it, add its
repository to `patterns_allowed` in `infra/github/main.tf`, and `just lint-actions` must pass.

Every workflow starts with `permissions: {}` and each job asks for what it needs (`contents: read`);
checkouts keep no credentials; every job has a timeout. Pull requests run with no secrets.

## Tools

mise installs the tools at the versions in `mise.toml` (node, just, actionlint, zizmor, shellcheck,
terraform). CI installs mise itself from its release, checked against the SHA-256 in
`scripts/ci/install-mise.sh` (`scripts/ci/setup-tools.sh`), and each job installs only the tools it
uses. The end-to-end jobs write a `.dev.vars` of made-up values (`scripts/ci/fake-dev-vars.sh`).

## Caches

`.github/actions/setup` restores, and `.github/actions/save-cache` saves:

| Cache | Key |
|---|---|
| mise's tools | the OS, the tools, `mise.toml` |
| `node_modules` | the OS, `mise.toml` (Node's version), `package-lock.json` |
| npm's downloads | the OS, `package-lock.json` (or the newest older one) |
| Playwright's browser | the OS, the browser, `package-lock.json` |

`node_modules` can be cached whole because no install script runs (`.npmrc`): it depends on nothing
but the key. On a hit, `npm ci` is skipped.

A pull request can read `main`'s caches but not save any, and `main` never reads a pull request's, so
nothing a pull request does can end up in what `main` builds. Caches are saved on `main` only, by one
job per key: unit tests (Linux packages, Chromium), lint (its tools), and the macOS and Windows jobs
(their own). A weekly run of CI on `main` keeps them from expiring (GitHub drops a cache unused for a
week). The deploy job uses no cache at all.

## Next

Still to come, each in a pull request of its own: every Terraform stack's state moved to R2; deploys
from `main`, smoke tested and rolled back on failure; and a nightly check of the Terraform stacks for
drift.
