# Build

Development and production are one codebase with two shapes.

| | Dev (`just serve`) | Production (`just build`, `just deploy`) |
| --- | --- | --- |
| App | `src/` served by Vite as written, modules on demand | Bundled and hashed into `dist/client/` |
| Worker | `worker/src` in workerd, through `@cloudflare/vite-plugin` | Bundled into `dist/chordless/` |
| Service worker | Bundled per request, **empty precache** | Built once, with the **whole app precached** |
| Environment | `[env.dev]` in `wrangler.toml` (the dev pages) | The top level |

`vite.config.ts` has the settings, with the reasons beside them. Port 8787 is fixed because the
browser's data (IndexedDB, sign-in) belongs to the origin and the Tailscale funnel points at it.

## Layout

- `src/` is Vite's root: `index.html` (the only page that is built), `js/`, `components/`,
  `css/`, `service-worker.js`, and `dev/` (the playgrounds, not built).
- `public/` is copied as it is: the icons and the manifest.
- `dist/` is the output, and is not committed. `dist/client` is what is served, and
  `dist/chordless` the Worker with a generated `wrangler.json`.

## The service worker

`vite-plugins/service-worker.ts` builds `src/service-worker.ts` itself, because the app's
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
dev server can't show the production behaviour. `tests/built.playwright.ts` (the `built`
Playwright project) tests the build, served by `vite preview` on port 8788.

## First visit

A page that starts loading before the service worker is active is not controlled by it, and
the auth blob lives behind the worker. Where the worker's `clients.claim()` reaches the page (Chromium)
the page becomes controlled when the worker activates, with no reload. Where it does not (a
browser that ignores a page still loading), `public/boot.js` waits two seconds for the
`controllerchange` and then reloads once. `sessionStorage` `sw-first-load` is set from the start
and cleared when the page is controlled: tests wait for it to go (`waitForServiceWorker` in
`tests/fixtures.ts`; `openApp` does). Safari has not been tried without the reload: check it on a
device.

`index.html` has a `.boot-shell` in `#view-outlet`: the header's colours and the title, painted
before any script runs, so the first paint is not behind the JavaScript. The router replaces it
with the first view. What the first view needs is small (`index.html` lists it as `modulepreload`);
the preferences panel and Google auth are loaded when first used.

## Deploying

`just deploy` runs `vite build` then `wrangler deploy --config
dist/chordless/wrangler.json`. The plugin writes a redirect file for Wrangler under
`src/.wrangler`, where a deploy run from the repo root doesn't look, hence `--config`.

## Security headers

`public/_headers` is read by Cloudflare's static assets (and by `vite preview`, so the `built`
tests see it) and puts a Content-Security-Policy, `nosniff`, a referrer policy and a permissions
policy on every file. The dev server does not send them. It is not in the precache, and it is not
served.

The policy is enforced (`Content-Security-Policy`): the browser blocks what it doesn't allow and
logs "Refused to ..." in the console. To trial a change without blocking, send it as
`Content-Security-Policy-Report-Only` and watch the console. The `built` test opens every view and
fails on a violation. What the policy allows, and why, is in the comment at the top of the file.
When the app starts using a new host, add it there; the service worker script gets the same
header, so its `connect-src` must cover what it fetches.

The page has no inline script (`public/boot.js` is the one classic script), so scripts need no
`'unsafe-inline'`. Style attributes are allowed (`style-src-attr`), `<style>` elements are not.

## Gotchas

- `wrangler.toml` has `html_handling = "none"`. With the default, `/dev/x.html` redirects to
  `/dev/x`, and Vite's dev server then fails to serve the page's inline module script. The dev
  pages' scripts are files for the same reason (`src/dev/*.js`).
- Vite does not read `.browserslistrc`: `TARGET` in `vite.config.ts` is the same floor, and is
  used for the app and for the service worker. Change them together.
