/**
 * The notes of one chart section, from the song's lead sheet: `docs/MELODY.md`, "In the chart". An
 * instrumental section (an intro, a turnaround: the sheet has notes in it and none are sung) can be
 * shown as a line of music in place of its chords and lyrics. `cueMeasures` finds which measures of the
 * sheet are which chart section's, and `sliceMeasures` cuts them out of a melody (that is already
 * in the song's key, so the octave is the whole sheet's choice and not the slice's).
 */
import type { ParsedChart } from './data-types.ts'
import type { Score, ScoreMeasure } from './score.ts'
import { type ChartText, matchChart, playSteps } from './score-structure.ts'
import { sungNotes } from './score-transpose.ts'

/**
 * For each section of the chart, the measures (indices into the melody) that are its notes, or null
 * where it has none to show: the sheet has no section for it, or the section has anything sung in it.
 * A section the sheet plays more than once is given its first go.
 */
export function cueMeasures(melody: Score, chart: ChartText[]): (number[] | null)[] {
  const out: (number[] | null)[] = chart.map(() => null)
  const sung = sungNotes(melody)
  const steps = playSteps(melody)
  const claimed = new Set<number>()
  for (const { step, label } of matchChart(melody, steps, chart)) {
    if (!label) continue
    // (two sections with one name go in turn: the sheet's first Instrumental to the chart's first)
    const at = chart.findIndex((c, i) => c.label === label && !claimed.has(i))
    if (at < 0) continue
    claimed.add(at)
    const measures = step.spans.flatMap(([from, to]) =>
      Array.from({ length: to - from }, (_, i) => from + i)
    )
    let notes = 0
    let singing = false
    for (const index of measures)
      for (const voice of (melody.measures[index] as ScoreMeasure).voices)
        for (const e of voice)
          if (e.kind === 'note') {
            notes++
            if (sung(index, e)) singing = true
          }
    if (notes > 0 && !singing) out[at] = measures
  }
  return out
}

/**
 * The melody cut to these measures: no title or notice (they are on the sheet of the whole song, and
 * the section's own label is above), and no section box on its first measure
 */
export function sliceMeasures(melody: Score, measures: number[]): Score {
  return {
    ...melody,
    title: null,
    notice: [],
    measures: measures.map(index => ({
      ...(melody.measures[index] as ScoreMeasure),
      section: null,
    })),
  }
}

/** A song's lead sheet and the measures of it that are each section of the chart's (null where a section has no notes to show) */
export interface SongCues {
  melody: Score
  /** The key the melody is written in */
  key: string
  measures: (number[] | null)[]
}

/** The sections of a chart as the sheet is matched to them: the label and the words of each */
export function chartTexts(parsed: ParsedChart): ChartText[] {
  return parsed.sections.map(section => ({
    label: section.label ?? '',
    text: section.lines.map(line => line.segments.map(s => s.lyrics).join('')).join(' '),
  }))
}

/** The cues of a song from its melody; null if no section of the chart has notes to show */
export function songCues(
  found: { melody: Score; key: string } | null,
  parsed: ParsedChart | null
): SongCues | null {
  if (!found || !parsed?.sections) return null
  const measures = cueMeasures(found.melody, chartTexts(parsed))
  return measures.some(Boolean) ? { melody: found.melody, key: found.key, measures } : null
}
