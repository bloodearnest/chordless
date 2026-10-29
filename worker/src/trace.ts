/**
 * The Worker's own span for a call that carries the page's `traceparent` (docs/OBSERVABILITY.md).
 * Cloudflare's native spans ignore the header and are roots of their own, so for the page's calls
 * the Worker makes one that is a real child of the page's call span: the context is read by the W3C
 * propagator, and the span is made by the OTel SDK with it as parent, with the facts the runtime gives
 * us. It goes to the same destination as the page's traces (an exporter that is `forward`), after the
 * response is made, and never changes it.
 */

import {
  type Attributes,
  context,
  createContextKey,
  defaultTextMapGetter,
  ROOT_CONTEXT,
  type Span,
  SpanKind,
  SpanStatusCode,
  type Tracer,
  trace,
} from '@opentelemetry/api'
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks'
import { type ExportResult, ExportResultCode, W3CTraceContextPropagator } from '@opentelemetry/core'
import { JsonTraceSerializer } from '@opentelemetry/otlp-transformer'
import { resourceFromAttributes } from '@opentelemetry/resources'
import {
  BatchSpanProcessor,
  type ReadableSpan,
  type SpanExporter,
  TracerProvider,
} from '@opentelemetry/sdk-trace'
import type { Env } from './env.ts'
import { forward, parseHeaders, type TelemetryDeps, withinLimit } from './telemetry.ts'

/** Where our spans are found in Honeycomb: a dataset of their own, apart from the native `chordless` */
export const SERVICE_NAME = 'chordless-worker'

/** A path segment that is an id (a Drive id, a UUID, a share id), not a name */
const ID_SEGMENT = /^[A-Za-z0-9_-]{16,}$|^[0-9a-f]{8}-[0-9a-f-]{27}$/

interface CloudflareProperties {
  colo?: string
  asn?: number
  country?: string
  continent?: string
  region?: string
  city?: string
  timezone?: string
}

const propagator = new W3CTraceContextPropagator()

/** The path as a template, ids replaced: what the route was, not which file or space it was for */
export function routeOf(path: string): string {
  return path
    .split('/')
    .map(segment => (ID_SEGMENT.test(segment) ? ':id' : segment))
    .join('/')
}

/**
 * Sends the spans of the one request to the destination, as OTLP/JSON, the way the page's traces go,
 * once `allowed` says the sender is within the limit
 */
class ForwardingExporter implements SpanExporter {
  #endpoint: string
  #headers: string
  #deps: TelemetryDeps | undefined
  #allowed: Promise<boolean>

  constructor(
    endpoint: string,
    headers: string,
    deps: TelemetryDeps | undefined,
    allowed: Promise<boolean>
  ) {
    this.#endpoint = endpoint
    this.#headers = headers
    this.#deps = deps
    this.#allowed = allowed
  }

  export(spans: ReadableSpan[], done: (result: ExportResult) => void): void {
    const body = JsonTraceSerializer.serializeRequest(spans)
    this.#allowed
      .then(allowed =>
        allowed
          ? forward(
              JSON.parse(new TextDecoder().decode(body)),
              this.#endpoint,
              parseHeaders(this.#headers),
              this.#deps
            )
          : undefined
      )
      .then(() => done({ code: ExportResultCode.SUCCESS }))
  }

  shutdown(): Promise<void> {
    return Promise.resolve()
  }
}

type Value = string | number | undefined

/** What the context of a request being traced holds: its tracer, and how many spans it has made below ours */
interface Tracing {
  tracer: Tracer
  children: number
}
const TRACING = createContextKey('chordless.worker.tracing')

/** The calls of one request that are spans: a request makes a few, and spans are what Honeycomb bills */
const MAX_CHILD_SPANS = 50

/** Async context in the Worker (nodejs_compat's AsyncLocalStorage): the span of a request is the active one for what it awaits */
context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable())

/** A span for a call made while a request is traced, or null when none is (then nothing is done) */
function startCall(name: string, attributes: Attributes): Span | null {
  const tracing = context.active().getValue(TRACING) as Tracing | undefined
  if (!tracing || tracing.children >= MAX_CHILD_SPANS) return null
  tracing.children++
  return tracing.tracer.startSpan(name, { kind: SpanKind.CLIENT, attributes }, context.active())
}

function failed(span: Span, error: unknown): void {
  span.recordException(error instanceof Error ? error : new Error(String(error)))
  span.setStatus({ code: SpanStatusCode.ERROR })
}

/**
 * `fetch`, with a span for each call made while a request is traced, ended when the response
 * arrives (its headers: the body is not read, so a stream goes through as it was). The method, the
 * host and the path are kept, and never the query; no trace context is sent on (not to Google).
 */
export function tracedFetch(
  base: typeof fetch = (input, init) => fetch(input, init)
): typeof fetch {
  return (async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    const span = startCall('chordless.worker.fetch', {
      'http.request.method': (
        init?.method ?? (input instanceof Request ? input.method : 'GET')
      ).toUpperCase(),
      'server.address': url.hostname,
      'url.path': url.pathname,
    })
    if (!span) return base(input, init)
    let response: Response
    try {
      response = await base(input, init)
    } catch (error) {
      failed(span, error)
      span.end()
      throw error
    }
    span.setAttribute('http.response.status_code', response.status)
    // (a 404 is how Drive says there is no such file)
    if (response.status >= 400 && response.status !== 404) {
      span.setStatus({ code: SpanStatusCode.ERROR })
    }
    span.end()
    return response
  }) as typeof fetch
}

/**
 * A Durable Object's stub with a span for each call made through it while a request is traced
 * (`chordless.worker.do`, the method and the object's class), ended when the call is answered
 */
export function tracedStub<T extends object>(stub: T, className: string): T {
  return new Proxy(stub, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver)
      // (`then` is not a method: the stub is awaited sometimes, and must not look like a promise)
      if (typeof value !== 'function' || typeof property !== 'string' || property === 'then') {
        return value
      }
      return (...args: unknown[]) => {
        const span = startCall('chordless.worker.do', {
          'rpc.method': property,
          'chordless.do.class': className,
        })
        if (!span) return Reflect.apply(value, target, args)
        try {
          const result = Reflect.apply(value, target, args)
          if (!(result instanceof Promise)) {
            span.end()
            return result
          }
          return result.then(
            answer => {
              span.end()
              return answer
            },
            error => {
              failed(span, error)
              span.end()
              throw error
            }
          )
        } catch (error) {
          failed(span, error)
          span.end()
          throw error
        }
      }
    },
  })
}

/**
 * Run the request, and if it carried the page's trace context, make our span for it, the active one
 * while it runs (so the calls it makes are children: `tracedFetch`, `tracedStub`), and send it after.
 * Nothing is done for a request without one (the static files, a share link, the live socket), or
 * where no destination is set up, and nothing is sent for a sender over the telemetry limit.
 */
export async function withWorkerSpan(
  request: Request,
  env: Env,
  ctx: { waitUntil(promise: Promise<unknown>): void },
  deps: TelemetryDeps | undefined,
  run: () => Promise<Response>
): Promise<Response> {
  // The caller's trace context, as the W3C propagator reads it (an unsampled trace is not recorded: the sampler follows the parent)
  const parent = propagator.extract(
    ROOT_CONTEXT,
    {
      traceparent: request.headers.get('traceparent') ?? undefined,
      tracestate: request.headers.get('tracestate') ?? undefined,
    },
    defaultTextMapGetter
  )
  if (
    !trace.getSpanContext(parent) ||
    !env.OTLP_ENDPOINT?.startsWith('https://') ||
    !env.OTLP_HEADERS
  ) {
    return run()
  }

  const version = env.CF_VERSION_METADATA?.id
  // (a provider for the one request: these are few, and nothing is held between them. The batch
  // goes at the end, in one call, when it is shut down)
  const provider = new TracerProvider({
    resource: resourceFromAttributes({
      'service.name': SERVICE_NAME,
      ...(version ? { 'service.version': version } : {}),
    }),
    spanProcessors: [
      new BatchSpanProcessor({
        exporter: new ForwardingExporter(
          env.OTLP_ENDPOINT,
          env.OTLP_HEADERS,
          deps,
          withinLimit(request, env)
        ),
        scheduledDelayMillis: 60_000,
      }),
    ],
  })
  const tracer = provider.getTracer(SERVICE_NAME)
  const span = tracer.startSpan('chordless.worker.handle', { kind: SpanKind.SERVER }, parent)
  const tracing: Tracing = { tracer, children: 0 }

  let response: Response | undefined
  let thrown: unknown
  try {
    response = await context.with(trace.setSpan(parent, span).setValue(TRACING, tracing), run)
  } catch (error) {
    thrown = error
  }
  const status = response?.status ?? 500
  const cf = (request as { cf?: CloudflareProperties }).cf
  const attributes: Record<string, Value> = {
    'http.request.method': request.method,
    'http.route': routeOf(new URL(request.url).pathname),
    'http.response.status_code': status,
    'server.address': new URL(request.url).hostname,
    'user_agent.original': request.headers.get('User-Agent') ?? undefined,
    'cloudflare.ray_id': request.headers.get('cf-ray')?.split('-')[0],
    'cloudflare.colo': cf?.colo,
    'cloudflare.asn': cf?.asn,
    'geo.country.code': cf?.country,
    'geo.continent.code': cf?.continent,
    'geo.locality.region': cf?.region,
    'geo.locality.name': cf?.city,
    'geo.timezone': cf?.timezone,
    'cloudflare.script_version.id': version,
    'chordless.outcome': status >= 500 ? 'error' : 'ok',
  }
  span.setAttributes(
    Object.fromEntries(
      Object.entries(attributes).filter(([, value]) => value !== undefined && value !== '')
    )
  )
  if (status >= 500) span.setStatus({ code: SpanStatusCode.ERROR })
  span.end()
  ctx.waitUntil(provider.shutdown())
  if (!response) throw thrown
  return response
}
