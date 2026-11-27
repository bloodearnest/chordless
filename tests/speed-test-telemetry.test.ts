/**
 * What the speed test sends to Honeycomb (src/js/speed-test/telemetry.ts, docs/SPEED_TEST.md): a span
 * for each timing, only while usage reports are on, and nothing a person typed.
 */
import { expect } from '@open-wc/testing'
import { trace } from '@opentelemetry/api'
import { InMemorySpanExporter, SimpleSpanProcessor, TracerProvider } from '@opentelemetry/sdk-trace'
import { setTelemetryPreference } from '../src/js/preferences.ts'
import type { RunResult, SpeedTestOutcome } from '../src/js/speed-test/runner.ts'
import {
  recordSpeedTest,
  recordSpeedTestFailure,
  type SpeedTestRun,
} from '../src/js/speed-test/telemetry.ts'
import { suppressConsoleLogs } from './test-helpers.ts'

const { describe, it, beforeEach, afterEach } = window

suppressConsoleLogs()

const exporter = new InMemorySpanExporter()

beforeEach(() => {
  localStorage.clear()
  trace.disable()
  exporter.reset()
  trace.setGlobalTracerProvider(
    new TracerProvider({ spanProcessors: [new SimpleSpanProcessor({ exporter })] })
  )
})

afterEach(() => {
  trace.disable()
  localStorage.clear()
})

const result = (overrides: Partial<RunResult> = {}): RunResult => ({
  variant: 'real',
  songs: 16,
  buildMs: 120.4,
  firstPaintMs: 3564.2,
  settledMs: 3772.9,
  elements: 8120,
  shadowRoots: 65,
  components: 1585,
  scroll: { frames: 150, long: 12, worstMs: 210.4, medianMs: 16.7, p95Ms: 83.3 },
  ...overrides,
})

const outcome = (results: RunResult[], overrides: Partial<SpeedTestOutcome> = {}) => ({
  results,
  stopped: false,
  hidden: false,
  durationMs: 48_400,
  ...overrides,
})

const run: SpeedTestRun = {
  id: 'run-1',
  lowPower: 'on',
  facts: { cores: 6, reducedMotion: false, serviceWorker: true },
}

const spans = () => exporter.getFinishedSpans()

describe('sending a speed test', () => {
  it('makes a span for each timing, with the same attribute names on each', () => {
    setTelemetryPreference(true)
    const sent = recordSpeedTest(
      outcome([result(), result({ variant: 'plain', songs: 5, components: 0, shadowRoots: 0 })]),
      run
    )
    expect(sent).to.equal(true)
    expect(spans().map(span => span.name)).to.deep.equal([
      'chordless.speedtest.run',
      'chordless.speedtest.run',
    ])
    const [first, second] = spans()
    expect(first?.attributes).to.include({
      'chordless.speedtest.id': 'run-1',
      'chordless.speedtest.outcome': 'ok',
      'chordless.speedtest.variant': 'real',
      'chordless.speedtest.songs': 16,
      'chordless.speedtest.order': 0,
      'chordless.speedtest.build_ms': 120,
      'chordless.speedtest.first_paint_ms': 3564,
      'chordless.speedtest.settled_ms': 3773,
      'chordless.speedtest.elements': 8120,
      'chordless.speedtest.shadow_roots': 65,
      'chordless.speedtest.components': 1585,
      'chordless.speedtest.scroll_frames': 150,
      'chordless.speedtest.scroll_long_frames': 12,
      'chordless.speedtest.scroll_worst_ms': 210,
      'chordless.speedtest.scroll_median_ms': 17,
      'chordless.speedtest.scroll_p95_ms': 83,
      'chordless.speedtest.hidden': false,
      'chordless.speedtest.stopped': false,
      'chordless.speedtest.total_ms': 48_400,
      'chordless.speedtest.cores': 6,
      'chordless.speedtest.reduced_motion': false,
      'chordless.speedtest.controlled': true,
      'chordless.speedtest.low_power': 'on',
    })
    // (the second is the same shape, for what it timed: the place in the run says which came when)
    expect(second?.attributes).to.include({
      'chordless.speedtest.id': 'run-1',
      'chordless.speedtest.variant': 'plain',
      'chordless.speedtest.songs': 5,
      'chordless.speedtest.order': 1,
      'chordless.speedtest.components': 0,
    })
    expect(
      Object.keys(first?.attributes ?? {})
        .filter(key => key.startsWith('chordless.speedtest.'))
        .sort()
    ).to.deep.equal(
      Object.keys(second?.attributes ?? {})
        .filter(key => key.startsWith('chordless.speedtest.'))
        .sort()
    )
  })

  it('leaves out a paint that did not come, as the page’s own measures do, and says if it was hidden or stopped', () => {
    setTelemetryPreference(true)
    recordSpeedTest(
      outcome([result({ firstPaintMs: null, settledMs: null })], { hidden: true, stopped: true }),
      run
    )
    const [span] = spans()
    expect(span?.attributes).to.not.have.any.keys(
      'chordless.speedtest.first_paint_ms',
      'chordless.speedtest.settled_ms'
    )
    expect(span?.attributes).to.include({
      'chordless.speedtest.hidden': true,
      'chordless.speedtest.stopped': true,
    })
  })

  it('sends nothing, and says so, while usage reports are off', () => {
    setTelemetryPreference(false)
    expect(recordSpeedTest(outcome([result()]), run)).to.equal(false)
    expect(recordSpeedTestFailure(new Error('no'), run)).to.equal(false)
    expect(spans()).to.have.length(0)
  })

  it('has nothing of anyone’s in it: no note, no title, no lyric', () => {
    setTelemetryPreference(true)
    recordSpeedTest(outcome([result()]), run)
    const text = JSON.stringify(spans().map(span => span.attributes))
    expect(text).to.not.match(/note|title|lyric|Test song/i)
  })
})

describe('sending that a speed test could not finish', () => {
  it('sends the error as the app’s other errors are: its class and message', () => {
    setTelemetryPreference(true)
    expect(recordSpeedTestFailure(new TypeError('x is not a function'), run)).to.equal(true)
    const [span] = spans()
    expect(span?.name).to.equal('chordless.speedtest.run')
    expect(span?.attributes).to.include({
      'chordless.speedtest.id': 'run-1',
      'chordless.speedtest.outcome': 'error',
      'chordless.error': true,
      'chordless.speedtest.error': 'TypeError',
      'chordless.speedtest.error_message': 'x is not a function',
    })
  })

  it('says what a thing that is not an error was', () => {
    setTelemetryPreference(true)
    recordSpeedTestFailure('plain words', run)
    expect(spans()[0]?.attributes).to.include({
      'chordless.speedtest.error': 'Error',
      'chordless.speedtest.error_message': 'plain words',
    })
  })
})
