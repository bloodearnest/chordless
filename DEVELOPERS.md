# Developing Chordless

There is no build step: the files in `src/` are what gets served. Commands are run
with [`just`](https://github.com/casey/just); run `just` on its own to list them.

## Setup

You need Node and `just`.

```bash
just setup   # npm dependencies, and Chromium for the end-to-end tests
```

Sign-in needs Google OAuth credentials and a session key, in a `.dev.vars` file in the
project root (not committed):

```
JWE_ENCRYPTION_KEY=<base64 symmetric key>
GOOGLE_CLIENT_ID=<Google OAuth client id>
GOOGLE_CLIENT_SECRET=<Google OAuth client secret>
```

Without it the app still runs, but you can't sign in or sync with Drive.

## Running it

```bash
just serve    # http://localhost:8787
```

`just serve` runs the app's Cloudflare Worker locally. It serves `src/` and handles
the OAuth and session routes. The first visit registers the service worker,
and the page reloads once it is active. In DevTools, filter the console for `[SW]` to
see its logs.

Browser data (IndexedDB, sign-in) belongs to the origin, so keep using the same URL.
`just funnel` exposes the local server over Tailscale at a stable address, for testing
on a phone or tablet.

## Before you commit

```bash
just format lint test
```

| Recipe | What it does |
| --- | --- |
| `just format` | Formats with Biome |
| `just lint` | Lints with Biome |
| `just test` | Runs the three suites below |
| `just test-node` | Node tests (the worker, event names) |
| `just test-unit` | Browser unit tests, in Web Test Runner. Takes files: `just test-unit tests/db.test.js` |
| `just test-browser-headless` | End-to-end tests, in Playwright. Takes files and options: `just test-browser-headless tests/live.playwright.js --repeat-each=5` |
| `just test-browser-ui` | Playwright's UI, to step through a test |
| `just test-browser-headed` | Playwright with a visible browser |
| `just coverage` | Browser unit test coverage, in `coverage/index.html` |

[docs/TESTING.md](docs/TESTING.md) covers what each suite is for and how to write tests.

## Other recipes

| Recipe | What it does |
| --- | --- |
| `just setup` | First-time setup (see above) |
| `just vendor` | Copies vendored dependencies from `node_modules` into `src/vendor/` |
| `just deploy` | Deploys the Worker and `src/` to Cloudflare |
| `just secrets` | Pushes the secrets in `.dev.vars` to Cloudflare |

## Conventions

- Vanilla JavaScript only. Never add a build step; npm is only for managing the
  versions of vendored libraries, which are served locally as modules.
- Use modern HTML, CSS and JS, within the browsers in `.browserslistrc`, and prefer
  native browser features.
- Components are [Lit](https://lit.dev/) web components in `src/components/`.

## Dev pages (component playgrounds)

`src/dev/` holds pages for developing components visually, in isolation. With
`just serve` running, open http://localhost:8787/dev/ for the list.

- They are only served locally: `just serve` uses the `[env.dev]` environment in
  `wrangler.toml`, which sets `DEV_PAGES`. The worker returns 404 for `/dev/*` without
  it, so they never reach production. Put other local-only settings in `[env.dev]` too.
- When adding a page, link it from `src/dev/index.html` and use absolute paths
  (`/js/...`, `/components/...`, `/css/style.css`).
- `tests/dev-pages.playwright.js` loads every page and fails on JS errors, failed
  requests or unregistered custom elements, so a broken playground shows up in
  `just test-browser-headless`.
