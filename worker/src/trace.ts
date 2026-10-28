/**
 * The Worker's own span for a call that carries the page's `traceparent` (docs/OBSERVABILITY.md).
 * Cloudflare's native spans ignore the header and are roots of their own, so for the page's calls
 * the Worker makes one that is a real child of the page's call span: the caller's trace id, its span
 * id as parent, and the facts the runtime gives us. It goes to the same destination as the page's
 * traces (hand-written OTLP/JSON: no SDK), after the response is made, and never changes it.
 */

import type { Env } from './env.ts'
import { forward, parseHeaders, type TelemetryDeps, withinLimit } from './telemetry.ts'

/** Where our spans are found in Honeycomb: a dataset of their own, apart from the native `chordless` */
export const SERVICE_NAME = 'chordless-worker'

const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/
/** A path segment that is an id (a Drive id, a UUID, a share id), not a name */
const ID_SEGMENT = /^[A-Za-z0-9_-]{16,}$|^[0-9a-f]{8}-[0-9a-f-]{27}$/
const SERVER = 2
const STATUS_OK = 1
const STATUS_ERROR = 2

interface CloudflareProperties {
  colo?: string
  asn?: number
  country?: string
  continent?: string
  region?: string
  city?: string
  timezone?: string
}

/** The caller's trace and span, if it sent a valid `traceparent` for a trace that is sampled */
export function parseTraceparent(
  header: string | null
): { traceId: string; parentId: string } | null {
  const match = header ? TRACEPARENT.exec(header.trim().toLowerCase()) : null
  if (!match) return null
  const [, traceId, parentId, flags] = match
  // (all zeros are not ids; an unsampled trace is not one the page chose to report)
  if (/^0+$/.test(traceId) || /^0+$/.test(parentId) || !(Number.parseInt(flags, 16) & 1))
    return null
  return { traceId, parentId }
}

/** The path as a template, ids replaced: what the route was, not which file or space it was for */
export function routeOf(path: string): string {
  return path
    .split('/')
    .map(segment => (ID_SEGMENT.test(segment) ? ':id' : segment))
    .join('/')
}

const randomSpanId = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}

type Value = string | number | undefined
const attribute = (key: string, value: Value) =>
  value === undefined || value === ''
    ? []
    : [
        {
          key,
          value: typeof value === 'string' ? { stringValue: value } : { intValue: String(value) },
        },
      ]

/** The span, as an OTLP/JSON batch */
export function buildSpan(
  parent: { traceId: string; parentId: string },
  facts: { startMs: number; endMs: number; attributes: Record<string, Value>; failed: boolean },
  version: string | undefined
): unknown {
  return {
    resourceSpans: [
      {
        resource: {
          attributes: [
            ...attribute('service.name', SERVICE_NAME),
            ...attribute('service.version', version),
          ],
        },
        scopeSpans: [
          {
            scope: { name: SERVICE_NAME },
            spans: [
              {
                traceId: parent.traceId,
                spanId: randomSpanId(),
                parentSpanId: parent.parentId,
                name: 'chordless.worker.handle',
                kind: SERVER,
                startTimeUnixNano: `${Math.round(facts.startMs)}000000`,
                endTimeUnixNano: `${Math.round(facts.endMs)}000000`,
                attributes: Object.entries(facts.attributes).flatMap(([key, value]) =>
                  attribute(key, value)
                ),
                status: { code: facts.failed ? STATUS_ERROR : STATUS_OK },
              },
            ],
          },
        ],
      },
    ],
  }
}

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
  const parent = parseTraceparent(request.headers.get('traceparent'))
  if (!parent || !env.OTLP_ENDPOINT?.startsWith('https://') || !env.OTLP_HEADERS) return run()

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
      const body = buildSpan(
        parent,
        {
          startMs,
          endMs,
          failed: status >= 500,
          attributes: {
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
          },
        },
        version
      )
      await forward(
        body as Record<string, unknown>,
        env.OTLP_ENDPOINT as string,
        parseHeaders(env.OTLP_HEADERS as string),
        deps
      )
    })()
  )
  if (!response) throw thrown
  return response
}
