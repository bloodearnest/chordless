/**
 * A span for every `fetch` of the page, by OpenTelemetry's own instrumentation of it (the method, the
 * address, the status and the error; the request's size; `traceparent` to our own Worker, and never
 * to Google, which would need a CORS preflight and be told our trace ids). What is ours is in
 * the config: the path, the
 * Cloudflare ray id (which finds the Worker's span, which cannot join our trace) and the size of the
 * answer, from the browser's own record of it. Which span is the parent is not the instrumentation's
 * to know, with no async context: `timedFetch` (telemetry.ts) makes the call with it active.
 */

import type { Span } from '@opentelemetry/api'
import {
  FetchInstrumentation,
  type FetchInstrumentationConfig,
} from '@opentelemetry/browser-instrumentation/experimental/fetch'
import type { ReadableSpan } from '@opentelemetry/sdk-trace'
import { ATTR_URL_FULL, ATTR_URL_PATH } from '@opentelemetry/semantic-conventions'
import {
  ATTR_HTTP_RESPONSE_BODY_SIZE,
  ATTR_HTTP_RESPONSE_SIZE,
} from '@opentelemetry/semantic-conventions/incubating'

export const TELEMETRY_URL = '/api/otlp/v1/traces'

/** How much of a URL (its query: what a Drive listing asked for) is kept on its span */
const MAX_URL = 500
/** How far apart, in ms, the start of a call and of the browser's record of it may be */
const ENTRY_GAP_MS = 50

const claimed = new WeakSet<PerformanceEntry>()

/** The address a span is for (truncated, so a relative parse: it is whatever the instrumentation made of it) */
const urlOf = (span: Span): URL =>
  new URL(String((span as unknown as ReadableSpan).attributes[ATTR_URL_FULL]), location.href)

/** The browser's record of the call to `url` that began at `startedMs` (epoch), not yet given to another call */
function resourceEntryOf(url: string, startedMs: number): PerformanceResourceTiming | undefined {
  let found: PerformanceResourceTiming | undefined
  let gap = ENTRY_GAP_MS
  for (const entry of performance.getEntriesByName(
    url,
    'resource'
  ) as PerformanceResourceTiming[]) {
    const apart = Math.abs(performance.timeOrigin + entry.startTime - startedMs)
    if (apart < gap && !claimed.has(entry)) {
      found = entry
      gap = apart
    }
  }
  if (found) claimed.add(found)
  return found
}

export const fetchConfig: FetchInstrumentationConfig = {
  ignoreUrls: [TELEMETRY_URL],
  measureRequestSize: true,
  sanitizeUrl: url => url.slice(0, MAX_URL),
  // (the span is named as the conventions have it, by its method; where it went is `server.address`)
  requestHook: span => {
    span.setAttribute(ATTR_URL_PATH, urlOf(span).pathname)
  },
  applyCustomAttributesOnSpan: (span, _request, result) => {
    if (!(result instanceof Response)) return
    const ray = result.headers.get('cf-ray')
    if (ray) span.setAttribute('cloudflare.ray_id', ray.split('-')[0])
    // (the bytes on the wire, as compressed; a call to another origin has none unless it allows it)
    const length = result.headers.get('Content-Length')
    if (length !== null && Number.isFinite(Number(length))) {
      span.setAttribute(ATTR_HTTP_RESPONSE_BODY_SIZE, Number(length))
    }
    const started = (span as unknown as ReadableSpan).startTime
    const entry = resourceEntryOf(urlOf(span).href, started[0] * 1000 + started[1] / 1e6)
    if (!entry) return
    if (entry.encodedBodySize > 0)
      span.setAttribute(ATTR_HTTP_RESPONSE_BODY_SIZE, entry.encodedBodySize)
    if (entry.decodedBodySize > 0) {
      span.setAttribute('chordless.http.response.decoded_body_size', entry.decodedBodySize)
    }
    if (entry.transferSize > 0) span.setAttribute(ATTR_HTTP_RESPONSE_SIZE, entry.transferSize)
  },
}

/** Start making spans of the page's fetches (it patches `fetch` as it is made, and stops when it is disabled) */
export const instrumentFetch = (): FetchInstrumentation => new FetchInstrumentation(fetchConfig)
