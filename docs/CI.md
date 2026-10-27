# CI and pull requests

Changes reach `main` through pull requests, checked by GitHub Actions. Each check is a `just` recipe,
so what CI runs can be run, and fixed, locally.

## How a change gets to main

1. Work on a branch (`<agent>/<topic>`, in a worktree of its own when several agents work at once).
   Commit as you go, one logical step per commit.
2. Before asking for review: `git fetch && git rebase origin/main`, then `just ci`, then
   `git push --force-with-lease`. Open the pull request with `gh pr create` (a draft until `just ci`
   passes), using the template.
3. The pull request needs `ci-ok` to pass, CodeQL's findings below the ruleset's thresholds, and the
   approvals the ruleset asks for. It need not be up to date with `main` (that would cost another run of
   CI per merge): the checks on `main` after a merge, which the deploy waits for, catch what slips in. It is merged with **Rebase and merge**: no merge commits, no squash. "Enable auto-merge"
   on a pull request merges it when all that is so.
4. Deploys are `.github/workflows/deploy.yml` (on every push to `main`, and by hand; below), or still `just deploy` from a laptop.

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
ruleset. The macOS and Windows end-to-end jobs are required too (they are in `ci-ok`'s `needs`): they are
slow (4 to 6 minutes against Linux's 2), and what they run is to be trimmed (`TODO`).

`just ci` runs the Linux jobs' checks in order, and fails if they changed any file. CI never writes to
the repository: it does not retake the Help pictures (fonts differ between machines), record stats or
lower the coverage floor; `just test` still does all three locally.

How many Playwright workers each end-to-end job runs is set in `ci.yml` (`CHORDLESS_WORKERS`), from
how long the tests took (2026-10-25): Linux 2.0 minutes with three, 2.4 with two; macOS 3.8 with two,
4.8 with three (it has three processors); Windows 4.2 either way, so three. Locally it is one for
every two processors.

On a failure, the end-to-end jobs keep the Playwright report and traces as an artifact for a week, and
the failing tests are marked on the pull request's diff. Each also lists, in its summary, the tests that
only passed on a retry (`scripts/flaky-summary.ts`, from the JSON report): `retries: 2` keeps one flaky
test from failing a run, and would hide it. Log each in `docs/test-catches.jsonl` (kind `flaky`).

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
passing. ZAP is pinned by its image's digest; Renovate proposes a new one (below), and its "ZAP is out of date" warning also says when to move.

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

One pull request a week (Mondays) of every npm package, action and Terraform provider (each stack in
`infra/`: its versions and `.terraform.lock.hcl`) with a new version, each at least a week old
(`cooldown`); security updates when an alert comes, those at once in one pull request. A merged
provider bump changes `infra/`, so the Terraform workflow plans it and waits for you before any apply; a
plan that fails holds up the next deploy (which plans first) until the bump is reverted. Each
is set to merge itself once its checks pass (`.github/workflows/dependabot-auto-merge.yml`): the same
checks as any pull request, with `just audit` among them.

## Renovate (`.github/renovate.json5`)

Dependabot has no support for mise, or for an image pinned by digest in a script, so
[Renovate](https://docs.renovatebot.com/modules/manager/mise/) keeps those up to date: the tools pinned
in `mise.toml`, and ZAP's image in `scripts/zap-baseline.sh` (a regex manager reads the digest and the tag
in its comment). Only those (`enabledManagers`): npm, actions and Terraform providers stay Dependabot's,
so the two never propose the same change. We are trying Renovate on these two before deciding whether
it should do it all. It is the hosted Mend Renovate
app, installed on this repository by hand (github.com/apps/renovate): the config is the only thing in the
repository, and the app has no secret of ours. It is a third party that can push branches, but a
pull request from it goes through the same checks as any other, and `main` is protected by the ruleset.

The rules are Dependabot's: one pull request a week (Mondays, before 7, London time) of every tool with
a new version at least a week old, merged by itself once its checks pass (GitHub's auto-merge, by
rebase). A major version is its own pull request and is not merged by itself: Node 22 to 24 is a
decision. (gcloud numbers every release a major, so it is exempt.) ZAP's is its own pull request, never
merged by itself: a new ZAP can make the weekly scan fail, which no pull request's checks show.

Not covered: mise itself, which CI installs from `scripts/ci/install-mise.sh`, pinned with a SHA-256 for
each platform; a new version needs new hashes.

## Terraform (`.github/workflows/terraform.yml`)

Every push to `main` plans every stack and, if anything differs, applies it once you approve, as the
first part of the deploy (`deploy.yml`, below; both workflows use the same steps, `scripts/terraform-ci.sh`).
`terraform.yml` is the nightly drift check and a manual run. In each:

1. **Plan**, in the `infra` environment, with credentials that can only read (an R2 key that reads
   the state, so the plan takes no lock; a GitHub token that reads the repository's settings). The plan
   is in the run's summary.
2. **Apply**, in the `infra-apply` environment, which waits for your approval: read the plan, then
   approve, and exactly that plan is applied, with credentials that can write.

Nightly, every stack is planned, and the run fails if any would change: something was changed outside
the code (a console, a dashboard). Put it in the code, or undo it.

Pull requests run none of it: they have no secrets. The `github`, `cloudflare` and two Google stacks are in CI; `google-ci`, which says what CI may do to
Google, is planned and applied by hand (`infra/README.md`). Google is signed in to with no stored key: Workload Identity
Federation, `scripts/ci/google-auth.sh`. Each run
also checks its credentials' expiry (`scripts/ci/check-expiry.sh`): a warning 30 days before, a failure
7 days before, so the nightly run says so in time. The credentials, and rotating them:
`infra/README.md`.

## Deploys (`.github/workflows/deploy.yml`)

One run, in order, so a deploy never runs before what it depends on:

1. **CI** (`ci.yml`) on the commit.
2. **Infrastructure** (the plan and apply jobs of `terraform.yml`, repeated in `deploy.yml` with the same
   steps, in `.github/actions/terraform-plan` and `-apply`): every stack CI looks after is planned, and applied after
   the owner approves if anything differs. A rejected or failed apply stops the deploy; nothing
   differing is a pass. (Every stack, not those a push changed: a run that a newer one superseded
   would lose its change otherwise.) Additive infrastructure goes first, which is the order a deploy
   needs. To remove something, deploy the code that stops using it, then remove it in a second pull request.
3. **Build**, in a job with no secrets: `vite build`, and `scripts/build-hash.ts`, a hash of everything
   shipped (the build is reproducible: the same hash from any checkout), written to `/version.json`.
4. **Deploy**, in the `production` environment (main only), the one job with the Cloudflare token. It
   skips itself when the commit is not the newest on `main`, or when the live `/version.json` already
   has this build's hash (`force` overrides); the live site is asked, not a record kept, so a failed or
   rolled back deploy is tried again. Otherwise: the Worker's secrets are checked
   (`check-prod-secrets.ts`), `wrangler deploy` runs from the built artifact, `scripts/ci/smoke.sh` waits
   for the site to run that hash and answer, and on failure `wrangler rollback` puts the previous version
   back (Durable Object migrations only add, so they stay).

The jobs are repeated, not called: a called workflow did not get the secrets of an
environment its caller's job would need (the first run showed `GH_TERRAFORM_TOKEN` empty in a called
workflow): the environment is on the job, and the secrets go into the shared steps as inputs. The
apply jobs share the `terraform` concurrency group, so two never run at once.

**When it runs.** On every push to `main`; every morning but Sunday (Monday to Saturday, 07:30 UTC), to
deploy what a push did not (a merge made with a workflow's token, as Dependabot's auto-merge is, starts no
workflow; not Saturday night or Sunday, when the app is used most); and by hand. The scheduled run does not plan the
infrastructure: the nightly drift check (`terraform.yml`) does. A manual run can also skip it
(`skip_infra`): to ship a fix while a plan is failing (a provider bump that no longer plans holds up
every other deploy, which plans first). Whatever the infrastructure needs is then not applied, so
the change it was held for waits for the next run.

Each deploy is listed against the `production` environment, with the live address, in the repository's
Deployments.

Deploys run in a `deploy` concurrency group, none cancelled; a run waiting is replaced by a newer one.
It is also the only place `main`'s own checks run after a
merge (`ci.yml` has no push trigger): a pull request need not be up to date with `main`, and this is what
catches two that were each fine and are not together. A merge that changes nothing shipped (docs, TODO) runs
the checks and the plan, and deploys nothing. `terraform.yml` has the nightly drift check and a manual run;
a change to `infra/` is planned and applied here, before the deploy. `just deploy` from a laptop still
checks for drift first.

The `production` environment's credentials: `CLOUDFLARE_API_TOKEN` (secret; an account API token,
Workers Scripts: Edit on this account, nothing else) and `CLOUDFLARE_ACCOUNT_ID` (variable). They are not
the Terraform tokens. The Worker's own secrets stay in Cloudflare (`wrangler secret put`): a deploy
leaves them alone and the job never sees them.

## Next

Still to come: the `cloudflare` and Google stacks in CI; deploys on every merge.
