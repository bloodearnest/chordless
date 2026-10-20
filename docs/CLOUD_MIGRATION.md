# Moving to a new Google Cloud project, with Terraform

**Status: planned (2026-10-19), to be done before going live.** The move itself has not been done. The
team spike (docs/SPACES.md) carries on in the meantime, in the current project.

**Done 2026-10-20: the current setup is recorded as Terraform** in `infra/` (`infra/README.md`): the
`setalight` project, its Drive and Picker APIs, the two API keys and the `broker` service account, and
the Cloudflare side (Email Routing, the custom domain, TXT records, TLS settings). The new project's
Terraform can start from `infra/google/main.tf`. The Sharing Key allows the Drive API only (Picker was
dropped; nothing used it).

## Why

- The current project's id is `setalight`, from its first name. A project id cannot be renamed, so it
  shows wherever the id shows: the service account's address (`…@setalight.iam.gserviceaccount.com`)
  is what a team admin sees in their shared drive's members.
- There are no users yet. The move is as cheap as it will ever be: the only data is the developer's.
- The setup is a pile of console clicks nobody could repeat. What Terraform can cover should be in code.
- The key that can reach every connected team's drive (the service account, docs/SPACES.md,
  "Credentials") should not live in the project that holds the sign-in and the verified brand.

## The shape of it

Two projects, with ids to be chosen (they are global and permanent: check they are free, and think
before creating):

| | App project (e.g. `chordless-app`) | Broker project (e.g. `chordless-broker`) |
|---|---|---|
| Holds | OAuth consent screen and web client, the Drive and Picker APIs, two API keys | the service account for team-managed storage (and nothing else) |
| By hand | the consent screen, its brand verification, the web client | the service account key (into a Worker secret) |
| Terraform | project, enabled APIs, the API keys and their restrictions | project, enabled APIs, the service account |

The broker project can be made at any time, and the spike's item 7 runs in the current project first.

## What depends on the current project

Found in the repo; each changes with a new project.

| What | Where | Changes to |
|---|---|---|
| The OAuth client id | `GOOGLE_CLIENT_ID` in `src/js/google-auth.ts` (public) | the new client's id |
| The client id and secret | Worker secrets `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (`scripts/push-secrets.sh`, `.dev.vars`, DEVELOPERS.md) | the new client's |
| The sharing key | Worker secret `GOOGLE_API_KEY`: Drive API only, **no** referrer restriction, since the Worker sends none | a new key in the app project |
| The Picker key | typed on the dev pages today; a public build-time setting in the product, restricted to the Picker API and to `https://chordless.app/*` and the dev address | a new key in the app project |
| The Picker app id | the project **number**, `376758830135`, in `src/dev/*.js`, the probe page, docs/SPACES.md | the new project number |
| Authorised origins and redirect URIs | the web client: `http://localhost:8787`, `https://chordless.app`, the Tailscale funnel address (the sign-in popup uses the page's origin as `redirect_uri`) | the same list on the new client |
| The consent screen | app name, logo, support email, developer contact, authorised domains (`chordless.app`), scopes `openid email profile drive.file`, **In production**, brand verified | the same, and verified again |
| Enabled APIs | Drive, Picker; the Gmail download script (`scripts/gmail-download.ts`, a local developer tool) may use this client too: **check** | the same |
| The Workspace admin's list of allowed apps | if the organisation controls third-party apps, the new client id must be allowed | add it |

## The important consequence: the data does not follow

`drive.file` gives an OAuth client access only to the files **that client** created or was given.
Everything the current client made in anyone's Drive (the `Chordless/` folders, songs, setlists, pad
sets, share files) is invisible to the new client, exactly as a second account could not see the
owner's (docs/SPACES.md, spike items 2 and 6). Every stored sign-in also stops working (a new client
means a new consent), and the old refresh tokens are dead.

So the data moves through the **export and import** that is already built (docs/SPACES.md, "Export
and import"), not through Drive:

1. In each space, on each device that has data worth keeping: export (tick the pad sets).
2. Switch to the new client, sign in again.
3. Import into the space, and sync: this creates the files again, owned by the new client.
4. Make the share links again (they are new files with new keys, and the old links die).
5. When it is checked, delete the old `Chordless/` folders in Drive by hand, and remove the old
   client's access at myaccount.google.com/permissions.

With no users, this is the developer's own data and one afternoon. After going live it would be
every user's, which is why this is done first.

## What Terraform covers

Using the Google provider (from memory: check against its documentation when writing it):

- **Yes:** the project (with the chosen id), enabled APIs (`google_project_service`), service
  accounts and their roles, API keys with their restrictions (`google_apikeys_key`), organisation
  policy overrides (for example allowing service account keys on the broker project).
- **No:** the consent screen and its verification, and the web OAuth client (the provider has only
  the IAP kind); adding the service account to a shared drive (a Drive admin action); the Worker and
  its secrets (`wrangler`'s job).
- **Keys stay out of Terraform.** A key it creates ends up in the state file as a secret. Make the
  service account key by hand and put it straight into a Worker secret.
- Plain `terraform` or OpenTofu, state kept locally and out of git until there is a reason for more.
  It lives in `infra/`, apart from the app, and the project rules still hold: no framework in the app.

## Order of work

**0. Decide, and prepare (can start now; the long pole is Google's verification).**
Choose the ids (and the display names); one project or two (above); whether they sit under an
organisation or folder. `gcloud` and Terraform are pinned in `mise.toml`. **Recorded** (`infra/google/main.tf`), so it can be
copied: `gcloud services list --enabled --project=setalight`, `gcloud services api-keys list`,
`gcloud iam service-accounts list`, and by eye the consent screen and the client (app name, logo,
support email, domains, scopes, origins, redirect URIs). Never the client secret or a key.

**1. The new app project, in Terraform:** the project, the APIs, the Drive-only sharing key (no
referrer) and the Picker key (Picker API only; referrers for chordless.app and the dev address).

**2. By hand, as early as possible: the consent screen and the web client** in the new project, as
recorded; publish to production and submit the brand for verification. Everything else waits on this,
so start it first. `drive.file` is not a sensitive scope, so I expect the brand verification only and
not a full app review, but that is an expectation to check, not a fact.

**3. Wire it in:** the new client id in `google-auth.ts`; the Worker secrets (`push-secrets.sh`) and
`.dev.vars`; the Picker app id (the new project number) and key; the docs. Allow the new client in the
Workspace admin console if third-party apps are controlled.

**4. Move the data:** export, sign in, import, sync, remake the share links (above); run
`just format lint test`, the Drive sync tests against a real Drive, a share link end to end, and
the probe and spike pages.

**5. Retire the old project:** after a week of use, delete it (Google keeps a deleted project
recoverable for 30 days). Until then it is the way back.

**6. The broker project:** Terraform for the project, APIs and the service account; the key by hand
into a Worker secret; add the service account to the shared drive as Content manager. (Spike item 7
proves it first, in the current project.)

## Rollback

The old project and client stay untouched until step 5, so going back is a matter of putting the old
client id and secrets back. The only thing that cannot be undone is the data written under the new
client, which is why the old Drive folders are kept until the move is checked.

## Open decisions

- The project ids and display names, and one app project plus a broker project, or the app project alone.
- Under an organisation, or not.
- Terraform or OpenTofu; where its state lives.
- Whether the Gmail download script has its own client or uses this one.
