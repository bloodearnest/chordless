/* v8 ignore start -- start-up wiring of the SDK, which a unit test cannot load (it needs the page and the network): the Playwright tests run it, and what it is made of (baseline.ts, gated-exporter.ts, telemetry.ts) is unit tested */
/**
 * Start sending the page's reports (docs/OBSERVABILITY.md): to our own Worker, which holds the key
 * and passes them to Honeycomb. The SDK is bigger than the rest of this, so it is loaded when the
 * page is idle, only if reports are on, and again the first time they are turned on.
 *
 * `localStorage.setItem('telemetry-console', '1')` also prints each span in the console, to see what
 * a change reports without Honeycomb.
 */
import { context, propagation, trace } from '@opentelemetry/api'
import { W3CTraceContextPropagator } from '@opentelemetry/core'
import type { SpanProcessor } from '@opentelemetry/sdk-trace'
import {
  ATTR_DEPLOYMENT_ENVIRONMENT_NAME,
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
  ATTR_USER_AGENT_ORIGINAL,
} from '@opentelemetry/semantic-conventions'
import { appUpdate } from '../app-update.ts'
import { getTelemetryPreference, TelemetryPreferenceEvent } from '../preferences.ts'
import { resetDeviceId } from './ids.ts'
import { reportError } from './telemetry.ts'

let started = false

async function start(): Promise<void> {
  const [
    sdk,
    { OTLPTraceExporter },
    { resourceFromAttributes },
    { GatedExporter },
    { instrumentFetch, TELEMETRY_URL },
    { sampler },
    { stampSpans },
  ] = await Promise.all([
    import('@opentelemetry/sdk-trace'),
    import('@opentelemetry/exporter-trace-otlp-http'),
    import('@opentelemetry/resources'),
    import('./gated-exporter.ts'),
    import('./fetch.ts'),
    import('./sampler.ts'),
    import('./span-processor.ts'),
  ])
  const {
    TracerProvider,
    BatchSpanProcessor,
    SimpleSpanProcessor,
    ConsoleSpanExporter,
    StackContextManager,
  } = sdk
  const running = await appUpdate.runningVersion().catch(() => null)

  const exporter = new GatedExporter(new OTLPTraceExporter({ url: TELEMETRY_URL }))
  const spanProcessors: SpanProcessor[] = [
    // Every span gets what is true of the page as it starts
    stampSpans,
    new BatchSpanProcessor({
      exporter,
      scheduledDelayMillis: 5000,
      maxQueueSize: 256,
      maxExportBatchSize: 64,
    }),
  ]
  try {
    if (localStorage.getItem('telemetry-console') === '1') {
      spanProcessors.push(new SimpleSpanProcessor({ exporter: new ConsoleSpanExporter() }))
    }
  } catch {
    // (storage is blocked: no console reports)
  }

  const provider = new TracerProvider({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: 'chordless-web',
      [ATTR_SERVICE_VERSION]: running?.version ?? 'unknown',
      [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: import.meta.env?.MODE ?? 'unknown',
      [ATTR_USER_AGENT_ORIGINAL]: navigator.userAgent,
    }),
    sampler: sampler(),
    spanProcessors,
  })
  trace.setGlobalTracerProvider(provider)
  // (what is active for a call as it is made: `timedFetch` makes the sync active for its calls)
  context.setGlobalContextManager(new StackContextManager().enable())
  // (and what is sent on, to our own Worker: `traceparent`)
  propagation.setGlobalPropagator(new W3CTraceContextPropagator())
  // A span for every fetch of the page, until reports are turned off
  const fetchSpans = instrumentFetch()
  window.addEventListener(TelemetryPreferenceEvent.type, event => {
    if (event.enabled) fetchSpans.enable()
    else fetchSpans.disable()
  })

  // What has not gone yet goes when the page is left (a tab put away may not come back)
  const flush = () => void provider.forceFlush().catch(() => undefined)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush()
  })
  window.addEventListener('pagehide', flush)
  window.addEventListener('error', event => reportError(event.error ?? event.message))
  window.addEventListener('unhandledrejection', event => reportError(event.reason))
}

/** Begin, once: now if reports are on, and when they are turned on if they are not */
export function initTelemetry(): void {
  const begin = () => {
    if (started) return
    started = true
    start().catch(error => {
      console.warn('[telemetry] could not start', error)
    })
  }
  if (getTelemetryPreference()) begin()
  window.addEventListener(TelemetryPreferenceEvent.type, event => {
    if (event.enabled) begin()
    // (turning them off forgets this device's id: a new one is made if they are turned on again)
    else resetDeviceId()
  })
}
