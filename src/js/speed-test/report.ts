/**
 * What the speed test says (docs/SPEED_TEST.md): plain text, to be read by a person at the other end
 * and pasted into a message. The device's details are the ones the Contact page gives (contact.ts),
 * so that the Support ID, the version and the device are there as they are in any message to us.
 * Nothing of anyone's is in it: the songs it times are made up.
 */
import { type SupportInfo, supportDetails } from '../contact.ts'
import type { RunResult, SpeedTestOutcome } from './runner.ts'
import type { VariantId } from './variants.ts'

/** Said in the report if the way it is written changes, so that reports can be read by the version */
export const REPORT_VERSION = 1

/** What each way of drawing is, as the report says it (for us to read: the words stay in code, as the Contact page's details do) */
const VARIANT_NAMES: Record<VariantId, string> = {
  real: 'Real: as Chordless draws a setlist, with chords',
  lyrics: 'Lyrics: the same components with no chords',
  plain: 'Plain: the same words and chords as ordinary elements, with no components',
}

/** Whether Low Power Mode is on: a page cannot see it, so the person says (it caps a screen at 30 fps) */
export type LowPower = 'on' | 'off' | 'unknown'

/** What is known of the device that the Contact page's details do not have */
export interface SpeedTestFacts {
  /** `navigator.hardwareConcurrency` */
  cores: number
  reducedMotion: boolean
  /** The page is under a service worker, as an installed or offline-ready app is */
  serviceWorker: boolean
  /** The theme the page was drawn in (a light page and a dark one are not drawn alike) */
  theme: 'light' | 'dark' | 'unknown'
}

/** The theme from the root's `color-scheme`, which the theme manager sets to the one in use */
function themeOf(colorScheme: string): SpeedTestFacts['theme'] {
  return colorScheme === 'light' || colorScheme === 'dark' ? colorScheme : 'unknown'
}

/** What this device says of itself that the speed test is read against */
export function deviceFacts(): SpeedTestFacts {
  return {
    cores: navigator.hardwareConcurrency,
    reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    serviceWorker: navigator.serviceWorker?.controller != null,
    theme: themeOf(getComputedStyle(document.documentElement).colorScheme),
  }
}

export interface ReportInput {
  info: SupportInfo
  facts: SpeedTestFacts
  /** What the person said of Low Power Mode */
  lowPower: LowPower
  outcome: SpeedTestOutcome
  /** What the person said of the device (the battery, other apps) */
  note: string
  when: Date
}

const ms = (value: number | null): string =>
  value === null ? 'none (page hidden)' : `${Math.round(value)} ms`

function resultLine(result: RunResult): string {
  const { scroll } = result
  const percent = scroll.frames ? Math.round((scroll.long / scroll.frames) * 100) : 0
  return [
    `  ${result.songs} songs: first painted after ${ms(result.firstPaintMs)}, all drawn after ${ms(result.settledMs)}`,
    `(building them took ${ms(result.buildMs)}). The page had ${result.elements} elements, ${result.shadowRoots} shadow roots and ${result.components} components.`,
    `Scrolling: ${scroll.long} of ${scroll.frames} frames long (${percent}%), worst ${ms(scroll.worstMs)}, median ${ms(scroll.medianMs)}, 95th ${ms(scroll.p95Ms)}.`,
  ].join(' ')
}

export function speedTestReport({
  info,
  facts,
  lowPower,
  outcome,
  note,
  when,
}: ReportInput): string {
  const lines = [
    `Chordless speed test (report version ${REPORT_VERSION})`,
    supportDetails(info),
    `Cores: ${facts.cores || 'not said'}, reduced motion: ${facts.reducedMotion ? 'on' : 'off'}, service worker: ${facts.serviceWorker ? 'yes' : 'no'}, theme: ${facts.theme}`,
    `Low Power Mode: ${lowPower === 'unknown' ? 'not said' : lowPower}`,
    `Run: ${when.toISOString()}, taking ${Math.round(outcome.durationMs / 1000)} s`,
  ]
  const said = note.trim()
  if (said) lines.push(`Note: ${said}`)
  if (outcome.stopped) lines.push('Stopped before the end: these are the timings so far.')
  if (outcome.hidden) {
    lines.push(
      'The page was hidden while it ran (the screen locked or another app was in front): some of these numbers are wrong.'
    )
  }
  for (const id of Object.keys(VARIANT_NAMES) as VariantId[]) {
    const results = outcome.results.filter(result => result.variant === id)
    if (results.length === 0) continue
    lines.push('', `${VARIANT_NAMES[id]}:`, ...results.map(resultLine))
  }
  return lines.join('\n')
}
