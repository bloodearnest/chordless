# Dev and prod

Two Google Cloud projects, so that development and tests never touch users' data, quota or sign-in.

| | Dev | Prod |
|---|---|---|
| Project | `setalight` (named `chordless-dev`; `infra/google-dev/`) | `chordless-app` (`infra/google-chordless/`) |
| Used by | `npm run dev`, the tests, `just test-drive` | `vite build`, so what is deployed |
| Page's client and Picker app id | `.env.development` | `.env.production` |
| Worker's secrets | `.dev.vars` (`.dev.vars.example` names them) | Worker secrets, set with `wrangler secret put NAME` |
| Where the files are | the Drive of the test account(s) | users' own Drives |

Under `drive.file` a client sees only the files it made, so dev cannot see prod's files or the reverse:
local work starts with an empty Drive, and a test account is a safe place for destructive tests.
Drive API quota and the OAuth consent screen are per project too.

## What must agree

The page signs in with `VITE_GOOGLE_CLIENT_ID` and the Worker checks the tokens it gets against
`GOOGLE_CLIENT_ID`: **the same client**, in each environment. `tests/environments.node.test.ts` checks the
two env files name different projects and that the page names none itself, and that `.dev.vars.example`
names every secret `wrangler.toml` lists.

## Setting up dev

1. `just dev-vars` writes `.dev.vars` (readable by you only, from `.dev.vars.example`): the client id from
   `.env.development`, the dev project's two API keys from gcloud (their ids are Terraform outputs of
   `infra/google-dev/`), and a new `JWE_ENCRYPTION_KEY`. It asks for the client secret (not shown; or set
   `DEV_CLIENT_SECRET`): that is in neither gcloud nor Terraform, and the console shows it once, when the
   secret is made (use "Add secret" on the OAuth client of project `setalight` for a new one). A `.dev.vars` that
   holds another client's values (production's, as it used to) is moved to `.dev.vars.prod-backup` (delete
   it when you no longer need it); otherwise values already there are kept and only gaps are filled.
2. The dev OAuth client needs `http://localhost:8787` (and `http://127.0.0.1:8787`) as authorized JavaScript
   origins, and the consent screen in Testing mode with the test accounts as test users. (By hand: the
   Terraform provider cannot manage them.)
3. Use a browser profile of its own for development: a profile signed in to prod holds blobs the dev
   Worker cannot read and links to real folders.

## Configuration is declared once and checked

- **The Worker's secrets** are listed in `worker/src/config.ts` (name, whether it is needed, what it is for,
  what a good value looks like). The Worker checks them as it starts and answers its own paths with a
  500 naming what is wrong (never the values); `tests/config.node.test.ts` checks that `wrangler.toml` and
  `.dev.vars.example` list the same ones.
- **The page's project** is `.env.development` / `.env.production`; `tests/environments.node.test.ts` checks
  they name different projects, and the Playwright tests check that the build carries production's and the
  dev server development's.
- **The Terraform stacks:** `just lint` runs `terraform fmt -check` and `validate` on each (no credentials).
  `just deploy` first runs `just predeploy`: every stack's plan must say "No changes" (a change made in a
  console shows up as drift) and the production Worker must have all its required secrets
  (`scripts/check-prod-secrets.ts`, names only). It needs `gcloud auth login` and `CLOUDFLARE_API_TOKEN`
  (`infra/README.md`); `INFRA_DRIFT_SKIP="cloudflare"` leaves a stack out, aloud.

## Production secrets

Set one at a time with `npx wrangler secret put NAME` (it prompts, so the value is in no file, no
shell history and no script), and listed with `npx wrangler secret list`. The names are in
`wrangler.toml`. There is no script that pushes a file of them, because the file would be the dev
one or a second copy of the production ones. `GOOGLE_CLIENT_ID` must be the client in `.env.production`:
the page signs in with that one, and the Worker checks the tokens it gets against this.
