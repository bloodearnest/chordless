/**
 * An exporter that sends only while sending is wanted: online, and reports on. A batch it does not
 * send is dropped, not kept: offline is supported but not what the app is mostly used in, and a
 * telemetry queue that outlives the page is more than that is worth (docs/OBSERVABILITY.md).
 */
import { ExportResultCode } from '@opentelemetry/core'
import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-web'
import { getTelemetryPreference } from '../preferences.ts'

type Done = Parameters<SpanExporter['export']>[1]

export class GatedExporter implements SpanExporter {
  readonly #inner: SpanExporter
  readonly #allowed: () => boolean

  constructor(
    inner: SpanExporter,
    allowed: () => boolean = () => navigator.onLine && getTelemetryPreference()
  ) {
    this.#inner = inner
    this.#allowed = allowed
  }

  export(spans: ReadableSpan[], done: Done): void {
    if (!this.#allowed()) {
      done({ code: ExportResultCode.SUCCESS })
      return
    }
    this.#inner.export(spans, done)
  }

  shutdown(): Promise<void> {
    return this.#inner.shutdown()
  }

  forceFlush(): Promise<void> {
    return this.#inner.forceFlush?.() ?? Promise.resolve()
  }
}
