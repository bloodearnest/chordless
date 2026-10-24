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
fake fails on it too, put the seed in `SEEDS` of `tests/drive-sync-random.test.ts`.

## The test account and its credentials

Use a throwaway Google account, **not your own**: the suite makes, edits and trashes files.
Everything it makes is in folders named `chordless-drive-test …` under the account's `Chordless`
folder, and it only ever touches folders it made (`drive.file` could not see others).

1. Use the app's own OAuth client (simplest: the files the suite makes are then the app's to see
   too), or make an OAuth client of type **Desktop app** just for the tests.
   (Under `drive.file` an app sees only the files it made itself, so the client that makes the
   files must be the client that reads them. A separate client keeps the suite apart from the
   app's own and needs no change to its redirect addresses.) If the consent screen is in testing,
   add the test account as a test user.
2. `just drive-test-login` takes the client's id and secret from `.drive-test.env` (`DRIVE_TEST_CLIENT_ID`,
   `DRIVE_TEST_CLIENT_SECRET`), or else from the app's own `.dev.vars` (`GOOGLE_CLIENT_ID`,
   `GOOGLE_CLIENT_SECRET`), or else asks for them (the secret is not shown as you type), and
   keeps them in `.drive-test.env`. It listens on `http://127.0.0.1:8976` (`DRIVE_TEST_LOGIN_PORT`
   changes it): a Desktop-app client takes that without setup; the app's web client needs
   `http://127.0.0.1:8976` added to its authorized redirect URIs.
3. It opens Google's sign-in, pre-filled with `DRIVE_TEST_ACCOUNT` (default `chordless.test.user@gmail.com`);
   sign in as the test account. It writes
   `DRIVE_TEST_REFRESH_TOKEN` into `.drive-test.env` (readable by you only) and prints nothing secret.

The refresh token is the long-term secret. Each run mints an access token from it, or reuses the
last one (kept in `.drive-test/token.json`, readable by you only) while it has more than five
minutes left; a long run mints another when it is nearly out. A refresh token given to an app in
Google's "testing" mode expires after seven days: publish the consent screen (or re-run the login)
if `invalid_grant` appears.

## Cleaning up

A history that passes puts its folder in Drive's bin (recoverable for thirty days). One that fails
leaves its folder, named in the failure, so its files can be looked at. Each run first puts away
the leftover `chordless-drive-test` folders over a day old.

## What it does not do

- It is not a load test of Google: one test at a time, a few devices, a few dozen steps.
- It cannot make a real feed of changes forget where it was, or make Drive slow.
- Edits are to setlists; songs and charts are covered by the in-memory suite.
