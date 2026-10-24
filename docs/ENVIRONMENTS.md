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

1. `.dev.vars` from `.dev.vars.example`: the dev client's id and secret (console, project `setalight`;
   the id is the one in `.env.development`), the two keys (the `gcloud services api-keys get-key-string`
   commands in the example), a new `JWE_ENCRYPTION_KEY`.
2. The dev OAuth client needs `http://localhost:8787` (and `http://127.0.0.1:8787`) as authorized JavaScript
   origins, and the consent screen in Testing mode with the test accounts as test users.
3. Use a browser profile of its own for development: a profile signed in to prod holds blobs the dev
   Worker cannot read and links to real folders.

## Production secrets

Set one at a time with `npx wrangler secret put NAME` (it prompts, so the value is in no file, no
shell history and no script), and listed with `npx wrangler secret list`. The names are in
`wrangler.toml`. There is no script that pushes a file of them, because the file would be the dev
one or a second copy of the production ones. `GOOGLE_CLIENT_ID` must be the client in `.env.production`:
the page signs in with that one, and the Worker checks the tokens it gets against this.
