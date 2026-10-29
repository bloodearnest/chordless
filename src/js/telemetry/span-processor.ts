/**
 * What every span gets as it starts: what is true of the page (baseline.ts), and, below a span that
 * stands for more than itself (a sampled `tick` sync), the same `SampleRate`, so that Honeycomb
 * counts it as many too.
 */
import { trace } from '@opentelemetry/api'
import type { ReadableSpan, SpanProcessor } from '@opentelemetry/sdk-trace'
import { baselineAttributes } from './baseline.ts'

export const stampSpans: SpanProcessor = {
  onStart: (span, parentContext) => {
    span.setAttributes(baselineAttributes())
    const rate = (trace.getSpan(parentContext) as ReadableSpan | undefined)?.attributes.SampleRate
    if (rate !== undefined) span.setAttribute('SampleRate', rate)
  },
  onEnd: () => undefined,
  forceFlush: () => Promise.resolve(),
  shutdown: () => Promise.resolve(),
}
