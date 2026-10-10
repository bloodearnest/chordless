# Build

Development and production are one codebase with two shapes.

| | Dev (`just serve`) | Production (`just build`, `just deploy`) |
| --- | --- | --- |
| App | `src/` served by Vite as written, modules on demand | Bundled and hashed into `dist/client/` |
| Worker | `worker/src` in workerd, through `@cloudflare/vite-plugin` | Bundled into `dist/chordless_auth_proxy/` |
| Service worker | Bundled per request, **empty precache** | Built once, with the **whole app precached** |
| Environment | `[env.dev]` in `wrangler.toml` (the dev pages) | The top level |

`vite.config.js` has the settings, with the reasons beside them. Port 8787 is fixed because the
browser's data (IndexedDB, sign-in) belongs to the origin and the Tailscale funnel points at it.

## Layout

- `src/` is Vite's root: `index.html` (the only page that is built), `js/`, `components/`,
  `css/`, `service-worker.js`, and `dev/` (the playgrounds, not built).
- `public/` is copied as it is: the icons and the manifest.
- `dist/` is the output, and is not committed. `dist/client` is what is served, and
  `dist/chordless_auth_proxy` the Worker with a generated `wrangler.json`.

## The service worker

`vite-plugins/service-worker.js` builds `src/service-worker.js` itself, because the app's
needs are unusual:

- **Classic script.** Module service workers need Chrome 91 or later, and are late in
  Firefox. A classic worker, with its one import bundled in, runs wherever service workers do.
  The page registers it with no `type`.
- **A full precache.** After the build the plugin lists every file in `dist/client` and injects
  the list (`__PRECACHE__`). The worker installs by caching all of them, so every view, which
  loads its code on demand, works offline from the first visit, and the worker is only "active"
  once they are all there.
- **Versioned by content.** `__CACHE_VERSION__` is a hash of the files, and names the cache
  (`cache-<hash>`). Any change to the build is a new worker, which installs its own cache, and on
  activation the old one is deleted. Files with hashes in their names are served from the cache;
  the shell (`/`) is fetched from the network first, but the cached copy is not replaced, so it
  always matches the cached files.
- **Not precached:** the worker, source maps, the icon tooling in `public/icons`. Pad audio, and
  other things fetched while running, go in `runtime-v1` and `padsets-cache-v1`, which survive
  an update.

In dev the precache is empty and the worker caches what it sees, as it always did, so the
dev server can't show the production behaviour. `tests/built.playwright.js` (the `built`
Playwright project) tests the build, served by `vite preview` on port 8788.

## First visit

A page that starts loading before the service worker is active is never controlled by it (and
`clients.claim()` doesn't reach a page still being made), so on the very first visit
`index.html` reloads once, after `navigator.serviceWorker.ready`. `sessionStorage`
`sw-first-load` is set from the start and cleared when the page is controlled: tests wait for
it to go (`waitForServiceWorker` in `tests/fixtures.js`; `openApp` does).

## Deploying

`just deploy` runs `vite build` then `wrangler deploy --config
dist/chordless_auth_proxy/wrangler.json`. The plugin writes a redirect file for Wrangler under
`src/.wrangler`, where a deploy run from the repo root doesn't look, hence `--config`.

## Gotchas

- `wrangler.toml` has `html_handling = "none"`. With the default, `/dev/x.html` redirects to
  `/dev/x`, and Vite's dev server then fails to serve the page's inline module script. The dev
  pages' scripts are files for the same reason (`src/dev/*.js`).
- Vite does not read `.browserslistrc`. The build target is Vite's default until the
  browser-support work (see the TODO) sets it.
