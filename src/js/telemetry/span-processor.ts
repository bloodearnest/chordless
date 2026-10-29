/**
 * What every span gets as it starts: what is true of the page (baseline.ts), and, from the span
 * above it, what a query by it needs on the span itself: the sync it is part of (what started it,
 * and which operation it was, so a Drive call can be looked at by either) and the `SampleRate` of a
 * sampled `tick` sync, so that Honeycomb counts it as many too.
 */
import { trace } from '@opentelemetry/api'
import type { ReadableSpan, SpanProcessor } from '@opentelemetry/sdk-trace'
import { baselineAttributes } from './baseline.ts'

const FROM_PARENT = ['SampleRate', 'chordless.sync.trigger', 'chordless.sync.operation']

export const stampSpans: SpanProcessor = {
  onStart: (span, parentContext) => {
    span.setAttributes(baselineAttributes())
    const parent = trace.getSpan(parentContext) as ReadableSpan | undefined
    for (const key of FROM_PARENT) {
      const value = parent?.attributes[key]
      if (value !== undefined) span.setAttribute(key, value)
    }
  },
  onEnd: () => undefined,
  forceFlush: () => Promise.resolve(),
  shutdown: () => Promise.resolve(),
}
