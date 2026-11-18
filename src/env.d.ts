// Constants the service worker's build defines (see vite-plugins/service-worker.js)
declare const __PRECACHE__: string[]
declare const __CACHE_VERSION__: string
declare const __DEFERRED__: Record<string, string>
declare const __RELEASE_DATE__: string

// What Vite puts in `import.meta.env` from .env.development (`npm run dev`) and .env.production
// (`vite build`): the Google Cloud project the page signs in with and picks folders from
// (docs/ENVIRONMENTS.md). The browser unit tests get the development ones from
// web-test-runner.config.js; the node tests (the Worker's, which reach this code) have no Vite.
interface ImportMetaEnv {
  readonly VITE_GOOGLE_CLIENT_ID?: string
  readonly VITE_PICKER_APP_ID?: string
  readonly VITE_DRIVE_ROOT_FOLDER?: string
  /** 'development' for `npm run dev`, 'production' for a build */
  readonly MODE?: string
  /** True only in the dev server: Vite drops what is behind it from a build (js/preview-seed.ts) */
  readonly DEV?: boolean
}
interface ImportMeta {
  readonly env?: ImportMetaEnv
  /** Vite's hot reload: only in the dev server (js/copy-editor.ts takes a rewritten catalogue with it) */
  readonly hot?: {
    on(event: string, callback: (data: { source: string }) => void): void
  }
}

// Verovio ships no types; these are the two modules score-render-engine.ts imports
declare module 'verovio/wasm' {
  const createModule: () => Promise<unknown>
  export default createModule
}
declare module 'verovio/esm' {
  export class VerovioToolkit {
    constructor(module: unknown)
  }
  export function enableLogToBuffer(value: number, module: unknown): void
}
