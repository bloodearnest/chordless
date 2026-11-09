/**
 * Engraves a melody as sheet music, in a worker: `docs/MELODY.md`, "Rendering with Verovio". The page
 * gives MusicXML (from `writeMusicXml`) and gets SVG, one string a page. Verovio itself runs in
 * `verovio-worker.ts`, which is made on the first call and kept for the next, so the page never
 * compiles the WebAssembly (and its Content-Security-Policy need not allow that) and the 7 MB module is
 * not parsed on the thread the lyrics scroll on.
 */
import type { RenderedScore, RenderOptions } from './score-render-engine.ts'
import { withTextAccidentals } from './score-svg-text.ts'
import type { RenderReply, RenderRequest } from './verovio-worker.ts'

export type { RenderedScore, RenderOptions }

interface Pending {
  resolve(result: RenderedScore | null): void
  reject(error: Error): void
}

let worker: Worker | null = null
let nextId = 1
const pending = new Map<number, Pending>()

function start(): Worker {
  if (worker) return worker
  const made = new Worker(new URL('./verovio-worker.ts', import.meta.url), { type: 'module' })
  made.onmessage = ({ data }: MessageEvent<RenderReply>) => {
    const waiting = pending.get(data.id)
    if (!waiting) return
    pending.delete(data.id)
    if ('error' in data) waiting.reject(new Error(data.error))
    else
      waiting.resolve(
        data.result && { ...data.result, pages: data.result.pages.map(withTextAccidentals) }
      )
  }
  // A worker that fails (the file did not load, or the policy refused it) fails what waits on it, and
  // the next call makes a new one
  made.onerror = event => {
    const error = new Error(event.message || 'The sheet music engraver did not start')
    for (const waiting of pending.values()) waiting.reject(error)
    pending.clear()
    made.terminate()
    if (worker === made) worker = null
  }
  worker = made
  return made
}

/** The MusicXML as SVG pages, or null if Verovio could not read it. Rejects if the worker fails */
export function renderScore(
  musicXml: string,
  options: RenderOptions = {}
): Promise<RenderedScore | null> {
  return new Promise((resolve, reject) => {
    const id = nextId++
    pending.set(id, { resolve, reject })
    start().postMessage({ id, musicXml, options } satisfies RenderRequest)
  })
}
