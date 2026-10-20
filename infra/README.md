# Infrastructure (Terraform)

The slow-changing setup around the app, captured as code on 2026-10-20 from what was already
there: nothing was created, each resource is imported (`import` blocks). Two stacks, each with its
own state, so a mistake in one cannot touch the other.

| Stack | Holds |
|---|---|
| `cloudflare/` | the Worker's custom domain `chordless.app`, Email Routing (`import@chordless.app` to the Worker), the TXT records we own (SPF, Google site verification), the TLS and HTTPS zone settings |
| `google/` | the `setalight` project, the Drive and Picker APIs, the Team Key (Picker, from our origins) and Sharing Key (Drive only; the Worker's `GOOGLE_API_KEY`), the `broker` service account; the 17 default APIs (BigQuery, Cloud Storage, ...) are switched off by a `removed` block |

## Who owns what

- **Terraform:** the above. Zone and account facts that change rarely.
- **Wrangler** (`wrangler.toml`, `just deploy`): the Worker's code, assets, bindings, rate limiters,
  `workers_dev`/`preview_urls`, and the secrets (`push-secrets.sh`). Never in Terraform: two tools
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

    # google/
    gcloud auth login
    GOOGLE_OAUTH_ACCESS_TOKEN=$(gcloud auth print-access-token) mise exec -- terraform plan

`plan` should say "No changes". If it does not, someone changed something in a console: either put
the change in the code or revert it. Prefer a short-lived token, limited to this machine's IP, and delete it after.

## State

Local, gitignored (`*.tfstate`, `.terraform/`), kept on the developer's machine. It is cheap to lose:
the `import` blocks rebuild it with one `terraform apply` (which changes nothing when the code matches).
The `.tf` files and `.terraform.lock.hcl` (the provider versions) are in git. If a secret ever has to go
through Terraform, move the state to a remote backend first.
