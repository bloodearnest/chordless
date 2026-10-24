// Constants the service worker's build defines (see vite-plugins/service-worker.js)
declare const __PRECACHE__: string[]
declare const __CACHE_VERSION__: string
declare const __RELEASE_DATE__: string

// What Vite puts in `import.meta.env` from .env.development (`npm run dev`) and .env.production
// (`vite build`): the Google Cloud project the page signs in with and picks folders from
// (docs/ENVIRONMENTS.md). The browser unit tests get the development ones from
// web-test-runner.config.js; the node tests (the Worker's, which reach this code) have no Vite.
interface ImportMetaEnv {
  readonly VITE_GOOGLE_CLIENT_ID?: string
  readonly VITE_PICKER_APP_ID?: string
}
interface ImportMeta {
  readonly env?: ImportMetaEnv
}
