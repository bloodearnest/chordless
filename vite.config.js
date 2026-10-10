import { cloudflare } from '@cloudflare/vite-plugin'
import { defineConfig } from 'vite'

// The app is in src/, the static files it links to (icons, manifest) in public/.
// The Cloudflare plugin runs the Worker (worker/src) next to it, in workerd, so dev
// is the same shape as production: one server, one origin.
export default defineConfig(({ command }) => {
  // `npm run dev` uses wrangler.toml's [env.dev] (the dev pages); a build uses the top level
  if (command === 'serve') process.env.CLOUDFLARE_ENV ??= 'dev'

  return {
    root: 'src',
    publicDir: '../public',
    // Port 8787 is the origin the browser's data (IndexedDB, sign-in) belongs to, and the
    // one the Tailscale funnel points at: keep it
    server: { port: 8787, strictPort: true },
    // Pre-bundle every dependency at start-up: finding one later reloads the page mid-test
    optimizeDeps: { entries: ['index.html', 'dev/*.html', 'components/**/*.js', 'js/**/*.js'] },
    plugins: [cloudflare({ configPath: '../wrangler.toml' })],
  }
})
