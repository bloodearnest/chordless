// Builds src/service-worker.ts as a classic (non-module) script, so it also runs where
// module service workers don't (Chrome before 91, older Firefox), with its one import bundled in.
//
// In a production build it also injects the precache: every file the build emitted, so the
// whole app, including the views loaded on demand, is cached when the worker installs and
// works offline from the first visit. The cache's name carries a hash of those files, so a
// changed build is a changed worker, and the old cache goes when the new one takes over.
//
// In dev the precache is empty (Vite serves modules on demand) and the worker is bundled
// per request.

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { build, type Plugin } from 'vite'

const FILE = 'service-worker.js'
// Never precached: the worker itself, Cloudflare's asset filter and headers file (which it
// reads and does not serve), source maps
const NOT_PRECACHED = (path: string) =>
  path === FILE || path === '.assetsignore' || path === '_headers' || path.endsWith('.map')

async function bundle(
  root: string,
  precache: string[],
  version: string,
  { minify, target, released }: { minify: boolean; target?: string[]; released: string }
) {
  const result = await build({
    root,
    configFile: false,
    publicDir: false,
    logLevel: 'warn',
    define: {
      __PRECACHE__: JSON.stringify(precache),
      __CACHE_VERSION__: JSON.stringify(version),
      __RELEASE_DATE__: JSON.stringify(released),
    },
    build: {
      write: false,
      minify,
      target,
      lib: {
        entry: join(root, 'service-worker.ts'),
        formats: ['iife'],
        name: 'chordlessServiceWorker',
      },
    },
  })
  const built = Array.isArray(result) ? result[0] : result
  if (!('output' in built)) throw new Error('The service worker build gave no output')
  const chunk = built.output[0]
  if (chunk.type !== 'chunk') throw new Error('The service worker build gave no script')
  return chunk.code
}

function listFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? listFiles(join(dir, entry.name)) : [join(dir, entry.name)]
  )
}

/**
 * When the files of the app last changed: the date of the last commit to anything that ends up in
 * the build. Not the time of the build, which would make a rebuild of the same files look like a
 * new version; and a commit of notes or docs does not move it. An ISO date, or '' with no git.
 */
function releaseDate(projectRoot: string): string {
  try {
    return execFileSync(
      'git',
      [
        'log',
        '-1',
        '--format=%cI',
        '--',
        'src',
        'public',
        'package-lock.json',
        'vite.config.ts',
        'vite-plugins',
      ],
      { cwd: projectRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    ).trim()
  } catch {
    return ''
  }
}

/** The URLs to precache, and a hash of their contents */
function precacheFor(outDir: string) {
  const hash = createHash('sha256')
  const urls: string[] = []
  for (const file of listFiles(outDir).sort()) {
    const path = relative(outDir, file).split(sep).join('/')
    if (NOT_PRECACHED(path)) continue
    // The app shell is served at /, whatever URL the visitor asked for
    urls.push(path === 'index.html' ? '/' : `/${path}`)
    hash.update(path).update(readFileSync(file))
  }
  return { urls, version: hash.digest('hex').slice(0, 12) }
}

/** `target` is the build target of the rest of the app, so the worker matches it */
export function serviceWorker({ target }: { target?: string[] } = {}): Plugin {
  let root: string
  let released = ''
  return {
    name: 'chordless:service-worker',

    configResolved(config) {
      root = config.root
      // The app is in src/, one below the project
      released = releaseDate(join(config.root, '..'))
    },

    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url?.split('?')[0] !== `/${FILE}`) return next()
        try {
          const code = await bundle(root, [], 'dev', { minify: false, target, released })
          res.setHeader('Content-Type', 'text/javascript')
          res.setHeader('Cache-Control', 'no-cache')
          res.end(code)
        } catch (error) {
          next(error)
        }
      })
    },

    async writeBundle(options) {
      if (this.environment?.name !== 'client') return
      if (!options.dir) return
      const { urls, version } = precacheFor(options.dir)
      const code = await bundle(root, urls, version, { minify: true, target, released })
      writeFileSync(join(options.dir, FILE), code)
    },
  }
}
