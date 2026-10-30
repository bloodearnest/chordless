import { fileURLToPath } from 'node:url'
import { cloudflare } from '@cloudflare/vite-plugin'
import { defineConfig } from 'vite'
import { devManifest } from './vite-plugins/dev-manifest.ts'
import { preloadHome } from './vite-plugins/preload-home.ts'
import { serviceWorker } from './vite-plugins/service-worker.ts'

// The floor, the same as .browserslistrc (which Vite does not read)
const TARGET = ['safari17.4', 'chrome120', 'edge120']

// The app is in src/, the static files it links to (icons, manifest) in public/.
// The Cloudflare plugin runs the Worker (worker/src) next to it, in workerd, so dev
// is the same shape as production: one server, one origin.
//
// Except for `just serve-live`, which sets CHORDLESS_WORKER_URL: the plugin cannot pass a WebSocket
// upgrade to the Worker (live sync, docs/LIVE_SYNC.md), so there the Worker is `wrangler dev` in its
// own process and this server hands the Worker's paths to it, upgrades included. Still one origin.
const WORKER_URL = process.env.CHORDLESS_WORKER_URL

export default defineConfig(({ command, isPreview }) => {
  // `npm run dev` uses wrangler.toml's [env.dev] (the dev pages); a build, and previewing
  // one, use the top level
  if (command === 'serve' && !isPreview && !WORKER_URL) process.env.CLOUDFLARE_ENV ??= 'dev'

  return {
    root: 'src',
    // (the .env.development / .env.production files are at the top: Vite looks in `root` by default)
    envDir: fileURLToPath(new URL('.', import.meta.url)),
    publicDir: '../public',
    // A server started for the tests (CHORDLESS_PORT) keeps its dependency cache apart: sharing
    // one with the development server on 8787 makes each rewrite the other's, and the browser
    // is left with "504 Outdated Optimize Dep" and a blank page
    ...(process.env.CHORDLESS_PORT && {
      cacheDir: fileURLToPath(
        new URL(`./node_modules/.vite-${process.env.CHORDLESS_PORT}`, import.meta.url)
      ),
    }),
    build: {
      outDir: '../dist',
      emptyOutDir: true,
      target: TARGET,
      // The one chunk over the default 500 kB is pdf.js (1.6 MB), already its own lazily loaded
      // chunk and not precached (see NOT_PRECACHED): it is as split as it can be. The limit is
      // just above it, so a second large chunk still warns.
      chunkSizeWarningLimit: 1700,
    },
    // The app, and the two policy pages (documents: they link the same stylesheet and theme).
    // For the browser's build only: the Worker's has its own entry.
    environments: {
      client: {
        build: {
          rollupOptions: {
            input: Object.fromEntries(
              ['index', 'privacy', 'terms'].map(page => [
                page,
                fileURLToPath(new URL(`./src/${page}.html`, import.meta.url)),
              ])
            ),
          },
        },
      },
    },
    // Port 8787 is the origin the browser's data (IndexedDB, sign-in) belongs to, and the
    // one the Tailscale funnel points at: keep it for development (the tests set CHORDLESS_PORT
    // to run their own server on another port). Vite refuses requests whose Host it does not
    // know (against DNS rebinding), so the machine's Tailscale name is listed.
    server: {
      port: Number(process.env.CHORDLESS_PORT) || 8787,
      strictPort: true,
      allowedHosts: ['casey.tail030f3.ts.net'],
      // The paths the Worker answers before the static files (wrangler.toml's run_worker_first).
      // The Host is kept, so that the Worker sees the origin the page has and its cross-origin check agrees.
      // (/s/ and /dev stay here: the Worker would serve the unbuilt files, where this server transforms them.)
      ...(WORKER_URL && {
        proxy: Object.fromEntries(
          ['/oauth', '/session', '/api'].map(path => [path, { target: WORKER_URL, ws: true }])
        ),
      }),
    },
    // Pre-bundle every dependency at start-up: finding one later reloads the page mid-test
    optimizeDeps: {
      entries: ['index.html', 'dev/*.html', 'components/**/*.{js,ts}', 'js/**/*.{js,ts}'],
    },
    plugins: [
      devManifest(),
      preloadHome(),
      serviceWorker({ target: TARGET }),
      ...(WORKER_URL ? [] : [cloudflare({ configPath: '../wrangler.toml' })]),
    ],
  }
})
