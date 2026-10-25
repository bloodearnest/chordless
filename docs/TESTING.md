# Testing

`just format lint test` checks everything: formatting, linting, then three test suites.
Run it before committing.

`just test` runs the suites at once (`scripts/test-all.sh`): the node and browser unit tests in
the background while the Help pictures are taken and then the Playwright tests run, with the
Playwright servers started at the beginning. Each suite uses a worker (or a page) for every two
processors the machine allows (`os.availableParallelism()`: a core each on this machine, and a CI
runner's share), so what runs beside it has room. A background suite's output is printed when it
is done, all of it if it failed, and kept in `.stats/<suite>.log`. Because the suites share the
machine, a test that waits a fixed time, or leans on mocha's 2s timeout, will fail now and then:
wait for the condition instead (`waitUntil`, `expect.poll`), and give a test that does a lot a
timeout to match.

| Suite | Runs | Files | Recipe |
| --- | --- | --- | --- |
| Node | `node --test` | `tests/*.node.test.ts` | `just test-node` |
| Browser unit | Web Test Runner, in Chromium | `tests/*.test.ts` (not `*.node.test.ts`) | `just test-unit` |
| End to end | Playwright, against `just serve` | `tests/*.playwright.ts` | `just test-browser-headless` |

New test files are picked up by their name; there's no list to add them to.

A fourth suite, **`just test-drive`**, runs random histories of several devices syncing through a
real Google Drive. It is not part of `just test` (it needs a test account and calls Google):
`docs/DRIVE_TESTS.md`.

`just test` ends with `just stats`, which records each suite's test count, failures, run time and
coverage (lines, branches, functions; the end-to-end suite has none, and the node suite's is of
`worker/src` only, with the files it cannot see, such as `worker/src/index.ts` which runs under
wrangler, listed as `notMeasured`) with the commit, as a
line in `docs/stats.jsonl`: one line per commit, the latest run on it. The suites leave what it
reads in `.stats/` and `coverage/` when they run in full, so a run of some files does not
record anything. `docs/test-catches.jsonl` is the other record: the real bugs the tests found,
which the agent logs as it works (see CLAUDE.md).

The Help pages show pictures of the real controls (`public/help/`, light and dark). `just test`
retakes them first, with `tests/help-images.shots.ts` (`just help-images` alone does the same), so
they follow how the controls look: commit what changes. It is not one of the Playwright tests (it
writes files); `tests/help-images.node.test.ts` checks every picture the help names exists, and
`tests/help.playwright.ts` that the help shows the one for the theme.

Tests are TypeScript, type-checked by `tsc -b` (part of `just lint`) with `strict` on, except
`noImplicitAny` (`tsconfig.tests.json`, `tsconfig.node.json`): helper parameters and `let`s need no
annotations, but everything the tests call is checked against the app's types, including null
safety. To keep it that way:

- Build records with `tests/builders.ts` (`makeSetlist({ date })`, `makeSong`, `makeEntry`,
  `makePadSet`, `makeChart`, `makeLocalState`) rather than partial literals cast with `as any`.
  A test that needs a record the app would never hold says so with `as unknown as T`.
- `must(await db.getSong(id)).title` (`tests/must.ts`) asserts a value is there and narrows it.
  Chai's `expect(x).to.exist` does not narrow. Not inside `page.evaluate`: that code runs in
  the page, where the helper does not exist.
- Declare fakes with `implements` of the narrow interface the code under test takes
  (`ClickAudioContext`, `SongSelectPage`, `Pick<Storage, ...>`), and type empty arrays
  (`const log: string[] = []`: with `noImplicitAny` off, `[]` is `never[]`).
- Type table-driven cases (`const cases: [string, Route][] = [...]`) and use
  `as const satisfies Route` for route literals.
- Playwright's `page.evaluate` callbacks run in the page: import app modules there by their URL
  (`await import('/js/db.ts')`), and declare the globals the tests put on `window` in
  `tests/page-globals.d.ts`.

## Node tests

For code that doesn't run in a page:

- `worker.node.test.ts`: the whole Cloudflare worker in workerd, as `wrangler.toml` deploys it, through
  Wrangler's `createTestHarness()` (made-up secrets: no `.dev.vars` needed): static files, the SPA
  fallback, that the routes are wired up, the dev pages, and the email handler
  (`worker.getWorker().email(...)` needs a `Message-ID`). Slow, so it checks the wiring, and the
  logic is tested in Node on its own:
- `worker-router.node.test.ts`, `worker-session.node.test.ts`: the Worker's routing
  (`worker/src/router.ts`: what is the API, what is refused as cross-origin, share links, dev pages,
  the 500) and the sign-in routes and token blob (`session.ts`, `blob.ts`), with the assets, cache
  and Google replaced. `index.ts` is only what needs `cloudflare:email` and the Workers cache.
- `google-auth.node.test.ts`: checking a Google ID token (signature, issuer, audience, expiry).
- `share-bundle.node.test.ts`, `share-page.node.test.ts`, `share-proxy.node.test.ts`: share
  links: the encrypted bundle, the page a link opens (with its preview), and the Worker's
  download proxy and its cache.
- `import-plan.node.test.ts`: matching an email's songs to the library.
- `manifest.node.test.ts`: the web app manifest's install-only features (shortcuts, file handler, share target) point at pages that exist.
- `samples.node.test.ts`: the sample charts in `public/samples` are real charts, credited properly, with no CCLI number.
- `songselect-link.node.test.ts`: the SongSelect search link for a missing song.
- `download-emails.node.test.ts`: the Gmail downloader (`scripts/`), against a fake Gmail.
- `email-setlist.node.test.ts`: reading a forwarded email as a setlist, on made-up emails.
- `emails-private.node.test.ts`: the importer over the real emails in `tests/fixtures/private/emails/` (skips when there are none): checks that every one reads as a well formed setlist.
- `import-setlist-update.node.test.ts`: what an email changes in a setlist that has its date already (added, removed, keys, order).
- `email-link.node.test.ts`: the link the email Worker replies with: a setlist in a URL fragment, and a made-up link cut down to what the page can trust.
- `email-worker.node.test.ts`: the email Worker's handler (`worker/src/email.ts`), with a fake message: the reply goes to the sender, with a link; no songs, too big, and header injection.
- `email-mime.node.test.ts`: reading a raw .eml (attachments, a message forwarded as an attachment, HTML only).
- `events.node.test.ts`: every component event class has a unique, namespaced
  `type` (`component:event`), so two events can't collide.

## Browser unit tests

Mocha (`describe`/`it`, from `window`) with `expect` from `@open-wc/testing`, run in real
Chromium by Web Test Runner (`web-test-runner.config.js`). The code under test is the
app's own modules, imported directly: there's no build step to test around.

- **Components** render with `fixture(html\`<song-import></song-import>\`)` and are
  driven through their shadow DOM and events. Component tests also check accessibility
  with axe: `await expect(el).to.be.accessible(A11Y)` (`A11Y` is in `test-helpers.js`).
  The colour checks only see the light theme.
- **Database** tests use the real IndexedDB in the test browser. Tests share it, so
  give records unique names or ids (see `unique()` in `song-utils.test.ts`). Migrations
  are tested by building a database at the old version by hand, then opening it with
  `ChordlessDB` (see `db.test.ts`).
- **Sync** runs the real `sync-manager.ts` and `sync/*` against a **storage backend** (the storage
  API, `docs/STORAGE_API.md`). Tests that are about what the engine does use `useSyncRig()` from
  `drive-harness.ts`: a `MemoryStorage` (`memory-storage.ts`) for each test, and simulated
  devices (`makeDevice`, each with its own database, syncing one space), teardown, and
  `addSong`/`editSong`. Two devices syncing through one memory backend is how cross-device
  behaviour is tested. The backend is reached into with `edit` (a change made elsewhere), `trash`,
  `restore`, `remove`, `removeRoot`, `rekey` (a file replaced by a copy with another ref), `copyFile`,
  `fail(op, ...)` (a call that fails, by name, with `times`, `skip`, `on` and `network`),
  `readOnly`, `corruptWrites`, `clockOffsetMs`, and `writes()` / `clearCalls()` to look at what
  a sync changed. Every backend must pass `storage-conformance.ts`, which runs on the memory
  backend and on the Drive adapter, so the fake cannot drift from the real thing.
  What goes over the wire to Drive is the other half: the Drive adapter
  (`storage/drive-storage.ts`) and `drive-api.ts` run against **FakeDrive** (`fake-drive.ts`), an
  in-memory fake of the parts of the Drive v3 API the app uses. It throws on anything it doesn't
  model rather than guessing, and has its own tests (`fake-drive.test.ts`). The Drive-specific
  tests (`storage-drive`, `drive-api-*`, the sync panel, the pad sets, the Account and Teams page) use it,
  and `useFakeDriveRig()` is the same rig as `useSyncRig()` on top of it, with a check that
  FakeDrive saw nothing it doesn't model. The tests are split by topic: `drive-sync` (setlists, metadata, conflicts, change
  detection), `drive-sync-resilience` (errors partway, files gone), `drive-sync-space`
  (spaces, members, read-only folders), `drive-sync-reset`, `drive-sync-songs`, and
  `share-sync` (share links).
  `drive-sync-random.test.ts` runs random histories of several devices (creating and editing
  setlists, syncing, files trashed, restored or re-id'd, resets, failing storage calls) and
  checks that Drive never holds a setlist twice, that devices end up matching Drive, and that
  no edit is lost. Each mode is a file of its own (`drive-sync-random-<mode>.test.ts`), so they
  run side by side; the suite is in `random-histories.ts`. A failure names its seed, which
  replays the history; raise the constants at the top of `random-histories.ts` for a long hunt.
- **Routing** has pure functions (`router.test.ts`: URL to route and back, and how a move
  changes the history), and the runtime, tested with the real History API, shadow DOM and
  clicks (`app-router.test.ts`). Views are tested like components; `home-view.test.ts`
  also checks there is a view for every route.
- **Live mode**: the state (`live.test.ts`: the record in localStorage, its events, another window's changes), and the header's button with what the setlist page does with it (`setlist-page-edges.test.ts`).
- **Transposition** (`transpose.test.ts`) generates one test per case from a table, so a
  failure names the chord and key.
- Shared setup is in `test-helpers.ts`: `deleteDatabase`, `uniqueName`, `wait`/`settle`,
  `TEST_SPACE`, `suppressConsoleLogs`, and `installFakeTimers()` (a clock that moves only on
  `await clock.tick(ms)`, for code that fades or waits: see `pad-audio-controller.test.ts`).
  Wait for what the test is about (`waitUntil` from
  `@open-wc/testing`) rather than a fixed time where you can.
- `suppressConsoleLogs()` (`test-helpers.js`) hides the app's logging, printing it
  only for tests that fail.

Run one file with `just test-unit tests/db.test.ts`.

A full run starts the slowest files first, by the times of the last full run
(`.stats/unit-files.json`, written by `scripts/wtr-stats-reporter.js`): one page holds one file,
so a slow file that started last would hold up the end of the run on its own. A file that takes
much longer than the rest is better split (as the random histories are, a file to a mode), and a
component's own pauses (a message shown for two seconds) shortened in its tests, as
`DriveSyncPanel.doneMs` is.

## End-to-end tests

Playwright drives the app as a user would, served by a dev server of their own
(`localhost:8791`, so they never meet `just serve` on 8787), with the service worker and real page loads. Tests run fully in
parallel, each in its own browser context.

| File | Covers |
| --- | --- |
| `views.playwright.ts` | Moving between views in place: history, titles, the menu, leaving a setlist or the library cleanly, the media player carrying on |
| `live-mode.playwright.ts` | Go live from the header, the screen following live across pages, leaving, reloading, taking over |
| `live.playwright.ts` | A setlist in use: moving between songs, scrolling, sections, reordering, deleting, keys |
| `app.playwright.ts` | Themes, loading, display preferences, the menu, modals, the storage page |
| `songs.playwright.ts` | The library, song and setlist info, importing, the bookmarklet page |
| `song-settings.playwright.ts` | A song's settings in a setlist, the media player's settings |
| `service-worker.playwright.ts` | The service worker serving the shell, and reloading offline |
| `dev-pages.playwright.ts` | Every page in `src/dev/` loads without errors |
| `about.playwright.ts`, `app-update.playwright.ts` | The About page, and the update notice in the menu |
| `first-use.playwright.ts`, `welcome.playwright.ts` | The first-use setup modal, and the welcome card |
| `import-setlist.playwright.ts` | Importing a setlist from an email's link |
| `share.playwright.ts`, `share-button.playwright.ts`, `share-and-open.playwright.ts` | Opening a share link; the share button; songs shared to the app or opened with it |
| `read-only.playwright.ts`, `setlist-title.playwright.ts` | A read-only space (edits still work); a setlist's title in the header |
| `wake-lock.playwright.ts` | Keeping the screen awake |
| `built.playwright.ts` | The production build (the `built` project, port 8792): the precache, offline, security headers, CSP |

Two projects: `chromium` (everything else, against the dev server) and `built` (only
`built.playwright.ts`, against `vite build` and `vite preview`). A run that names test files,
none of them `built`, skips the build. A failure keeps its trace: in a whole run, only the steps,
console and network (the page's DOM at each step costs a fifth of the run), and with the DOM in a
run that names files, so run a failing file again to look into it.

Import `test` and `expect` from `tests/fixtures.js`, not `@playwright/test`. Its `test`
fails any test whose page throws an uncaught error, starts with the first-use modal answered
(`test.use({ firstUse: true })` opts out), and pins the date to 14 October 2026 (the clock still
runs), so the year-less dates in the seeded setlists ("Sun, 11 Oct") don't change when the
year does. It also has:

- `openApp(page, path)`: opens a view once the service worker controls it. The app
  reloads itself when that first happens, which would otherwise land mid-test.
- `seedSong(page, { setlistId })` and `seedSetlist(page)`: put a song, or a setlist of
  three songs (`SETLIST_SONGS`), in the app's database, the way the app stores them.
- `fromDB(page, method, ...args)`: calls a `ChordlessDB` method in the page, to check
  what was saved.
- `enterEditMode(page)`: turns on edit mode, clicking again if the first click came
  before the app was listening.

To check that a move happened without loading a page, mark the document first
(`window.sameDocument = true`) and see that the mark survives: `views.playwright.ts`
has `markDocument` and `isSameDocument`. A test that needs to hold back a request with
`page.route()` should turn the service worker off (`test.use({ serviceWorkers: 'block' })`):
its first install reloads the page, and Playwright's routes don't see requests the service
worker makes.

Find elements by role and label (`getByRole('button', { name: 'Remove' })`,
`getByLabel('Date')`), scoped by component (`page.locator('#app-header')`). CSS classes
are only for things with no role yet, such as the key and capo pickers' options.

The app does a lot asynchronously, so wait for what a user would see, or for what was
stored (`expect.poll(() => fromDB(...))`), before the next step. In particular, don't
reload until a change has been saved. Running tests in parallel makes the machine
slower, which shows up races like these: `just test-browser-headless --repeat-each=5` is a
good check for a new test.

`just test-browser-ui` opens Playwright's UI, to step through a test.

`just test-webkit [files]` runs the same tests in WebKit (the `webkit` project, Desktop Safari), which is
what every iPhone and iPad browser uses. It is opt-in, not part of `just test`: it roughly doubles
the run. Use it for layout and modal problems reported on Apple devices. `just install-webkit` fetches
it once (on Linux it also needs system libraries: `sudo npx playwright install-deps webkit`).

## Real emails

The email importer (`src/js/email-setlist.ts`) is tuned on real emails from other leaders. They
can't be committed: the PDFs are copyrighted, and the emails have other people's addresses in
them. So they live in `tests/fixtures/private/`, which git ignores. Tests that read them skip when
it is empty, and committed tests use made-up emails of the same shapes.
`emails-private.node.test.ts` reads only the newest 5 (reading every PDF takes ~8s); set
`CHORDLESS_ALL_EMAILS=1` to read them all, as you should when the importer changes.

`scripts/download-emails.ts` fetches them from Gmail. It only reads: the token needs the
`gmail.readonly` scope and nothing else.

### Getting an access token

An access token lasts an hour, so this is done each time you download (a minute's work).

1. Open the [OAuth 2.0 Playground](https://developers.google.com/oauthplayground/).
2. Under **Step 1**, scroll to "Input your own scopes" at the bottom, type
   `https://www.googleapis.com/auth/gmail.readonly`, and click **Authorize APIs**.
3. Sign in with the Google account that holds the emails, and allow read-only access to Gmail.
4. Under **Step 2**, click **Exchange authorization code for tokens**.
5. Copy the **Access token** (it starts `ya29.`). Don't use the refresh token.
6. When you have finished, revoke the access at
   [myaccount.google.com/permissions](https://myaccount.google.com/permissions) (the app is
   "Google OAuth 2.0 Playground").

A Google Workspace account may block this; use a personal Gmail account, or ask its admin.

### Downloading

Put the senders' addresses in a file, one per line (`#` starts a comment), outside the repository
or in `tests/fixtures/private/`, so the list is not committed either:

```
# worship leaders
jenny@example.com
pippa@example.com
```

Then, with the token in the environment (not on the command line, where your shell history would
keep it):

```
GMAIL_TOKEN='ya29.…' node scripts/download-emails.ts --senders-file tests/fixtures/private/senders.txt --dry-run
GMAIL_TOKEN='ya29.…' node scripts/download-emails.ts --senders-file tests/fixtures/private/senders.txt
```

It keeps emails from those senders with at least three PDFs attached (`--min-pdfs`), and saves
each, whole, as `tests/fixtures/private/emails/<date>-<id>.eml`. Run again later to fetch new
ones: those already saved are skipped. `--from a@x.com,b@x.com` gives addresses on the command
line instead, `--after 2025/01/01` limits the dates, and `--dry-run` lists what it would save.
The options are documented at the top of the script.

If you forward emails to yourself to import them, include your own address as a sender.

## Coverage

`just coverage` runs the node tests and the browser unit tests with coverage, and `scripts/coverage.ts`
merges the two: a line counts as covered if either suite ran it. It prints the totals and the files
with the most missing, and lists the source files no test loads (they are in neither report).
`node scripts/coverage.ts src/js/db.ts` lists the lines, branches and functions of one file that no
test reaches; `--all` lists every file. (The browser suite's own report is `coverage/index.html`.)
The end-to-end tests aren't measured.

The goal is 100%, and `docs/coverage-floor.json` holds the way there: for each file, how much is
still missing. `just test` fails if a file has more missing than that, or a new file has any. When
coverage goes up it says so, and `node scripts/coverage.ts --lower` records it: commit the floor with
the change that did it. (It is not lowered by itself because a few lines come and go with timing
from run to run, as a `setTimeout` that fires before the page is closed or not: a test that makes
that happen every time is a better test, and the file shows in the failure until then.) A fully
covered file drops out of the floor; when the floor is empty, coverage is 100%.

Code that is not worth covering is marked, with the reason after `--`:

    /* v8 ignore next -- iOS only: Chromium has no install prompt */      this line (`next 3`: three lines)
    /* v8 ignore start -- why */ ... /* v8 ignore stop */                  a block

(`node:coverage` and `c8` are read the same as `v8`.) The check fails for a mark with no reason.
Fair reasons: a branch TypeScript makes us write that cannot happen; a browser feature Chromium
cannot fake; start-up wiring that a Playwright test exercises. "Hard to test" is not one: change the
code so it can be tested, or write the test. Marks are counted in the summary, so they stay
visible in review.
