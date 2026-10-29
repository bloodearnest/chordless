/**
 * Which traces are reported (docs/OBSERVABILITY.md): all of them, except that of the sync the timer
 * starts, which is the many and mostly finds nothing, of which one in `TICK_SAMPLE` is. The decision
 * is the trace's, made where it starts (the sync's span) and followed by everything below it
 * (`ParentBased`), and it travels in `traceparent`'s sampled flag. A trace that is kept says by how
 * much it stands for, as Honeycomb's `SampleRate`, so that its counts are scaled.
 */
import type { Attributes, Context, SpanKind } from '@opentelemetry/api'
import {
  ParentBasedSampler,
  type Sampler,
  SamplingDecision,
  type SamplingResult,
  TraceIdRatioBasedSampler,
} from '@opentelemetry/sdk-trace'
import { TICK_SAMPLE } from './telemetry.ts'

class TickSampler implements Sampler {
  #ratio = new TraceIdRatioBasedSampler(1 / TICK_SAMPLE)

  shouldSample(
    _context: Context,
    traceId: string,
    _name: string,
    _kind: SpanKind,
    attributes: Attributes
  ): SamplingResult {
    if (attributes['chordless.sync.trigger'] !== 'tick') {
      return { decision: SamplingDecision.RECORD_AND_SAMPLED }
    }
    const { decision } = this.#ratio.shouldSample(undefined, traceId)
    return decision === SamplingDecision.RECORD_AND_SAMPLED
      ? { decision, attributes: { SampleRate: TICK_SAMPLE } }
      : { decision }
  }

  toString(): string {
    return `TickSampler{1 in ${TICK_SAMPLE}}`
  }
}

export const sampler = (): Sampler => new ParentBasedSampler({ root: new TickSampler() })
