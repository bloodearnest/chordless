# Testing

`just format lint test` checks everything: formatting, linting, then three test suites.
Run it before committing.

| Suite | Runs | Files | Recipe |
| --- | --- | --- | --- |
| Node | `node --test` | `tests/*.node.test.ts` | `just test-node` |
| Browser unit | Web Test Runner, in Chromium | `tests/*.test.ts` (not `*.node.test.ts`) | `just test-unit` |
| End to end | Playwright, against `just serve` | `tests/*.playwright.ts` | `just test-browser-headless` |

New test files are picked up by their name; there's no list to add them to.

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

- `worker.node.test.ts`: the Cloudflare worker (static files, the SPA fallback, the
  OAuth and session routes).
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
- **Drive sync** runs the real `drive-api.js` and `drive-sync.js` against FakeDrive
  (`fake-drive.js`), an in-memory fake of the parts of the Drive v3 API the app uses.
  It throws on anything it doesn't model rather than guessing, and has its own tests
  (`fake-drive.test.ts`). `drive-sync.test.ts` sets up two devices syncing through one
  fake Drive, which is how cross-device behaviour is tested.
  `drive-sync-random.test.ts` runs random histories of several devices (creating and editing
  setlists, syncing, files trashed, restored or re-id'd in Drive, resets, failing requests) and
  checks that Drive never holds a setlist twice, that devices end up matching Drive, and that
  no edit is lost. A failure names its seed, which replays the history; raise the constants at
  the top of the file for a long hunt.
- **Routing** has pure functions (`router.test.ts`: URL to route and back, and how a move
  changes the history), and the runtime, tested with the real History API, shadow DOM and
  clicks (`app-router.test.ts`). Views are tested like components; `home-view.test.ts`
  also checks there is a view for every route.
- **Transposition** (`transpose.test.ts`) has one test per case, so a failure names
  the chord and key.
- `suppressConsoleLogs()` (`test-helpers.js`) hides the app's logging, printing it
  only for tests that fail.

Run one file with `just test-unit tests/db.test.ts`.

## End-to-end tests

Playwright drives the app as a user would, served by a dev server of their own
(`localhost:8791`, so they never meet `just serve` on 8787), with the service worker and real page loads. Tests run fully in
parallel, each in its own browser context.

| File | Covers |
| --- | --- |
| `views.playwright.ts` | Moving between views in place: history, titles, the menu, leaving a setlist or the library cleanly, the media player carrying on |
| `live.playwright.ts` | A setlist in use: moving between songs, scrolling, sections, reordering, deleting, keys |
| `app.playwright.ts` | Themes, loading, display preferences, the menu, modals, the storage page |
| `songs.playwright.ts` | The library, song and setlist info, importing, the bookmarklet page |
| `song-settings.playwright.ts` | A song's settings in a setlist, the media player's settings |
| `service-worker.playwright.ts` | The service worker serving the shell, and reloading offline |
| `dev-pages.playwright.ts` | Every page in `src/dev/` loads without errors |

Import `test` and `expect` from `tests/fixtures.js`, not `@playwright/test`. Its `test`
fails any test whose page throws an uncaught error. It also has:

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

## Coverage

`just coverage` runs the browser unit tests with coverage, printing a summary and
writing an HTML report to `coverage/index.html`. Only files the tests load are
counted, so a module no test imports doesn't appear at all. The end-to-end tests
aren't included.
