/**
 * The notes of one chart section, from the song's lead sheet: `docs/MELODY.md`, "In the chart". An
 * instrumental section (an intro, a turnaround: the sheet has notes in it and none are sung) can be
 * shown as a line of music in place of its chords and lyrics. `cueMeasures` finds which measures of the
 * sheet are which chart section's, and `sliceMeasures` cuts them out of a melody (that is already
 * in the song's key, so the octave is the whole sheet's choice and not the slice's).
 */
import type { Score } from './score.ts'
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
      for (const voice of melody.measures[index]?.voices ?? [])
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
    measures: measures.flatMap(index => {
      const m = melody.measures[index]
      return m ? [{ ...m, section: null }] : []
    }),
  }
}
