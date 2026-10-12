import type { Plugin } from 'vite'

/**
 * The web app manifest as the dev server (and the servers the tests start) serve it: named
 * "Chordless (dev)", with a purple theme colour. Installed from localhost, the app is then not
 * a second "Chordless" next to the real one: in the apps menu, the file manager's Open With,
 * and its window's title bar. The built app's manifest (public/manifest.webmanifest) is untouched.
 */
export function devManifest(): Plugin {
  return {
    name: 'chordless:dev-manifest',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url?.split('?')[0] !== '/manifest.webmanifest') return next()
        try {
          const { readFile } = await import('node:fs/promises')
          const { join } = await import('node:path')
          const manifest = JSON.parse(
            await readFile(join(server.config.publicDir, 'manifest.webmanifest'), 'utf8')
          )
          manifest.name = 'Chordless (dev)'
          manifest.short_name = 'Chordless dev'
          manifest.theme_color = '#7d3c98'
          res.setHeader('Content-Type', 'application/manifest+json')
          res.setHeader('Cache-Control', 'no-cache')
          res.end(JSON.stringify(manifest))
        } catch (error) {
          next(error)
        }
      })
    },
  }
}
