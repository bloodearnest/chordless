/**
 * The notes of one chart section, from the song's lead sheet: `docs/LEAD_SHEETS.md`, "In the chart". A part
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
 * The names a section goes by: "INTRO / TURNAROUND" is both, a chart's "Outro - 5/4" is Outro (a meter
 * after a dash is not a name), and a number or a letter after a number is a count of the same part
 * ("Interlude 1a" is the sheet's INTERLUDE, "Instrumental 2" its "INSTRUMENTAL 2")
 */
function namesOf(label: string): string[] {
  const names = label
    .replace(/\s+[-–]\s+\d+\/\d+.*$/, '')
    .split(/[/&]/)
    .map(plain)
    .filter(Boolean)
  return [...new Set(names.flatMap(n => [n, n.replace(/\d+[a-z]?$/, '')]))].filter(Boolean)
}

/** The words of a chart part, leaving out what is in brackets ("(To Br.)" is not a thing to sing) */
const wordsOf = (text: string) => lyricWords(text.replace(/\([^)]*\)/g, ' '))

/**
 * How many measures from `from` are cue notes and nothing sung, up to the next section's box. The sheets do
 * not always box what follows an instrumental, so the run ends where the singing starts and not at the next
 * box. A last measure may have a sung note in its final beat, the pickup into the part after; and the first
 * may have one held over from the part before (a tie), or nothing but that: both stay out of the slice
 * (`sliceMeasures` leaves sung notes out, and a measure with no cue notes that starts the run is not in it).
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
          if (i === from && e.tieStop) continue
          if (e.start >= m.length - 1) pickup = true
          else singing = true
        }
      }
    if (singing) break
    if (cues === 0) {
      // (the held note of the part before fills the first measure: the notes come after it)
      if (i === from && i + 1 < to) continue
      break
    }
    run.push(i)
    if (pickup) break
  }
  // A run that is cut short by singing and has more cue notes after it (the voices come in over an
  // instrumental, and it goes on) is only part of it: a partial line would mislead, so there is none
  const last = run[run.length - 1]
  if (last !== undefined)
    for (let i = last + 1; i < to; i++) {
      const notes = (melody.measures[i] as ScoreMeasure).voices
        .flat()
        .filter(e => e.kind === 'note')
      if (notes.some(e => e.cue) && !notes.some(e => !e.cue && sung(i, e))) return []
    }
  return run
}

/**
 * For each section of the chart, the measures (indices into the melody) that are its notes, or null where it
 * has none to show: it has words (a part to sing has the words as its content), or the sheet has no section of
 * its name, or that section opens with singing. A sheet's section that comes first with no box of its name
 * is the intro, and a short lead-in measure before the intro's box is part of it. Sections of one name go in
 * turn, and a sheet section with two names ("INTRO / TURNAROUND") gives its notes to each.
 */
export function cueMeasures(melody: Score, chart: ChartText[]): (number[] | null)[] {
  const out: (number[] | null)[] = chart.map(() => null)
  const sections = sheetSections(melody)
  const names = chart.map(c => namesOf(c.label))
  const claimed = new Set<number>()
  sections.forEach((section, k) => {
    let label = section.name
    let from = section.from
    if (k === 0 && !plain(label)) {
      // (a lead-in before the intro's box is the intro's, and a first part with no box at all is the intro)
      if (melody.measures[0]?.full === false && section.to === 1 && sections.length > 1) return
      label = 'intro'
    }
    if (
      k === 1 &&
      !sections[0]?.name &&
      melody.measures[0]?.full === false &&
      sections[0]?.to === 1
    ) {
      from = 0
    }
    const run = cueRun(melody, from, sections[k + 1]?.from ?? melody.measures.length)
    if (!run.length) return
    // (a part of the sheet's name that the chart has, one part of the chart at a time)
    for (const part of label.split(/[/&]/).map(plain).filter(Boolean)) {
      const bare = part.replace(/\d+[a-z]?$/, '')
      const exact = chart.findIndex(
        (c, i) => !claimed.has(i) && wordsOf(c.text).length === 0 && names[i]?.includes(part)
      )
      const at =
        exact >= 0
          ? exact
          : chart.findIndex(
              (c, i) => !claimed.has(i) && wordsOf(c.text).length === 0 && names[i]?.includes(bare)
            )
      if (at < 0) continue
      claimed.add(at)
      out[at] = run
    }
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
