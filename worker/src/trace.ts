/**
 * The Worker's own span for a call that carries the page's `traceparent` (docs/OBSERVABILITY.md).
 * Cloudflare's native spans ignore the header and are roots of their own, so for the page's calls
 * the Worker makes one that is a real child of the page's call span: the context is read by the W3C
 * propagator, and the span is made by the OTel SDK with it as parent, with the facts the runtime gives
 * us. It goes to the same destination as the page's traces (an exporter that is `forward`), after the
 * response is made, and never changes it.
 */

import {
  defaultTextMapGetter,
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
  trace,
} from '@opentelemetry/api'
import { type ExportResult, ExportResultCode, W3CTraceContextPropagator } from '@opentelemetry/core'
import { JsonTraceSerializer } from '@opentelemetry/otlp-transformer'
import { resourceFromAttributes } from '@opentelemetry/resources'
import {
  type ReadableSpan,
  SimpleSpanProcessor,
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

/** Sends the spans of the one request to the destination, as OTLP/JSON, the way the page's traces go */
class ForwardingExporter implements SpanExporter {
  #endpoint: string
  #headers: string
  #deps: TelemetryDeps | undefined

  constructor(endpoint: string, headers: string, deps: TelemetryDeps | undefined) {
    this.#endpoint = endpoint
    this.#headers = headers
    this.#deps = deps
  }

  export(spans: ReadableSpan[], done: (result: ExportResult) => void): void {
    const body = JsonTraceSerializer.serializeRequest(spans)
    forward(
      JSON.parse(new TextDecoder().decode(body)),
      this.#endpoint,
      parseHeaders(this.#headers),
      this.#deps
    ).then(() => done({ code: ExportResultCode.SUCCESS }))
  }

  shutdown(): Promise<void> {
    return Promise.resolve()
  }
}

type Value = string | number | undefined

/**
 * Run the request, and if it carried the page's trace context, send our span for it afterwards.
 * Nothing is done for a request without one (the static files, a share link, the live socket), or
 * where no destination is set up, or from a sender over the telemetry limit.
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
  const parentSpan = trace.getSpanContext(parent)
  if (!parentSpan || !env.OTLP_ENDPOINT?.startsWith('https://') || !env.OTLP_HEADERS) return run()

  const endpoint = env.OTLP_ENDPOINT
  const headers = env.OTLP_HEADERS
  const startMs = Date.now()
  let response: Response | undefined
  let thrown: unknown
  try {
    response = await run()
  } catch (error) {
    thrown = error
  }
  const endMs = Date.now()
  const status = response?.status ?? 500
  ctx.waitUntil(
    (async () => {
      if (!(await withinLimit(request, env))) return
      const cf = (request as { cf?: CloudflareProperties }).cf
      const version = env.CF_VERSION_METADATA?.id
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
      // (a provider for the one span: these are few, and nothing is held between them)
      const provider = new TracerProvider({
        resource: resourceFromAttributes({
          'service.name': SERVICE_NAME,
          ...(version ? { 'service.version': version } : {}),
        }),
        spanProcessors: [
          new SimpleSpanProcessor({ exporter: new ForwardingExporter(endpoint, headers, deps) }),
        ],
      })
      const span = provider.getTracer(SERVICE_NAME).startSpan(
        'chordless.worker.handle',
        {
          kind: SpanKind.SERVER,
          startTime: startMs,
          attributes: Object.fromEntries(
            Object.entries(attributes).filter(([, value]) => value !== undefined && value !== '')
          ),
        },
        parent
      )
      if (status >= 500) span.setStatus({ code: SpanStatusCode.ERROR })
      span.end(endMs)
      await provider.shutdown()
    })()
  )
  if (!response) throw thrown
  return response
}
