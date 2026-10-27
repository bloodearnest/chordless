/**
 * The page's traces, on their way to Honeycomb (docs/OBSERVABILITY.md): `POST /api/otlp/v1/traces`.
 * The small collector we need, with none to run: it limits who may send, rebuilds the body from an
 * allow-list (so a bug in the page cannot ship a song's title or lyrics), and forwards it with the
 * key the browser cannot keep. The body is read into memory and passed on, never stored or logged.
 * The page is always answered 204 once its request is well formed, whatever upstream says: a
 * telemetry failure must never reach the app.
 */

import type { Env } from './env.ts'
import { isRecord } from './http.ts'

export const TELEMETRY_PATH = '/api/otlp/v1/traces'

/** The body of a batch from the page is a few kilobytes: anything near this is not one */
const MAX_BODY_BYTES = 256 * 1024
const MAX_SPANS = 500
const MAX_ATTRIBUTES = 64
const MAX_EVENTS = 16
const MAX_LINKS = 8
const MAX_VALUE_LENGTH = 512
const MAX_MESSAGE_LENGTH = 200
const MAX_NAME_LENGTH = 100

/** The standard names we use (docs/OBSERVABILITY.md, Conventions) */
const STANDARD_ATTRIBUTES = [
  'service.name',
  'service.version',
  'deployment.environment.name',
  'session.id',
  'enduser.pseudo.id',
  'device.id',
  'user_agent.original',
  'http.request.method',
  'http.response.status_code',
  'http.route',
  'error.type',
  'exception.type',
  'exception.message',
  'telemetry.sdk.name',
  'telemetry.sdk.language',
  'telemetry.sdk.version',
  // Honeycomb's sample rate, here before there is sampling so counts stay right the day there is
  'SampleRate',
]

/** Ours, each starting with `chordless.` (docs/OBSERVABILITY.md, What is traced). No names of songs. */
const CHORDLESS_ATTRIBUTES = [
  'chordless.error',
  'chordless.outcome',
  'chordless.route',
  'chordless.live',
  'chordless.online',
  'chordless.display_mode',
  'chordless.space_kind',
  'chordless.team.pseudo_id',
  'chordless.sync.operation',
  'chordless.sync.space_kind',
  'chordless.sync.pulled',
  'chordless.sync.pushed',
  'chordless.sync.pull_ms',
  'chordless.sync.push_ms',
  'chordless.sync.drive_calls',
  'chordless.sync.drive_ms_total',
  'chordless.sync.drive_ms_max',
  'chordless.sync.worker_calls',
  'chordless.sync.errors',
  'chordless.auth.refresh_ms',
  'chordless.auth.outcome',
  'chordless.setlist.id',
  'chordless.setlist.date',
  'chordless.setlist.songs',
  'chordless.setlist.ccli',
  'chordless.setlist.source',
  'chordless.setlist.open_ms',
  'chordless.setlist.songs_viewed',
  'chordless.setlist.song_changes',
  'chordless.setlist.transposes',
  'chordless.setlist.edit_entries',
  'chordless.song.id',
  'chordless.song.ccli',
  'chordless.song.index',
  'chordless.song.key',
  'chordless.live.publish_ms',
  'chordless.live.sync_ms',
  'chordless.live.attempt',
  'chordless.live.found',
  'chordless.live.transit_ms',
  'chordless.live.up_ms',
  'chordless.live.down_ms',
  'chordless.live.clock_offset_ms',
  'chordless.live.rtt_ms',
]

/**
 * The attribute names a span may carry. Anything else is dropped here, so a new one is a decision
 * made in this list (and tested), not an accident in the page: never a title, lyric, chart or key.
 */
export const ALLOWED_ATTRIBUTES: ReadonlySet<string> = new Set([
  ...STANDARD_ATTRIBUTES,
  ...CHORDLESS_ATTRIBUTES,
])

/** What the route needs of the outside world, replaceable in tests */
export interface TelemetryDeps {
  fetch(url: string, init: RequestInit): Promise<Response>
}

const defaultDeps: TelemetryDeps = { fetch: (url, init) => fetch(url, init) }

type Json = Record<string, unknown>
interface Attribute {
  key: string
  value: Json
}

/** One attribute of OTLP/JSON, or null if it is not allowed or not a plain value */
function cleanAttribute(item: unknown): Attribute | null {
  if (!isRecord(item) || typeof item.key !== 'string' || !ALLOWED_ATTRIBUTES.has(item.key)) {
    return null
  }
  const value = item.value
  if (!isRecord(value)) return null
  const limit = item.key === 'exception.message' ? MAX_MESSAGE_LENGTH : MAX_VALUE_LENGTH
  if (typeof value.stringValue === 'string') {
    return { key: item.key, value: { stringValue: value.stringValue.slice(0, limit) } }
  }
  if (typeof value.boolValue === 'boolean')
    return { key: item.key, value: { boolValue: value.boolValue } }
  if (typeof value.doubleValue === 'number') {
    return { key: item.key, value: { doubleValue: value.doubleValue } }
  }
  const int = value.intValue
  if (typeof int === 'number' || (typeof int === 'string' && /^-?\d{1,19}$/.test(int))) {
    return { key: item.key, value: { intValue: int } }
  }
  // (arrays, maps and bytes are not ours: a list could hide a lot)
  return null
}

function cleanAttributes(list: unknown): Attribute[] {
  if (!Array.isArray(list)) return []
  const kept: Attribute[] = []
  for (const item of list) {
    const attribute = cleanAttribute(item)
    if (attribute) kept.push(attribute)
    if (kept.length >= MAX_ATTRIBUTES) break
  }
  return kept
}

const hex = (value: unknown, length: number): string | null =>
  typeof value === 'string' && value.length === length && /^[0-9a-f]+$/.test(value) ? value : null

const nanos = (value: unknown): string | null =>
  typeof value === 'string' && /^\d{1,20}$/.test(value) ? value : null

const small = (value: unknown, max: number): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max ? value : null

const text = (value: unknown, max = MAX_NAME_LENGTH): string | null =>
  typeof value === 'string' ? value.slice(0, max) : null

function cleanEvents(list: unknown): Json[] {
  if (!Array.isArray(list)) return []
  const events: Json[] = []
  for (const item of list.slice(0, MAX_EVENTS)) {
    if (!isRecord(item)) continue
    const name = text(item.name)
    const time = nanos(item.timeUnixNano)
    if (name === null || time === null) continue
    events.push({ name, timeUnixNano: time, attributes: cleanAttributes(item.attributes) })
  }
  return events
}

function cleanLinks(list: unknown): Json[] {
  if (!Array.isArray(list)) return []
  const links: Json[] = []
  for (const item of list.slice(0, MAX_LINKS)) {
    if (!isRecord(item)) continue
    const traceId = hex(item.traceId, 32)
    const spanId = hex(item.spanId, 16)
    if (traceId === null || spanId === null) continue
    links.push({ traceId, spanId, attributes: cleanAttributes(item.attributes) })
  }
  return links
}

/** A span rebuilt from the fields we know, or null if it is not a span */
function cleanSpan(item: unknown): Json | null {
  if (!isRecord(item)) return null
  const traceId = hex(item.traceId, 32)
  const spanId = hex(item.spanId, 16)
  const name = text(item.name)
  const start = nanos(item.startTimeUnixNano)
  const end = nanos(item.endTimeUnixNano)
  if (traceId === null || spanId === null || name === null || start === null || end === null) {
    return null
  }
  const span: Json = {
    traceId,
    spanId,
    name,
    startTimeUnixNano: start,
    endTimeUnixNano: end,
    attributes: cleanAttributes(item.attributes),
    events: cleanEvents(item.events),
    links: cleanLinks(item.links),
  }
  const parent = hex(item.parentSpanId, 16)
  if (parent !== null) span.parentSpanId = parent
  const kind = small(item.kind, 5)
  if (kind !== null) span.kind = kind
  // (the status's message is free text: only its code is kept)
  if (isRecord(item.status)) {
    const code = small(item.status.code, 2)
    if (code !== null) span.status = { code }
  }
  return span
}

/**
 * The body rebuilt from what we know of OTLP/JSON, field by field: unknown fields do not pass,
 * attributes pass only by name (`ALLOWED_ATTRIBUTES`) with plain values of a bounded size, and a
 * span's status message and a scope's attributes are left out. Null when no span is left.
 */
export function redact(body: unknown): Json | null {
  if (!isRecord(body) || !Array.isArray(body.resourceSpans)) return null
  let spans = 0
  const resourceSpans: Json[] = []
  for (const resourceItem of body.resourceSpans) {
    if (!isRecord(resourceItem)) continue
    const scopeSpans: Json[] = []
    for (const scopeItem of Array.isArray(resourceItem.scopeSpans) ? resourceItem.scopeSpans : []) {
      if (!isRecord(scopeItem)) continue
      const kept: Json[] = []
      for (const item of Array.isArray(scopeItem.spans) ? scopeItem.spans : []) {
        if (spans >= MAX_SPANS) break
        const span = cleanSpan(item)
        if (span) {
          kept.push(span)
          spans++
        }
      }
      if (kept.length === 0) continue
      const scope: Json = {}
      if (isRecord(scopeItem.scope)) {
        const name = text(scopeItem.scope.name)
        const version = text(scopeItem.scope.version)
        if (name !== null) scope.name = name
        if (version !== null) scope.version = version
      }
      scopeSpans.push({ scope, spans: kept })
    }
    if (scopeSpans.length === 0) continue
    const resource = isRecord(resourceItem.resource) ? resourceItem.resource : {}
    resourceSpans.push({
      resource: { attributes: cleanAttributes(resource.attributes) },
      scopeSpans,
    })
  }
  return spans === 0 ? null : { resourceSpans }
}

/** `name=value,name=value`, as OTEL_EXPORTER_OTLP_HEADERS has it (the value may hold `=`) */
export function parseHeaders(value: string): Headers {
  const headers = new Headers()
  for (const pair of value.split(',')) {
    const at = pair.indexOf('=')
    if (at < 1) continue
    try {
      headers.set(pair.slice(0, at).trim(), pair.slice(at + 1).trim())
    } catch {
      // (not a valid header name or value: left out)
    }
  }
  return headers
}

/** The body as text, or null once it is over the limit (a missing Content-Length is no help) */
async function readCapped(request: Request): Promise<string | null> {
  const declared = Number(request.headers.get('Content-Length'))
  if (declared > MAX_BODY_BYTES) return null
  if (!request.body) return ''
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_BODY_BYTES) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

/** Whether this sender may send now; a limit that cannot be asked is no reason to refuse */
async function withinLimit(request: Request, env: Env): Promise<boolean> {
  if (!env.TELEMETRY) return true
  try {
    const key = request.headers.get('CF-Connecting-IP') ?? 'unknown'
    return (await env.TELEMETRY.limit({ key })).success !== false
  } catch {
    return true
  }
}

/** Passes the cleaned traces on; whatever happens upstream is for the logs, not for the page */
async function forward(
  clean: Json,
  endpoint: string,
  headers: Headers,
  deps: TelemetryDeps
): Promise<void> {
  try {
    headers.set('Content-Type', 'application/json')
    const response = await deps.fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(clean),
    })
    // (the status only: what was sent is never logged)
    if (!response.ok) console.error(`[telemetry] upstream answered ${response.status}`)
  } catch (error) {
    console.error('[telemetry] upstream failed:', error instanceof Error ? error.name : 'error')
  }
}

function refuse(status: number, text: string, headers?: HeadersInit): Response {
  return Response.json({ error: text }, { status, headers })
}

export async function handleTelemetry(
  request: Request,
  env: Env,
  ctx: { waitUntil(promise: Promise<unknown>): void },
  deps: TelemetryDeps = defaultDeps
): Promise<Response> {
  if (request.method !== 'POST') return refuse(405, 'Use POST', { Allow: 'POST' })
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) {
    return refuse(415, 'The traces are JSON')
  }
  if (!(await withinLimit(request, env))) return refuse(429, 'Too many requests')

  const raw = await readCapped(request)
  if (raw === null) return refuse(413, 'Too large')
  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return refuse(400, 'The body is not JSON')
  }
  const clean = redact(body)
  if (clean === null) return refuse(400, 'No spans')

  // Not set up (development without a key, or no destination): taken and dropped
  if (env.OTLP_ENDPOINT?.startsWith('https://') && env.OTLP_HEADERS) {
    ctx.waitUntil(forward(clean, env.OTLP_ENDPOINT, parseHeaders(env.OTLP_HEADERS), deps))
  }
  return new Response(null, { status: 204 })
}
