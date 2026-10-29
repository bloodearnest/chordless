/**
 * How the app makes spans (docs/OBSERVABILITY.md): few, wide ones, with what happened as
 * attributes. This is only the small API package, so any file may use it at no cost; the SDK that
 * sends them (start.ts) is loaded once the page is idle, and until it is, and whenever reports are
 * turned off, every call here does nothing.
 *
 * A browser has no async context: after an `await` there is no "active" span. So a span is held
 * where it is wanted: `traced` with `trackCalls` keeps the one sync that runs at a time (sync runs
 * under a lock), and the calls it makes (`timedFetch`) are made with it as their parent, which the
 * fetch instrumentation (fetch.ts) then makes spans of. Which syncs are reported is the sampler's
 * (sampler.ts), by the trace, so a call below a sync that is not reported is not either.
 */
import {
  type Attributes,
  context,
  INVALID_SPAN_CONTEXT,
  type Span,
  SpanStatusCode,
  TraceFlags,
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
/** One in this many `tick` syncs is reported: they are the many, and mostly find nothing (the sampler, sampler.ts) */
export const TICK_SAMPLE = 10
/** Errors reported in one visit: a loop of them is one problem, and spans are what Honeycomb bills */
const MAX_ERROR_SPANS = 20

let tracked: { span: Span; stats: CallStats; callSpans: number } | null = null
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
  // (whether it is reported is the sampler's, by what it is given here: a span it does not report
  // is still one, and what is made below it is not reported either)
  const span = tracer().startSpan(name, { attributes })
  const outer = tracked
  const mine = trackCalls ? { span, stats: newStats(), callSpans: 0 } : null
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
 * the sync, or of the step that holds it. Outside a sync it is no span and `fn` just runs. (In a sync
 * that is not reported it is a span the sampler does not report.)
 */
export async function phase<T>(
  name: string,
  attributes: Attributes,
  fn: (span: Span) => Promise<T> | T
): Promise<T> {
  const owner = tracked?.span
  if (!tracked || !owner || !getTelemetryPreference()) return fn(NO_SPAN)
  const span = tracer().startSpan(name, { attributes }, trace.setSpan(context.active(), owner))
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

/**
 * `fetch`, for the Drive and Worker calls of the sync, the token refresh and the pages: the call is
 * counted on the sync running now (`countCall`), and made with the sync (or `parent`, where there is
 * none: a token refresh) as the active span, which the fetch instrumentation (fetch.ts) makes the
 * parent of the call's span. Past the budget of a sync the calls are made as if the sync were not
 * reported, so they are not either.
 */
export function timedFetch(
  kind: CallKind,
  base: typeof fetch = (input, init) => fetch(input, init),
  parent?: () => Span | undefined
) {
  return (async (input, init) => {
    const started = performance.now()
    const owner = tracked?.span ?? parent?.()
    let parentContext = owner ? trace.setSpan(context.active(), owner) : context.active()
    if (owner && tracked) {
      if (tracked.callSpans >= MAX_CALL_SPANS) {
        parentContext = trace.setSpanContext(context.active(), {
          ...owner.spanContext(),
          traceFlags: TraceFlags.NONE,
        })
      } else tracked.callSpans++
    }
    try {
      const response = await context.with(parentContext, () => base(input, init))
      countCall(kind, performance.now() - started, response.status)
      return response
    } catch (error) {
      countCall(kind, performance.now() - started, 0)
      throw error
    }
  }) as typeof fetch
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
