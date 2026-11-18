import { readFile } from 'node:fs/promises'
import type { Plugin } from 'vite'

/** Where the page asks for the seed (src/js/preview-seed.ts) */
export const SEED_PATH = '/__preview-seed.zip'

/**
 * The export a branch preview starts from (docs/PREVIEWS.md): `just branch-preview` sets
 * CHORDLESS_SEED_ZIP to the file (test-export.zip at the top of the primary checkout), and the dev
 * server hands it to the page, which imports it into an empty Personal space. The file is read at
 * each request, so keeping it up to date is all it takes.
 *
 * Dev server only (`apply: 'serve'`): a build has no such route. Without the variable, or the file,
 * the answer is a 404, which the page takes as "no seed". The file holds charts, so it stays on this
 * disk and goes out only over the tailnet the preview is served on.
 */
export function previewSeed(): Plugin {
  return {
    name: 'chordless:preview-seed',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(SEED_PATH, async (_req, res) => {
        const file = process.env.CHORDLESS_SEED_ZIP
        const bytes = file ? await readFile(file).catch(() => null) : null
        res.setHeader('Cache-Control', 'no-store')
        if (!bytes) {
          res.statusCode = 404
          res.end()
          return
        }
        res.setHeader('Content-Type', 'application/zip')
        res.end(bytes)
      })
    },
  }
}
