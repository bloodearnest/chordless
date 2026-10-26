# CI and pull requests

Changes reach `main` through pull requests, checked by GitHub Actions. Each check is a `just` recipe,
so what CI runs can be run, and fixed, locally.

## How a change gets to main

1. Work on a branch (`<agent>/<topic>`, in a worktree of its own when several agents work at once).
   Commit as you go, one logical step per commit.
2. Before asking for review: `git fetch && git rebase origin/main`, then `just ci`, then
   `git push --force-with-lease`. Open the pull request with `gh pr create` (a draft until `just ci`
   passes), using the template.
3. The pull request needs `ci-ok` to pass, CodeQL's findings below the ruleset's thresholds, a
   branch up to date with `main` (GitHub's "Update branch" rebases it), and the approvals the ruleset
   asks for. It is merged with **Rebase and merge**: no merge commits, no squash. "Enable auto-merge"
   on a pull request merges it when all that is so.
4. Deploys are still `just deploy`, by hand.

The rules are in Terraform (`infra/github/`), and no one bypasses them, the owner included. To get out
of a CI that cannot pass, set the ruleset's `enforcement = "disabled"` there and apply.

"Rebase and merge" gives the commits new SHAs on `main`, so `docs/test-catches.jsonl` names a fix by
its pull request (`"#42"`), and `docs/stats.jsonl` records each run's tree as well as its commit (the trees are the same on `main`).

## The checks (`.github/workflows/ci.yml`)

| Job | Runs on | Recipe | Waits for |
|---|---|---|---|
| Lint | Linux | `just lint` (Biome, tsc, knip, wrangler, Terraform, actionlint, zizmor, `just audit`) | - |
| Node tests | Linux | `just test-node` | - |
| Unit tests | Linux, Chromium | `just test-unit` | - |
| Coverage | Linux | `just coverage-check`, on the two runs' reports | node, unit |
| End to end | Linux, Chromium | `just test-e2e chromium` | - |
| End to end | macOS, WebKit | `just test-e2e webkit` | - |
| End to end | Windows, Edge | `just test-e2e msedge` | - |
| Terraform | Linux | `just lint-infra` | only when `infra/` changed |
| `ci-ok` | | every job above passed or was skipped | all |

`ci-ok` is the one required check, so jobs can be renamed, split or skipped without touching the
ruleset. The macOS and Windows jobs are new to CI: they show their result, but `ci-ok` does not wait for
them and they are `continue-on-error`. Make them required (add `e2e` to `ci-ok`'s `needs`, drop
`continue-on-error`) once they have been green for a while.

`just ci` runs the Linux jobs' checks in order, and fails if they changed any file. CI never writes to
the repository: it does not retake the Help pictures (fonts differ between machines), record stats or
lower the coverage floor; `just test` still does all three locally.

How many Playwright workers each end-to-end job runs is set in `ci.yml` (`CHORDLESS_WORKERS`), from
how long the tests took (2026-10-25): Linux 2.0 minutes with three, 2.4 with two; macOS 3.8 with two,
4.8 with three (it has three processors); Windows 4.2 either way, so three. Locally it is one for
every two processors.

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

The npm packages get the same care (`just audit`, `scripts/audit-deps.sh`): each must come from the
npm registry with a sha512 hash (`scripts/check-lockfile.sh`, so a lockfile change cannot point one at a
tarball elsewhere), must carry the registry's signature (and its provenance, where it publishes one), and no production dependency may
have a known high or critical advisory. The dev tools' advisories are listed without failing: they
never reach users, and one with no fix yet would otherwise block every change.

To use a third-party action anyway: ask first, say what it does that a script cannot, pin it, add its
repository to `patterns_allowed` in `infra/github/main.tf`, and `just lint-actions` must pass.

Every workflow starts with `permissions: {}` and each job asks for what it needs (`contents: read`);
checkouts keep no credentials; every job has a timeout. Pull requests run with no secrets.

## SAST (`.github/workflows/codeql.yml`)

CodeQL analyses the app's and the Worker's code on every pull request, on `main` (which a pull
request's findings are compared with) and weekly. It is GitHub's own action, pinned like the others.
What it checks is `.github/codeql/codeql-config.yml`: CodeQL's default (high-precision) suite, and not
the tests, the dev playgrounds or the build scripts. Its findings block a merge at the thresholds of
the `main` ruleset's code scanning rule (`infra/github`): a security finding of high severity or more,
or any other at error level. Below those they are shown, and do not block.

When it is wrong: dismiss a single finding in the repository's Security tab, with the reason (a
dismissed finding no longer blocks); when one query is wrong again and again, turn it off in the
config's `query-filters`, with the reason.

## DAST (`.github/workflows/zap.yml`)

Weekly, ZAP's baseline scan of chordless.app (`scripts/zap-baseline.sh`, `just zap` locally, with
Docker): passive only, so it crawls the site, with a browser too, and inspects what it is sent
(headers, cookies, what pages give away), sending no attacks. Each of its rules is WARN, FAIL or
IGNORE in `.zap/rules.tsv`: a FAIL fails the run (GitHub emails about a failed scheduled run), and the
report is kept as an artifact for a month. When the site passes a rule, make it FAIL, so it keeps
passing. ZAP is pinned by its image's digest; its "ZAP is out of date" warning says when to move it.

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

## Dependabot (`.github/dependabot.yml`)

One pull request a week (Mondays) of every npm package and action with a new version, each at least a
week old (`cooldown`); security updates when an alert comes, those at once in one pull request. Each
is set to merge itself once its checks pass (`.github/workflows/dependabot-auto-merge.yml`): the same
checks as any pull request, with `just audit` among them.

## Terraform (`.github/workflows/terraform.yml`)

A change to `infra/` that reaches `main` is planned and, once you approve, applied
(`scripts/terraform-ci.sh`):

1. **Plan**, in the `infra` environment, with credentials that can only read (an R2 key that reads
   the state, so the plan takes no lock; a GitHub token that reads the repository's settings). The plan
   is in the run's summary.
2. **Apply**, in the `infra-apply` environment, which waits for your approval: read the plan, then
   approve, and exactly that plan is applied, with credentials that can write.

Nightly, every stack is planned, and the run fails if any would change: something was changed outside
the code (a console, a dashboard). Put it in the code, or undo it.

Pull requests run none of it: they have no secrets. Only the `github` stack is in CI so far; the
others are planned and applied by hand (`infra/README.md`) until their credentials are made. Each run
also checks its credentials' expiry (`scripts/ci/check-expiry.sh`): a warning 30 days before, a failure
7 days before, so the nightly run says so in time. The credentials, and rotating them:
`infra/README.md`.

## Next

Still to come: deploys from `main` (the build in a job with no secrets, deployed only when it changed,
then smoke tested and rolled back on failure); the `cloudflare` and Google stacks in CI.
