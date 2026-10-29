/**
 * How the app makes spans (docs/OBSERVABILITY.md): few, wide ones, with what happened as
 * attributes. This is only the small API package, so any file may use it at no cost; the SDK that
 * sends them (start.ts) is loaded once the page is idle, and until it is, and whenever reports are
 * turned off, every call here does nothing.
 *
 * A browser has no async context: after an `await` there is no "active" span. So a span is held
 * where it is wanted, and `traced` with `trackCalls` keeps the one sync that runs at a time (sync
 * runs under a lock) for the calls made during it to be counted on.
 */
import {
  type Attributes,
  context,
  INVALID_SPAN_CONTEXT,
  type Span,
  SpanKind,
  SpanStatusCode,
  trace,
} from '@opentelemetry/api'
import { getTelemetryPreference } from '../preferences.ts'

const NAME = 'chordless'

/** What `traced` is given when reports are off: every call on it does nothing */
const NO_SPAN = trace.wrapSpanContext(INVALID_SPAN_CONTEXT)

type CallKind = 'drive' | 'worker'

interface CallStats {
  calls: Record<CallKind, number>
  ms: Record<CallKind, number>
  slowest: Record<CallKind, number>
  errors: number
}

const newStats = (): CallStats => ({
  calls: { drive: 0, worker: 0 },
  ms: { drive: 0, worker: 0 },
  slowest: { drive: 0, worker: 0 },
  errors: 0,
})

/** At most this many calls of one sync are spans of their own: a first sync can make hundreds, and they are still counted on the sync's span */
const MAX_CALL_SPANS = 200
/** How much of a call's query string is kept on its span */
const MAX_QUERY = 300
/** Errors reported in one visit: a loop of them is one problem, and spans are what Honeycomb bills */
const MAX_ERROR_SPANS = 20

let tracked: { span: Span; stats: CallStats; callSpans: number; sample: number } | null = null
let errorSpans = 0

const tracer = () => trace.getTracer(NAME)

const asError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error))

function recordFailure(span: Span, error: unknown): void {
  span.recordException(asError(error))
  span.setAttribute('chordless.error', true)
  span.setStatus({ code: SpanStatusCode.ERROR })
}

/**
 * Run `fn` in a span of its own, with what is known at the start as attributes, and `outcome` set
 * to `ok` or `error` by how it ends (an error is recorded and thrown again). With `trackCalls`,
 * the Drive and Worker calls made meanwhile (`timedFetch`) are counted on it.
 */
export async function traced<T>(
  name: string,
  attributes: Attributes,
  fn: (span: Span) => Promise<T> | T,
  { trackCalls = false, sample = 1 }: { trackCalls?: boolean; sample?: number } = {}
): Promise<T> {
  if (!getTelemetryPreference()) return fn(NO_SPAN)
  // Head sampling: one in `sample` is kept, with `SampleRate` so that Honeycomb counts it that many
  // times. One that is not kept is no span, and the calls it makes are no spans either (a call with
  // no sync to belong to would be a trace of its own)
  if (sample > 1 && Math.random() * sample >= 1) {
    const outer = tracked
    tracked = { span: NO_SPAN, stats: newStats(), callSpans: MAX_CALL_SPANS, sample }
    try {
      return await fn(NO_SPAN)
    } finally {
      tracked = outer
    }
  }
  const span = tracer().startSpan(name, {
    attributes: sample > 1 ? { ...attributes, SampleRate: sample } : attributes,
  })
  const outer = tracked
  const mine = trackCalls ? { span, stats: newStats(), callSpans: 0, sample } : null
  if (mine) tracked = mine
  try {
    const result = await fn(span)
    span.setAttribute('chordless.outcome', 'ok')
    return result
  } catch (error) {
    span.setAttribute('chordless.outcome', 'error')
    recordFailure(span, error)
    throw error
  } finally {
    if (mine) {
      const { calls, ms, slowest, errors } = mine.stats
      span.setAttributes({
        'chordless.sync.drive_calls': calls.drive,
        'chordless.sync.drive_ms_total': Math.round(ms.drive),
        'chordless.sync.drive_ms_max': Math.round(slowest.drive),
        'chordless.sync.worker_calls': calls.worker,
        'chordless.sync.errors': errors,
      })
      tracked = outer
    }
    span.end()
  }
}

/**
 * A step of the sync running now (reading the feed, checking access) as a span of its own, the
 * parent of the calls it makes: so a trace says which step each call belonged to. It is a child of
 * the sync, or of the step that holds it. Outside a sync, or in one that is not reported (not
 * sampled), it is no span and `fn` just runs.
 */
export async function phase<T>(
  name: string,
  attributes: Attributes,
  fn: (span: Span) => Promise<T> | T
): Promise<T> {
  const owner = tracked?.span
  if (!tracked || !owner || owner === NO_SPAN || !getTelemetryPreference()) return fn(NO_SPAN)
  const span = tracer().startSpan(
    name,
    { attributes: tracked.sample > 1 ? { ...attributes, SampleRate: tracked.sample } : attributes },
    trace.setSpan(context.active(), owner)
  )
  const state = tracked
  state.span = span
  try {
    const result = await fn(span)
    span.setAttribute('chordless.outcome', 'ok')
    return result
  } catch (error) {
    span.setAttribute('chordless.outcome', 'error')
    recordFailure(span, error)
    throw error
  } finally {
    state.span = owner
    span.end()
  }
}

/**
 * A span for something that happened, with its facts as attributes, made and ended at once (a setlist
 * opened or left): a span held open for as long as the person is in a setlist would be one nobody
 * can see until it ends, and lost with the tab.
 */
export function recordSpan(name: string, attributes: Attributes): void {
  if (!getTelemetryPreference()) return
  tracer().startSpan(name, { attributes }).end()
}

/**
 * A call to Drive or the Worker, counted on the sync running now, if one is. `status` is the HTTP
 * status, or 0 when there was no answer. (The totals stay on the sync's span, so that they are there
 * even if the calls' own spans are one day sampled.)
 */
export function countCall(kind: CallKind, ms: number, status: number): void {
  if (!tracked) return
  const { stats } = tracked
  stats.calls[kind]++
  stats.ms[kind] += ms
  stats.slowest[kind] = Math.max(stats.slowest[kind], ms)
  if (failed(status)) stats.errors++
}

/** A call that did not work: no answer, or a refusal (a 404 is Drive's way of saying there is no such file) */
const failed = (status: number): boolean => status === 0 || (status >= 400 && status !== 404)

/** A header set on a request init, whatever form its headers are in */
function withHeader(init: RequestInit | undefined, name: string, value: string): RequestInit {
  const headers = new Headers(init?.headers)
  headers.set(name, value)
  return { ...init, headers }
}

/** The size of a request body we hold (a stream is not read to find out) */
const bodySize = (body: BodyInit | null | undefined): number | undefined => {
  if (typeof body === 'string') return new TextEncoder().encode(body).byteLength
  if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) return body.byteLength
  if (body instanceof Blob) return body.size
  return undefined
}

const portOf = (url: URL): number =>
  url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80

const urlOf = (input: RequestInfo | URL): URL =>
  new URL(input instanceof Request ? input.url : String(input), location.href)

/**
 * `fetch`, with a span for each call (the client side of a boundary: a span is what the other side's
 * can be a child of) and the call counted on the sync running now (`countCall`). The span is a child
 * of the sync, or of `parent` where there is none (a token refresh); and with neither, a trace of its
 * own. A call to our Worker carries the span's own `traceparent`, so the Worker's span can be its
 * child: never to Google, which would need a CORS preflight and be told our trace ids.
 */
export function timedFetch(
  kind: CallKind,
  base: typeof fetch = (input, init) => fetch(input, init),
  parent?: () => Span | undefined
) {
  return (async (input, init) => {
    const started = performance.now()
    const owner = tracked?.span ?? parent?.()
    let span: Span | null = null
    let href = ''
    if (getTelemetryPreference() && (!tracked || tracked.callSpans < MAX_CALL_SPANS)) {
      if (tracked) tracked.callSpans++
      const url = urlOf(input)
      href = url.href
      span = tracer().startSpan(
        `chordless.${kind}.request`,
        {
          kind: SpanKind.CLIENT,
          attributes: {
            'http.request.method': (
              init?.method ?? (input instanceof Request ? input.method : 'GET')
            ).toUpperCase(),
            'url.scheme': url.protocol.slice(0, -1),
            'server.address': url.hostname,
            'server.port': portOf(url),
            'url.path': url.pathname,
            ...(bodySize(init?.body) !== undefined
              ? { 'http.request.body.size': bodySize(init?.body) }
              : {}),
            // (what a Drive listing asked for, the `q` of it, says why it was made)
            'url.query': url.search.slice(0, MAX_QUERY),
            // (a call of a sampled sync is counted as often as the sync is)
            ...(tracked && tracked.sample > 1 ? { SampleRate: tracked.sample } : {}),
          },
        },
        owner ? trace.setSpan(context.active(), owner) : undefined
      )
    }
    let request = init
    if (span && kind === 'worker') {
      const { traceId, spanId, traceFlags } = span.spanContext()
      request = withHeader(
        init,
        'traceparent',
        `00-${traceId}-${spanId}-${traceFlags.toString(16).padStart(2, '0')}`
      )
    }
    try {
      const response = await base(input, request)
      const ms = performance.now() - started
      countCall(kind, ms, response.status)
      finishCall(span, response.status, response.headers)
      // (a call to our own Worker is the page's own address: the browser says how big the answer was)
      if (span && kind === 'worker') endWhenSized(span, href, started)
      else span?.end()
      return response
    } catch (error) {
      countCall(kind, performance.now() - started, 0)
      if (span) {
        span.setAttribute('error.type', error instanceof Error ? error.name : '_OTHER')
        recordFailure(span, error)
      }
      span?.end()
      throw error
    }
  }) as typeof fetch
}

/** How long `endWhenSized` waits for the browser's entry of a call: it has one once the whole body is in */
let sizeWaitMs = 300
const SIZE_POLL_MS = 25
const claimedEntries = new WeakSet<PerformanceEntry>()

/** For tests: how long a call to the Worker waits for its sizes (none: it ends as soon as it is answered) */
export function setSizeWait(ms: number): void {
  sizeWaitMs = ms
}

/** The browser's resource entry of the call to `href` that began at `started` (`performance.now()`), not yet given to another */
function resourceEntryOf(href: string, started: number): PerformanceResourceTiming | undefined {
  let found: PerformanceResourceTiming | undefined
  let gap = 50
  for (const entry of performance.getEntriesByName(
    href,
    'resource'
  ) as PerformanceResourceTiming[]) {
    const wait = entry.startTime - started
    if (wait >= -1 && wait < gap && !claimedEntries.has(entry)) {
      found = entry
      gap = wait
    }
  }
  if (found) claimedEntries.add(found)
  return found
}

/**
 * End a call's span as of now, with what the browser knows of the answer's size once it has it: the
 * bytes on the wire (`http.response.body.size`, as compressed), what they came to (`chordless.http.response.decoded_body_size`) and with
 * the headers (`http.response.size`). Streamed or chunked answers have these too, which no header says.
 * If the entry does not come in a moment (a body nobody reads), the span ends without them.
 */
function endWhenSized(span: Span, href: string, started: number): void {
  const answered = Date.now()
  if (sizeWaitMs <= 0) {
    span.end(answered)
    return
  }
  const deadline = performance.now() + sizeWaitMs
  const look = () => {
    const entry = resourceEntryOf(href, started)
    if (entry) {
      if (entry.encodedBodySize > 0)
        span.setAttribute('http.response.body.size', entry.encodedBodySize)
      if (entry.decodedBodySize > 0) {
        span.setAttribute('chordless.http.response.decoded_body_size', entry.decodedBodySize)
      }
      if (entry.transferSize > 0) span.setAttribute('http.response.size', entry.transferSize)
      span.end(answered)
    } else if (performance.now() >= deadline) span.end(answered)
    else setTimeout(look, SIZE_POLL_MS)
  }
  look()
}

/** The call is over: its status on the span, and an error if it failed (the caller ends it) */
function finishCall(span: Span | null, status: number, headers: Headers): void {
  if (!span) return
  span.setAttribute('http.response.status_code', status)
  // (a response with no Content-Length, or none that a cross-origin page may read, has no size)
  const length = headers.get('Content-Length')
  if (length !== null && Number.isFinite(Number(length))) {
    span.setAttribute('http.response.body.size', Number(length))
  }
  // Cloudflare's Worker spans do not join our trace (they ignore `traceparent`): the ray id is the
  // join, the same value as `cloudflare.ray_id` on the Worker's span (the header is `<id>-<colo>`)
  const ray = headers.get('cf-ray')
  if (ray) span.setAttribute('cloudflare.ray_id', ray.split('-')[0])
  if (failed(status)) {
    span.setAttribute('error.type', String(status))
    span.setAttribute('chordless.error', true)
    span.setStatus({ code: SpanStatusCode.ERROR })
  }
}

/**
 * Report an error the app did not handle, or told the person about (a toast), as a span of its own:
 * no span is "active" after an `await`, and a stray error belongs to no sync. Up to a few a visit.
 */
export function reportError(error: unknown, attributes: Attributes = {}): void {
  if (!getTelemetryPreference() || errorSpans >= MAX_ERROR_SPANS) return
  errorSpans++
  const span = tracer().startSpan('chordless.error', { attributes })
  recordFailure(span, error)
  span.end()
}

/** Start counting afresh (tests) */
export function resetTelemetryState(): void {
  tracked = null
  errorSpans = 0
}
