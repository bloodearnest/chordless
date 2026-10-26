# The real-Drive suite

Random histories of several devices syncing through a **real Google Drive folder**, to find what
the in-memory fake cannot: listings that lag behind writes, rate limits, the feed of changes,
real checksums, requests that overlap. It is a separate suite, not part of `just test`: it needs a
test Google account, takes minutes, and calls Google.

`just test-drive` runs it. `just test` and CI never do.

## What it runs

The engine is `tests/sync-history.ts`, the same one `tests/drive-sync-random.test.ts` runs against
an in-memory Drive (every `just test`). Several simulated devices, each with its own database,
sync one space and, at random, create and edit setlists, sync, sync **at the same moment**
(`concurrent`), have their requests fail, reset, and have files put in Drive's bin, restored or
replaced by a copy under another id behind their backs. Then everything is synced until quiet, and
what must hold is checked:

- Drive never holds two live files for one setlist, or for one date/leader/type/name
- every device has exactly the setlists Drive has, with the same contents
- an edit is never lost (unless someone trashed the setlist in Drive)

`tests/drive/real-world.ts` is the real Drive as the engine sees it (the real Drive client and
storage adapter, with requests made to fail by `tests/drive/faults.ts`). `tests/drive-real-world.test.ts`
runs that same code against FakeDrive in every `just test`, so it is checked without an account.

## Modes

`DRIVE_MODES` (default `owner,concurrent`): `owner` (each setlist edited by the device that made
it), `concurrent` (as `owner`, with syncs at the same moment), `conflicts` (any device edits any
setlist: Drive wins, so only the first two promises hold), `collisions` (devices make setlists for
the same date and leader: only the first promise holds), `incremental` (sync from the feed of
changes; a real Drive's feed cannot be made to forget its positions, so that part is not
exercised). Other settings: `DRIVE_SEEDS` (`1-5`, `7`, `1-3,8`; default `1,2,3`), `DRIVE_STEPS`
(default 30), `DRIVE_DEVICES` (default 3).

    DRIVE_SEEDS=1-10 DRIVE_MODES=concurrent just test-drive

A failure names its mode and seed. The same seed makes the same random choices again; a real Drive
does not repeat itself, so a history may not fail the same way twice. To see whether the in-memory
fake fails on it too, put the seed in `SEEDS` of `tests/random-histories.ts` (`tests/drive-sync-random*.test.ts` run them, a file to a mode).

## The test account and its credentials

Use a throwaway Google account, **not your own**: the suite makes, edits and trashes files.
Everything it makes is in folders named `chordless-drive-test …` under the account's `Chordless`
folder, and it only ever touches folders it made (`drive.file` could not see others).

1. Use the dev project's OAuth client (`infra/google-dev/`: project `chordless-dev`),
   not the app's own. Make an OAuth client in it by hand (type Web application with the redirect URI
   `http://127.0.0.1:8976` below, or Desktop app), and a consent screen in Testing mode with the
   test account as a test user. Drive API quota is per project, so the suite cannot use up the real
   app's. Its files go in a `Chordless-dev` folder (`.env.development`), not `Chordless`.
   (Under `drive.file` an app sees only the files it made itself, so the client that makes the
   files must be the client that reads them, and the suite's files are invisible to the real app.)
2. `just drive-test-login` uses the dev project's client that `npm run dev` signs in with: the id and
   secret in `.dev.vars` (made by `just dev-vars`), taken only when that id is the dev one in
   `.env.development`, so production's values can never be used and the suite's Drive quota is the dev
   project's. It copies them into `.drive-test.env` (`DRIVE_TEST_CLIENT_ID`, `DRIVE_TEST_CLIENT_SECRET`),
   which is what the suite reads; run it again after a new secret is made. With no usable `.dev.vars`
   it takes them from `.drive-test.env`, or asks (the secret is not shown as you type).
   The login listens on `http://127.0.0.1:8976` (`DRIVE_TEST_LOGIN_PORT` changes it): a Desktop-app
   client takes that without setup; a web client needs it added to its authorized redirect URIs.
3. It opens Google's sign-in, pre-filled with `DRIVE_TEST_ACCOUNT` (default `chordless.test.user@gmail.com`);
   sign in as the test account. It writes
   `DRIVE_TEST_REFRESH_TOKEN` into `.drive-test.env` (readable by you only) and prints nothing secret.

The refresh token is the long-term secret. Each run mints an access token from it, or reuses the
last one (kept in `.drive-test/token.json`, readable by you only) while it has more than five
minutes left; a long run mints another when it is nearly out. A refresh token given to an app in
Google's "testing" mode expires after seven days: publish the consent screen (or re-run the login)
if `invalid_grant` appears.

## The live-share test

`just test-live-share` (`tests/drive/live-share.drive.node.test.ts`) uses the same account and token
for live sync of a share (LIVE_SYNC.md): it uploads a share file to the test account's Drive, runs the
real Worker in workerd (the wrangler test harness, with `GOOGLE_API_KEY` from `.dev.vars`, the dev
project's Drive key), and joins the share's room with real WebSockets as a sharer and as recipients
who have no account. The sharer uploads a new version and says `changed`; the test checks who is told,
fetches the share as the app does (`?fresh=1`, at once and again) and prints how long the new
version took to be there. It is a Node test and not one of the browser tests above because the Worker
refuses a page of another origin, which the test runner's page is. Its folder goes to Drive's bin
(the share's public link is ended first), whatever happens.

## The live tests, in browsers

`just test-live` (`playwright.live.config.ts`, `tests/live/`) uses the same account to run **browsers
signed in as the test account**, against `just serve-live`'s server (on ports of its own), the real
Worker and a real Drive. The sign-in is made without Google's consent screen: the app keeps it as an
encrypted blob that holds the refresh token, which the Worker opens with its key, so the test makes one
from `DRIVE_TEST_REFRESH_TOKEN` and `JWE_ENCRYPTION_KEY` (`.dev.vars`) and puts it where the app keeps
it (`tests/live/signed-in.ts`); the app then asks the Worker for access tokens, and the Worker asks
Google. Use `signIn(page)` for any test that needs the app signed in. Each test makes its space under a
name of its own and puts it away from Node afterwards (`drive-cleanup.ts`: shares ended, folder in the
bin), whatever happens to the browser. `LIVE_DEBUG=1` prints each page's console, its sockets' frames
and the share requests, with the time.

- `live-share.live.playwright.ts`: a sharer with a real Drive folder shares a setlist from the UI, a
  recipient with no account opens the link, both go live, the sharer adds a song, and the recipient's
  page shows it (2.8 to 3.3 s from the edit in five runs: the app's short wait after an edit while live,
  the share's upload, the ping, the fetch).

## Cleaning up

A history that passes puts its folder in Drive's bin (recoverable for thirty days). One that fails
leaves its folder, named in the failure, so its files can be looked at. Each run first puts away
the leftover `chordless-drive-test` folders over a day old.

## What it does not do

- It is not a load test of Google: one test at a time, a few devices, a few dozen steps.
- It cannot make a real feed of changes forget where it was, or make Drive slow.
- Edits are to setlists; songs and charts are covered by the in-memory suite.
