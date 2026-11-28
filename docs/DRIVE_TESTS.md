# The real-Drive suite

A check against a **real Google Drive** that the test account's credentials work: what the in-memory fake
(`tests/fake-drive.ts`) cannot tell. It is a separate suite, not part of `just test`: it needs a test Google
account and calls Google. `just test-drive` runs it; `just test` and CI never do.

The Drive sync it once exercised with random histories of several devices (`tests/sync-history.ts`) is gone
(docs/SYNC_ARCHITECTURE.md): every space syncs with Chordless. What remains of Drive is signing in with Google,
the Worker's proxy of old share links, and deleting the files a moved space left behind, so the suite is only
`tests/drive/smoke.drive.test.ts`: the credentials reach Drive.

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
