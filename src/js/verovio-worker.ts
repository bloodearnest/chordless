/**
 * The worker Verovio runs in. Its file name starts with `verovio-` because `public/_headers` gives
 * the files that do a Content-Security-Policy of their own, with `'wasm-unsafe-eval'` (which the
 * WebAssembly needs) and nothing the page has: the page itself does not allow it. A worker has the
 * policy of its own response, not of the page that made it.
 *
 * It answers one kind of message, `{ id, musicXml, options }`, with `{ id, result }`, or
 * `{ id, error }` if rendering threw. `score-render.ts` is the page's end of it.
 */
import { type RenderedScore, type RenderOptions, renderScoreHere } from './score-render-engine.ts'

export interface RenderRequest {
  id: number
  musicXml: string
  options: RenderOptions
}
export type RenderReply =
  | { id: number; result: RenderedScore | null }
  | { id: number; error: string }

// (the worker's global, typed as far as it is used: this project's tsconfig has no worker library)
const scope = self as unknown as {
  onmessage: ((event: { data: RenderRequest }) => void) | null
  postMessage(message: RenderReply): void
}

scope.onmessage = async ({ data }) => {
  try {
    scope.postMessage({ id: data.id, result: await renderScoreHere(data.musicXml, data.options) })
  } catch (error) {
    scope.postMessage({ id: data.id, error: String(error) })
  }
}
