import { cloudflare } from '@cloudflare/vite-plugin'
import { defineConfig } from 'vite'
import { serviceWorker } from './vite-plugins/service-worker.js'

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
    build: { outDir: '../dist', emptyOutDir: true },
    // Port 8787 is the origin the browser's data (IndexedDB, sign-in) belongs to, and the
    // one the Tailscale funnel points at: keep it
    server: { port: 8787, strictPort: true },
    // Pre-bundle every dependency at start-up: finding one later reloads the page mid-test
    optimizeDeps: { entries: ['index.html', 'dev/*.html', 'components/**/*.js', 'js/**/*.js'] },
    plugins: [serviceWorker(), cloudflare({ configPath: '../wrangler.toml' })],
  }
})
