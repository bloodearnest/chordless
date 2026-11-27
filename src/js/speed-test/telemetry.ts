/**
 * What the speed test sends to Honeycomb (docs/SPEED_TEST.md, docs/OBSERVABILITY.md): a span for each
 * timing, with the numbers as attributes, so that "where does the time go on an old iPad?" is a query
 * across every device that has run it. It goes with the app's other usage reports, by the same switch:
 * with reports off nothing is sent, and the page says so. The device's own id, its browser, screen and
 * the rest are on every span already (baseline.ts). The made-up songs are all it has measured: no song
 * of anyone's is here, and what the person wrote in the note is not, as it could say anything.
 */
import { getTelemetryPreference } from '../preferences.ts'
import { recordSpan } from '../telemetry/telemetry.ts'
import type { LowPower, SpeedTestFacts } from './report.ts'
import { REPORT_VERSION } from './report.ts'
import type { RunResult, SpeedTestOutcome } from './runner.ts'

const PREFIX = 'chordless.speedtest.'

/** What one test is: its id (shared by its spans, so that they are found together) and what is said of the device */
export interface SpeedTestRun {
  id: string
  lowPower: LowPower
  facts: SpeedTestFacts
}

const round = (value: number): number => Math.round(value)

function resultAttributes(
  result: RunResult,
  order: number,
  outcome: SpeedTestOutcome,
  run: SpeedTestRun
) {
  const { scroll } = result
  return {
    [`${PREFIX}id`]: run.id,
    [`${PREFIX}outcome`]: 'ok',
    [`${PREFIX}report_version`]: REPORT_VERSION,
    [`${PREFIX}variant`]: result.variant,
    [`${PREFIX}songs`]: result.songs,
    // (the place in the run: a device that warms up, or gets hot, is slower later)
    [`${PREFIX}order`]: order,
    [`${PREFIX}build_ms`]: round(result.buildMs),
    // (left off when no frame came, as the setlist's own are: a hidden page)
    ...(result.firstPaintMs === null
      ? {}
      : { [`${PREFIX}first_paint_ms`]: round(result.firstPaintMs) }),
    ...(result.settledMs === null ? {} : { [`${PREFIX}settled_ms`]: round(result.settledMs) }),
    [`${PREFIX}elements`]: result.elements,
    [`${PREFIX}shadow_roots`]: result.shadowRoots,
    [`${PREFIX}components`]: result.components,
    [`${PREFIX}scroll_frames`]: scroll.frames,
    [`${PREFIX}scroll_long_frames`]: scroll.long,
    [`${PREFIX}scroll_worst_ms`]: round(scroll.worstMs),
    [`${PREFIX}scroll_median_ms`]: round(scroll.medianMs),
    [`${PREFIX}scroll_p95_ms`]: round(scroll.p95Ms),
    [`${PREFIX}hidden`]: outcome.hidden,
    [`${PREFIX}stopped`]: outcome.stopped,
    [`${PREFIX}total_ms`]: round(outcome.durationMs),
    [`${PREFIX}cores`]: run.facts.cores,
    [`${PREFIX}reduced_motion`]: run.facts.reducedMotion,
    [`${PREFIX}controlled`]: run.facts.serviceWorker,
    [`${PREFIX}low_power`]: run.lowPower,
  }
}

/**
 * Send a finished test: a span for each timing. Says whether it was sent, which is whether reports
 * are on (the person is told, so that they can send the results another way if they are not).
 */
export function recordSpeedTest(outcome: SpeedTestOutcome, run: SpeedTestRun): boolean {
  if (!getTelemetryPreference()) return false
  outcome.results.forEach((result, order) => {
    recordSpan(`${PREFIX}run`, resultAttributes(result, order, outcome, run))
  })
  return true
}

/** Send that a test could not finish, and the error's class and message, as the app's other errors are */
export function recordSpeedTestFailure(error: unknown, run: SpeedTestRun): boolean {
  if (!getTelemetryPreference()) return false
  recordSpan(`${PREFIX}run`, {
    [`${PREFIX}id`]: run.id,
    [`${PREFIX}outcome`]: 'error',
    [`${PREFIX}report_version`]: REPORT_VERSION,
    [`${PREFIX}cores`]: run.facts.cores,
    [`${PREFIX}low_power`]: run.lowPower,
    'chordless.error': true,
    [`${PREFIX}error`]: error instanceof Error ? error.name : 'Error',
    [`${PREFIX}error_message`]: error instanceof Error ? error.message : String(error),
  })
  return true
}
