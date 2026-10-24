# Infrastructure (Terraform)

The slow-changing setup around the app, captured as code on 2026-10-20 from what was already
there: nothing was created, each resource is imported (`import` blocks). Three stacks, each with its
own state, so a mistake in one cannot touch the other. `google-chordless/` created what it holds;
`cloudflare/` only imported.

| Stack | Holds |
|---|---|
| `cloudflare/` | the Worker's custom domain `chordless.app`, Email Routing (`import@chordless.app` to the Worker), the TXT records we own (SPF, Google site verification), the TLS and HTTPS zone settings |
| `google-dev/` | the DEV project (id `setalight`, named `chordless-dev`; restored from deletion 2026-10-24 and imported): the Drive API, for the OAuth client the local app and the real-Drive suite use, apart from the app's own project so tests cannot use up its quota or touch its users' files. The consent screen and the OAuth client are by hand |
| `google-chordless/` | the app project `chordless-app` (`chordless` was taken), created by Terraform: the Drive, Picker, API Keys and IAM APIs, the Team Key (`team-key`) and Sharing Key (`sharing-key`), the `team-storage` service account; it outputs the project number, the Picker app id. See [docs/CLOUD_MIGRATION.md](../docs/CLOUD_MIGRATION.md) |

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

## State

Local, gitignored (`*.tfstate`, `.terraform/`), kept on the developer's machine. It is cheap to lose:
the `import` blocks rebuild it with one `terraform apply` (which changes nothing when the code matches).
The `.tf` files and `.terraform.lock.hcl` (the provider versions) are in git. If a secret ever has to go
through Terraform, move the state to a remote backend first.
