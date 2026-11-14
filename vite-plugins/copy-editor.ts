import { readFile, writeFile } from 'node:fs/promises'
import type { IncomingMessage } from 'node:http'
import { join } from 'node:path'
import type { Plugin } from 'vite'
import { fluentOf, listMessages, replaceMessage } from './copy-catalogue.ts'

/** The header the editor's requests carry: a page on another origin cannot send it without being asked first */
const HEADER = 'x-chordless-copy'

/** The dev server answers to `localhost` and this machine's other names (a Tailscale one); only the first is trusted to write */
const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/

/**
 * Editing the app's words in the running dev server (docs/COPY.md): puts the editor
 * (src/js/copy-editor.ts) on every page, and answers its two requests, the list of messages and the
 * change of one, by rewriting src/text/en.ts. Vite's hot reload takes the new file into the page.
 *
 * It writes a file of the repository, so it is for the person at this computer only: dev only, only
 * when the page was reached as localhost (not by the Tailscale name the dev server is also
 * reachable by), and only by a request that only the app's own script makes.
 */
export function copyEditor(): Plugin {
  return {
    name: 'chordless:copy-editor',
    apply: 'serve',
    transformIndexHtml: () => [
      // (first, so that it sees the first messages the app says)
      {
        tag: 'script',
        attrs: { type: 'module', src: '/js/copy-editor.ts' },
        injectTo: 'head-prepend',
      },
    ],
    // The catalogue is not a module for Vite to hot reload (that would have the app's own modules
    // import Vite's client, which the dev service worker does not have cached when offline): the
    // pages are sent what it says, and take it themselves
    async hotUpdate({ file, read, server }) {
      if (file !== join(server.config.root, 'text', 'en.ts')) return
      server.ws.send({
        type: 'custom',
        event: 'chordless:copy',
        data: { source: fluentOf(await read()) },
      })
      return []
    },
    configureServer(server) {
      const file = join(server.config.root, 'text', 'en.ts')

      server.middlewares.use('/__copy', async (req, res) => {
        const reply = (status: number, body: unknown) => {
          res.statusCode = status
          res.setHeader('Content-Type', 'application/json')
          res.setHeader('Cache-Control', 'no-store')
          res.end(JSON.stringify(body))
        }
        if (!LOCAL.test(req.headers.host ?? '') || req.headers[HEADER] !== '1') {
          return reply(403, { error: 'The editor is for the dev server at localhost.' })
        }
        try {
          if (req.method === 'GET') {
            return reply(200, { messages: listMessages(await readFile(file, 'utf8')) })
          }
          if (req.method !== 'POST') return reply(405, { error: 'GET or POST' })
          const { id, source } = JSON.parse(await bodyOf(req)) as { id?: string; source?: string }
          if (typeof id !== 'string' || typeof source !== 'string') {
            return reply(400, { error: 'It needs an id and a source.' })
          }
          const next = replaceMessage(await readFile(file, 'utf8'), id, source)
          await writeFile(file, next)
          return reply(200, { ok: true })
        } catch (error) {
          return reply(400, { error: error instanceof Error ? error.message : String(error) })
        }
      })
    },
  }
}

async function bodyOf(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}
