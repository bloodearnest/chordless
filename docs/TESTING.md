# Testing

`just format lint test` checks everything: formatting, linting, then three test suites.
Run it before committing.

| Suite | Runs | Files | Recipe |
| --- | --- | --- | --- |
| Node | `node --test` | `tests/*.node.test.js` | `just test-node` |
| Browser unit | Web Test Runner, in Chromium | `tests/*.test.js` (not `*.node.test.js`) | `just test-unit` |
| End to end | Playwright, against `just serve` | `tests/*.playwright.js` | `just test-browser-headless` |

New test files are picked up by their name; there's no list to add them to.

## Node tests

For code that doesn't run in a page:

- `worker.node.test.js`: the Cloudflare worker (static files, the SPA fallback, the
  OAuth and session routes).
- `events.node.test.js`: every component event class has a unique, namespaced
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
  give records unique names or ids (see `unique()` in `song-utils.test.js`). Migrations
  are tested by building a database at the old version by hand, then opening it with
  `ChordlessDB` (see `db.test.js`).
- **Drive sync** runs the real `drive-api.js` and `drive-sync.js` against FakeDrive
  (`fake-drive.js`), an in-memory fake of the parts of the Drive v3 API the app uses.
  It throws on anything it doesn't model rather than guessing, and has its own tests
  (`fake-drive.test.js`). `drive-sync.test.js` sets up two devices syncing through one
  fake Drive, which is how cross-device behaviour is tested.
- **Transposition** (`transpose.test.js`) has one test per case, so a failure names
  the chord and key.
- `suppressConsoleLogs()` (`test-helpers.js`) hides the app's logging, printing it
  only for tests that fail.

Run one file with `just test-unit tests/db.test.js`.

## End-to-end tests

Playwright drives the app as a user would, served by `just serve` (at
`localhost:8787`), with the service worker and real page loads. Tests run fully in
parallel, each in its own browser context.

| File | Covers |
| --- | --- |
| `live.playwright.js` | A setlist in use: moving between songs, scrolling, sections, reordering, deleting, keys |
| `app.playwright.js` | Themes, loading, display preferences, the menu, modals, the storage page |
| `songs.playwright.js` | The library, song and setlist info, importing, the bookmarklet page |
| `song-settings.playwright.js` | A song's settings in a setlist, the media player's settings |
| `service-worker.playwright.js` | Routing through the service worker, and reloading offline |
| `dev-pages.playwright.js` | Every page in `public/dev/` loads without errors |

Import `test` and `expect` from `tests/fixtures.js`, not `@playwright/test`. Its `test`
fails any test whose page throws an uncaught error. It also has:

- `openApp(page, path)`: opens a page once the service worker controls it. The app
  reloads itself when that first happens, which would otherwise land mid-test.
- `seedSong(page, { setlistId })` and `seedSetlist(page)`: put a song, or a setlist of
  three songs (`SETLIST_SONGS`), in the app's database, the way the app stores them.
- `fromDB(page, method, ...args)`: calls a `ChordlessDB` method in the page, to check
  what was saved.
- `enterEditMode(page)`: turns on edit mode, clicking again if the first click came
  before the app was listening.

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
