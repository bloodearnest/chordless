# Developing Chordless

The app is in `src/` (and `public/` for the icons and manifest; the tooling that makes the
icons is in `icon-tooling/`), and the Worker in
`worker/`. In development Vite serves `src/` as it is, with no build step; `just build`
bundles it for production (see [docs/BUILD.md](docs/BUILD.md)). Commands are run with
[`just`](https://github.com/casey/just); run `just` on its own to list them.

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

`just serve` runs Vite with the Cloudflare plugin: one server that serves `src/` and
runs the app's Worker (the OAuth and session routes) in workerd, as in production. The first visit registers the service worker,
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
| `just build` | Builds the app and the Worker into `dist/` |
| `just preview` | Serves the build in `dist/` on port 8788, as production would |
| `just deploy` | Builds, then deploys the Worker and the built app to Cloudflare |
| `just secrets` | Pushes the secrets in `.dev.vars` to Cloudflare |

## Conventions

- Vanilla JavaScript and Lit, with Vite as the only tooling: nothing is transpiled or
  generated in development. Dependencies are npm packages imported by name.
- Use modern HTML, CSS and JS, within the browsers in `.browserslistrc`, and prefer
  native browser features.
- Components are [Lit](https://lit.dev/) web components in `src/components/`.
- What a class keeps to itself is `#name` (native private) in new plain classes. A Lit
  component's reactive state has to be a named property, so a component's own members are
  `_name`; so are the members of the older classes in `src/js/`, which tests read. TypeScript's
  `private` is not used (only `protected`, where a subclass needs the member).

## Dev pages (component playgrounds)

`src/dev/` holds pages for developing components visually, in isolation. With
`just serve` running, open http://localhost:8787/dev/ for the list.

- They are not part of the build (only `src/index.html` is), and are only served locally: `just serve` uses the `[env.dev]` environment in
  `wrangler.toml`, which sets `DEV_PAGES`. The worker returns 404 for `/dev/*` without
  it, so they never reach production. Put other local-only settings in `[env.dev]` too.
- When adding a page, link it from `src/dev/index.html` and use absolute paths
  (`/js/...`, `/components/...`, `/css/style.css`).
- `tests/dev-pages.playwright.js` loads every page and fails on JS errors, failed
  requests or unregistered custom elements, so a broken playground shows up in
  `just test-browser-headless`.
