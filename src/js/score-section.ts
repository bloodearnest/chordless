/**
 * The notes of one chart section, from the song's lead sheet: `docs/MELODY.md`, "In the chart". A part
 * of the chart with no words (an intro, an instrumental) can be shown as the cue-size notes the sheet
 * has for it, a line of music in place of its chords. `cueMeasures` finds which measures of the sheet
 * are which chart section's, and `sliceMeasures` cuts them out of a melody (that is already in the
 * song's key, so the octave is the whole sheet's choice and not the slice's).
 */
import type { ParsedChart } from './data-types.ts'
import type { Score, ScoreMeasure } from './score.ts'
import { type ChartText, sheetSections } from './score-structure.ts'
import { sungNotes } from './score-transpose.ts'
import { lyricWords } from './utils/lyric-words.ts'

/** A name as the sheet and the chart are compared by: "INTRO" and "Intro", "Pre-Chorus" and "PRE CHORUS" */
const plain = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '')

/**
 * How many measures from `from` are cue notes and nothing sung, up to the next section's box. The sheets do
 * not always box what follows an instrumental, so the run ends where the singing starts and not at the next
 * box. One last measure may have a sung note in its final beat: the pickup into the part after (its note
 * is left out of the slice, `sliceMeasures`).
 */
function cueRun(melody: Score, from: number, to: number): number[] {
  const sung = sungNotes(melody)
  const run: number[] = []
  for (let i = from; i < to; i++) {
    const m = melody.measures[i] as ScoreMeasure
    let cues = 0
    let singing = false
    let pickup = false
    for (const voice of m.voices)
      for (const e of voice) {
        if (e.kind !== 'note') continue
        if (e.cue) cues++
        else if (sung(i, e)) {
          if (e.start >= m.length - 1) pickup = true
          else singing = true
        }
      }
    if (singing || cues === 0) break
    run.push(i)
    if (pickup) break
  }
  return run
}

/**
 * For each section of the chart, the measures (indices into the melody) that are its notes, or null where it
 * has none to show: it has words (a part to sing has no staff of its own), or the sheet has no section of its
 * name, or that section opens with singing. A sheet's section that comes first with no box of its name is the
 * intro, and a short lead-in measure before the intro's box is part of it. Sections of one name go in turn.
 */
export function cueMeasures(melody: Score, chart: ChartText[]): (number[] | null)[] {
  const out: (number[] | null)[] = chart.map(() => null)
  const sections = sheetSections(melody)
  const claimed = new Set<number>()
  sections.forEach((section, k) => {
    let name = plain(section.name)
    let from = section.from
    if (k === 0 && !name) {
      // (a lead-in before the intro's box is the intro's, and a first part with no box at all is the intro)
      if (melody.measures[0]?.full === false && section.to === 1 && sections.length > 1) return
      name = 'intro'
    }
    const next = sections[k + 1]
    if (
      k === 1 &&
      !sections[0]?.name &&
      melody.measures[0]?.full === false &&
      sections[0]?.to === 1
    ) {
      from = 0
    }
    const at = chart.findIndex(
      (c, i) => !claimed.has(i) && plain(c.label) === name && lyricWords(c.text).length === 0
    )
    if (at < 0) return
    claimed.add(at)
    const run = cueRun(melody, from, next?.from ?? melody.measures.length)
    if (run.length) out[at] = run
  })
  return out
}

/**
 * The melody cut to these measures: no title or notice (they are on the sheet of the whole song, and
 * the section's own label is above), no section box on the first, and only the cue notes: the sung ones (a
 * pickup into the next part) and the rests of the voice that sings are left out
 */
export function sliceMeasures(melody: Score, measures: number[]): Score {
  return {
    ...melody,
    title: null,
    notice: [],
    measures: measures.map(index => {
      const m = melody.measures[index] as ScoreMeasure
      const cues = m.voices
        .map(voice => voice.filter(e => e.cue))
        .filter(voice => voice.some(e => e.kind === 'note'))
      return { ...m, section: null, voices: cues.length ? cues : m.voices }
    }),
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
