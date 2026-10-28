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
  INVALID_SPAN_CONTEXT,
  type Span,
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
  events: number
}

const newStats = (): CallStats => ({
  calls: { drive: 0, worker: 0 },
  ms: { drive: 0, worker: 0 },
  slowest: { drive: 0, worker: 0 },
  errors: 0,
  events: 0,
})

/** A call slower than this, or one that failed, is an event on the span (up to MAX_CALL_EVENTS) */
const SLOW_CALL_MS = 2000
const MAX_CALL_EVENTS = 10
/** Errors reported in one visit: a loop of them is one problem, and spans are what Honeycomb bills */
const MAX_ERROR_SPANS = 20

let tracked: { span: Span; stats: CallStats } | null = null
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
  { trackCalls = false }: { trackCalls?: boolean } = {}
): Promise<T> {
  if (!getTelemetryPreference()) return fn(NO_SPAN)
  const span = tracer().startSpan(name, { attributes })
  const outer = tracked
  const mine = trackCalls ? { span, stats: newStats() } : null
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
 * A span for something that happened, with its facts as attributes, made and ended at once (a setlist
 * opened or left): a span held open for as long as the person is in a setlist would be one nobody
 * can see until it ends, and lost with the tab.
 */
export function recordSpan(name: string, attributes: Attributes): void {
  if (!getTelemetryPreference()) return
  tracer().startSpan(name, { attributes }).end()
}

/**
 * A call to Drive or the Worker, counted on the sync running now, if one is. A failure or a slow
 * one is also an event, so the few that matter are told apart without a span for every request.
 * `status` is the HTTP status, or 0 when there was no answer.
 */
export function countCall(kind: CallKind, ms: number, status: number): void {
  if (!tracked) return
  const { span, stats } = tracked
  stats.calls[kind]++
  stats.ms[kind] += ms
  stats.slowest[kind] = Math.max(stats.slowest[kind], ms)
  const failed = status === 0 || status >= 400
  if (failed) stats.errors++
  if ((failed || ms >= SLOW_CALL_MS) && stats.events < MAX_CALL_EVENTS) {
    stats.events++
    span.addEvent('chordless.call', {
      'chordless.call.kind': kind,
      'chordless.call.ms': Math.round(ms),
      'chordless.call.status': status,
    })
  }
}

/** `fetch`, counting each call as one of `kind` (see `countCall`) */
export function timedFetch(
  kind: CallKind,
  base: typeof fetch = (input, init) => fetch(input, init)
) {
  return (async (input, init) => {
    const started = performance.now()
    try {
      const response = await base(input, init)
      countCall(kind, performance.now() - started, response.status)
      return response
    } catch (error) {
      countCall(kind, performance.now() - started, 0)
      throw error
    }
  }) as typeof fetch
}

/**
 * The `traceparent` to send a call to our Worker with, so that its span is in the sync's trace; null
 * when no sync is running or reports are off. Never for any other server: it would start a CORS
 * preflight, and tell a third party our trace ids.
 */
export function traceparent(): string | null {
  if (!tracked || !getTelemetryPreference()) return null
  const { traceId, spanId, traceFlags } = tracked.span.spanContext()
  return `00-${traceId}-${spanId}-${traceFlags.toString(16).padStart(2, '0')}`
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
