import { fileURLToPath } from 'node:url'
import { cloudflare } from '@cloudflare/vite-plugin'
import { defineConfig } from 'vite'
import { devManifest } from './vite-plugins/dev-manifest.ts'
import { serviceWorker } from './vite-plugins/service-worker.ts'

// The floor, the same as .browserslistrc (which Vite does not read)
const TARGET = ['safari17', 'chrome120', 'edge120']

// The app is in src/, the static files it links to (icons, manifest) in public/.
// The Cloudflare plugin runs the Worker (worker/src) next to it, in workerd, so dev
// is the same shape as production: one server, one origin.
export default defineConfig(({ command, isPreview }) => {
  // `npm run dev` uses wrangler.toml's [env.dev] (the dev pages); a build, and previewing
  // one, use the top level
  if (command === 'serve' && !isPreview) process.env.CLOUDFLARE_ENV ??= 'dev'

  return {
    root: 'src',
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
    },
    // Port 8787 is the origin the browser's data (IndexedDB, sign-in) belongs to, and the
    // one the Tailscale funnel points at: keep it for development (the tests set CHORDLESS_PORT
    // to run their own server on another port). Vite refuses requests whose Host it does not
    // know (against DNS rebinding), so the machine's Tailscale name is listed.
    server: {
      port: Number(process.env.CHORDLESS_PORT) || 8787,
      strictPort: true,
      allowedHosts: ['casey.tail030f3.ts.net'],
    },
    // Pre-bundle every dependency at start-up: finding one later reloads the page mid-test
    optimizeDeps: {
      entries: ['index.html', 'dev/*.html', 'components/**/*.{js,ts}', 'js/**/*.{js,ts}'],
    },
    plugins: [
      devManifest(),
      serviceWorker({ target: TARGET }),
      cloudflare({ configPath: '../wrangler.toml' }),
    ],
  }
})
