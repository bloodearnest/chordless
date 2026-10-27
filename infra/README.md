# Infrastructure (Terraform)

The slow-changing setup around the app, captured as code on 2026-10-20 from what was already
there: nothing was created, each resource is imported (`import` blocks). Four stacks, each with its
own state, so a mistake in one cannot touch another. (Five now: `google-ci/` is below.) `google-chordless/` created what it holds;
`cloudflare/` and `github/` (added 2026-10-25) only imported.

| Stack | Holds |
|---|---|
| `cloudflare/` | the R2 bucket that holds every stack's state, the Worker's custom domain `chordless.app`, Email Routing (`import@chordless.app` to the Worker), the TXT records we own (SPF, Google site verification), the TLS and HTTPS zone settings |
| `google-dev/` | the DEV project (`chordless-dev`, created here; the first project, `setalight`, was left behind): the Drive API, for the OAuth client the local app and the real-Drive suite use, apart from the app's own project so tests cannot use up its quota or touch its users' files. The consent screen and the OAuth client are by hand |
| `google-chordless/` | the app project `chordless-app` (`chordless` was taken), created by Terraform: the Drive, Picker, API Keys and IAM APIs, the Team Key (`team-key`) and Sharing Key (`sharing-key`), the `team-storage` service account; it outputs the project number, the Picker app id. See [docs/CLOUD_MIGRATION.md](../docs/CLOUD_MIGRATION.md) |
| `google-ci/` | how CI signs in to Google: a Workload Identity pool and a GitHub OIDC provider in `chordless-app`, restricted to this repository's jobs on `main`, and two service accounts, `ci-plan` (the `infra` environment: reads both projects) and `ci-apply` (`infra-apply`: enables APIs and manages API keys in both, and the app project's service accounts). **Never in CI**: planned and applied by hand, so a change to what CI runs can never widen what CI may do |
| `github/` | the GitHub repository's settings (imported): merge by rebase only, the `main` ruleset (a pull request, `ci-ok` passing, linear history), what Actions may run (GitHub's own actions, pinned by SHA), the workflow token's permissions, the `production` and `infra` environments. See [docs/CI.md](../docs/CI.md) |

## Who owns what

- **Terraform:** the above. Zone and account facts that change rarely.
- **Wrangler** (`wrangler.toml`, `just deploy`): the Worker's code, assets, bindings, rate limiters,
  `workers_dev`/`preview_urls`, and the secrets (`wrangler secret put NAME`). Never in Terraform: two tools
  would fight over one object, and Cloudflare's own guidance keeps the two complementary.
- **By hand:** the OAuth consent screen and web client (the provider cannot manage them), service
  account keys and API key values (they would land in the state file), adding the service account to a
  team's shared drive.
- `wrangler.toml` has no `routes`, so `workers_dev` and `preview_urls` are set to `false` there on
  purpose: otherwise wrangler turns on a second public address.
- A fresh Cloudflare account needs `wrangler deploy` first (the Worker must exist), then
  `terraform apply` in `cloudflare/` to attach the domain.

## Running it

`terraform` and `gcloud` are pinned in `mise.toml` (`mise install`). Inside a stack directory:

    # cloudflare/  (a custom API token, not the wrangler login: Workers Scripts, Workers Routes,
    #               DNS, Zone Settings, Zone, Email Routing Rules; limited to chordless.app)
    CLOUDFLARE_API_TOKEN=... mise exec -- terraform plan

    # google-chordless/ (the same)
    gcloud auth login
    GOOGLE_OAUTH_ACCESS_TOKEN=$(gcloud auth print-access-token) mise exec -- terraform plan

`plan` should say "No changes" (in `google-chordless/` too: `terraform output project_number` is the Picker app id). If it does not, someone changed something in a console: either put
the change in the code or revert it. Prefer a short-lived token, limited to this machine's IP, and delete it after.

## Checks

`just lint` runs `terraform fmt -check` and `validate` on every stack (`scripts/infra-check.sh lint`: no
credentials). `just deploy` runs `just predeploy` first: `scripts/infra-check.sh drift` (each stack's plan must
say "No changes") and a check that the production Worker has its secrets (docs/ENVIRONMENTS.md).

## In CI

`.github/workflows/terraform.yml` plans a change to `infra/` once it is on `main`, and applies it after
the owner approves (docs/CI.md). For the `github` and `cloudflare` stacks; the Google ones need Workload Identity Federation first.

Its credentials are secrets of two GitHub environments, set by hand, never by Terraform: a secret's
value in the state could be read with the plan job's read-only key, which would undo the separation.

| Environment | Secret | What |
|---|---|---|
| `infra` (plans, drift) | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | an R2 token, Object Read, this bucket only |
| | `CLOUDFLARE_API_TOKEN` | for the `cloudflare` stack: read of Workers Scripts, R2 Storage, Workers Routes, DNS, Zone Settings, Zone and Email Routing Rules, on this account and the chordless.app zone |
| | `GH_TERRAFORM_TOKEN` | a fine-grained token, this repository only: Administration and Environments, read |
| `infra-apply` (applies, after approval) | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | an R2 token, Object Read & Write, this bucket only |
| | `CLOUDFLARE_API_TOKEN` | the same, with edit |
| | `GH_TERRAFORM_TOKEN` | the same, with read and write |

Neither GitHub token needs Contents: write, though GitHub's REST API shows the repository's merge
settings (which merge buttons, auto-merge, deleting a merged branch) only to a token that can push.
`infra/github` sets them when the repository is created and otherwise leaves them to a `check`, which
reads them over GraphQL (`infra/github/merge-settings.sh`, which a read-only token can) and fails the
drift check when they are not the code's. Changing one is done in GitHub, then in `main.tf`.

Each of those two environments also has the variables `R2_TOKEN_EXPIRES` and `CLOUDFLARE_TOKEN_EXPIRES`. `just check-gh-secrets` checks all are there.

**The deploy token** (`production` environment, not Terraform's): `CLOUDFLARE_API_TOKEN` is an account
API token with Workers Scripts: Edit on this account and nothing else, and the variable
`CLOUDFLARE_ACCOUNT_ID` is the account's id. Set with `gh secret set CLOUDFLARE_API_TOKEN --env production`
and `gh variable set CLOUDFLARE_ACCOUNT_ID --env production`. It has no expiry check yet; give it a
year and put the date in the account token's name. A deploy (`docs/CI.md`) is how the Worker gets
updated: Terraform never deploys it.

**The Cloudflare tokens** (the R2 ones and `CLOUDFLARE_API_TOKEN`) are the account's (Account API Tokens),
made by `scripts/ci-tokens.sh create` (one that exists is left alone), which puts each straight into its
environment without showing it. It needs a throwaway account token that
can make tokens (Account API Tokens: Edit, your IP only, at most a day), bare in `.cloudflare-bootstrap-token`
(git-ignored; the primary checkout's, from a worktree too). `scripts/ci-tokens.sh bootstrap` opens the
dashboard for it, takes the pasted value without showing it, checks it and then runs `create` (or
`bootstrap rotate`). Delete the token in the dashboard after, and the file. Cloudflare has no browser
login that can make tokens (`wrangler login` has no scope for it).

**The GitHub tokens** can only be made in GitHub's settings (Fine-grained tokens): resource owner the
repository's, only this repository, the permissions above (Metadata is always on). Set each from a
terminal of your own, which prompts for it (not `!` in Claude Code, which has no terminal):

    gh secret set GH_TERRAFORM_TOKEN --env infra --repo bloodearnest/chordless

**Expiry and rotation.** They run out a year from when they were made (the R2 ones on 2027-10-25), so
they are rotated together. The Terraform jobs warn 30 days before and fail 7 days
before. To rotate: `scripts/ci-tokens.sh rotate` (Cloudflare rolls each Cloudflare token: the same token, a new
secret), and "Regenerate token" on each GitHub one, then `gh secret set` it again. Rotate at once,
whatever the date, if one may have leaked.

## State

In Cloudflare R2, the bucket `chordless-tfstate` (one key per stack), through Terraform's `s3`
backend, with a lock file next to each state (`use_lockfile`), so two runs cannot apply at once and CI
can check for drift. Access is an R2 API token limited to that bucket (Object Read & Write), whose S3
credentials go in the git-ignored `.r2-tfstate.env`:

    AWS_ACCESS_KEY_ID=...
    AWS_SECRET_ACCESS_KEY=...

Or, simpler locally, a Cloudflare API token that can use R2 (Workers R2 Storage: Edit) is its own S3
credential: the key id is the token's id (`GET /user/tokens/verify`), and the secret is the SHA-256 of
the token. `scripts/infra-check.sh drift` makes them from `CLOUDFLARE_API_TOKEN` when neither is set, so
the cloudflare stack's token is all it needs. By hand: `set -a; . ./.r2-tfstate.env; set +a` first. In CI the
same two are secrets of the `infra` environment. R2 keeps no old versions, but the state is cheap to lose:
the `import` blocks rebuild it with one `terraform apply` (which changes nothing when the code matches).
Secret values still stay out of Terraform. The `.tf` files and `.terraform.lock.hcl` (the provider
versions) are in git; `*.tfstate` and `.terraform/` are ignored.

The bucket is in `cloudflare/`, whose own state it holds, so that stack made it while its state was
still local (its `backend` block set aside, `terraform apply`), then moved its state in with
`terraform init -migrate-state`, as each of the others did. On a fresh account, do the same.

The `cloudflare/` stack's token (`CLOUDFLARE_API_TOKEN`) also needs Workers R2 Storage: Edit, for the
bucket. Locally it is the one in the git-ignored `.cloudflare-token` (bare, as `just deploy` reads it).

## The Google stacks in CI

Nothing is stored: `scripts/ci/google-auth.sh` trades the job's GitHub OIDC token (it needs
`id-token: write`) for the access token of `ci-plan` (in `infra`) or `ci-apply` (in `infra-apply`)
through the pool in `google-ci/`. The pool admits only this repository's jobs on `main` that run in
those two environments, one account each.

**Bootstrap, once** (and when `google-ci/` changes), by hand, as someone who owns both projects:

    gcloud auth login
    cd infra/google-ci
    GOOGLE_OAUTH_ACCESS_TOKEN=$(gcloud auth print-access-token) mise exec -- terraform init
    GOOGLE_OAUTH_ACCESS_TOKEN=$(gcloud auth print-access-token) mise exec -- terraform apply

`terraform output` then names the provider and the two service accounts, which `scripts/ci/google-auth.sh`
has (they are not secret). The apply account cannot change the project itself, IAM or the federation:
those stay by hand. It can enable APIs, manage API keys and the app project's service accounts, which
is all `google-chordless/` and `google-dev/` hold.

## The GitHub stack

`GITHUB_TOKEN=$(gh auth token) mise exec -- terraform plan` in `github/`. Its token needs admin on the
repository (the gh login has it); CI's drift check uses a fine-grained token with Administration: read.
Not managed, as the provider cannot: secret values (`gh secret set NAME --env production`), the Claude
GitHub app's install, and the approval GitHub asks for before a fork's first pull request runs workflows
(its default, "first-time contributors").
