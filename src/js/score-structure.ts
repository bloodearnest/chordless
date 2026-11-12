/**
 * The structure of a song as its lead sheet plays it: `docs/LEAD_SHEETS.md`, "Structure". The sheet
 * writes each section once, with repeat signs, numbered endings and jumps (D.S., D.C., coda, Fine);
 * `playOrder` follows them to give the measures in the order they are played, `playSteps` groups
 * those into the sections they come from, and `matchChart` finds the chart's section for each step
 * by the lyrics (the sheet's names and the chart's rarely agree: "CHORUS 1 & 2" is two chart sections).
 *
 * The conventions followed are the usual ones: a repeat is played twice unless an instruction says
 * ("Play 3 times", "(4x)"), the repeats are not taken again after a D.S. or D.C., and "to Coda" is
 * taken on the way through after a jump.
 */
import type { Score, ScoreMeasure } from './score.ts'
import { lyricWords } from './utils/lyric-words.ts'

export interface SheetSection {
  name: string
  /** Measure indices into `melody.measures`: from, up to but not including `to` */
  from: number
  to: number
}

/** The sections a sheet is boxed into, in order; measures before the first box are a section of no name */
export function sheetSections(melody: Score): SheetSection[] {
  const out: SheetSection[] = []
  melody.measures.forEach((m, i) => {
    if (m.section || i === 0) {
      const last = out[out.length - 1]
      if (last) last.to = i
      out.push({ name: m.section ?? '', from: i, to: melody.measures.length })
    }
  })
  return out
}

/** Whether the ending's numbers ("1", "2,3") include this pass */
function endingHas(label: string, pass: number): boolean {
  return label.split(',').some(n => Number(n.trim()) === pass)
}

/** How many times the repeat that ends at `end` and starts at `start` is played, from a "Play 3 times" or "(4x)" in it */
function timesOf(measures: ScoreMeasure[], start: number, end: number): number {
  for (let i = start; i <= end; i++)
    for (const d of measures[i]?.directions ?? []) {
      const m = d.kind === 'text' ? /(\d+)\s*(?:x\b|times)/i.exec(d.text) : null
      if (m && !/^\s*\(?\d+(?:st|nd|rd|th)/i.test(d.text)) return Number(m[1])
    }
  return 2
}

/** One measure as played: its index, and the pass of the repeat it is in (1 for the first time through) */
export interface Played {
  measure: number
  pass: number
}

/** The measures in the order they are played, following the repeats, endings and jumps */
export function playOrder(melody: Score): Played[] {
  const ms = melody.measures
  const out: Played[] = []
  const has = (m: ScoreMeasure | undefined, kind: string) =>
    !!m?.directions.some(d => d.kind === kind)
  const segnoAt = ms.findIndex(m => has(m, 'segno'))
  let codaAt = -1
  ms.forEach((m, i) => {
    if (has(m, 'coda')) codaAt = i
  })
  let i = 0
  let pass = 1
  let start = 0
  let jumped: 'coda' | 'fine' | 'plain' | null = null
  for (let steps = 0; i < ms.length && steps < 5000; steps++) {
    const m = ms[i] as ScoreMeasure
    if (m.repeatStart && !jumped) {
      start = i
    }
    // An ending that is not for this pass is skipped; after a jump only the last one is played
    if (m.ending?.start || (m.ending && out.length === 0)) {
      let last = 0
      for (let j = i; ms[j]?.ending; j++)
        last = Math.max(last, ...(ms[j]?.ending?.label.split(',').map(Number) ?? [0]))
      const mine = jumped
        ? (m.ending.label.split(',').map(Number) as number[]).includes(last)
        : endingHas(m.ending.label, pass)
      if (!mine) {
        let j = i
        while (ms[j]?.ending && (j === i || !ms[j]?.ending?.start)) j++
        i = j
        continue
      }
    }
    out.push({ measure: i, pass: jumped ? 1 : pass })

    const dirs = m.directions
    const toCoda = dirs.some(d => d.kind === 'to-coda') || (has(m, 'coda') && i !== codaAt)
    if (jumped === 'coda' && toCoda && codaAt > i) {
      i = codaAt
      jumped = 'plain'
      continue
    }
    if (jumped === 'fine' && has(m, 'fine')) break
    if (!jumped) {
      const jump = dirs.find(d => d.kind === 'da-segno' || d.kind === 'da-capo')
      if (jump) {
        jumped = jump.al ?? 'plain'
        i = jump.kind === 'da-segno' && segnoAt >= 0 ? segnoAt : 0
        continue
      }
      if (m.barline === 'repeat-end') {
        if (pass < timesOf(ms, start, i)) {
          pass++
          i = start
          continue
        }
        pass = 1
        start = i + 1
      }
    }
    i++
  }
  return out
}

/**
 * One go at a section: the runs of measures played in it (an ending that is skipped leaves a gap),
 * in the pass of the repeat it was played in.
 */
export interface PlayStep {
  /** Index into `sheetSections` */
  section: number
  /** The first measure played, and the one after the last */
  from: number
  to: number
  /** The runs of measure indices played: `[from, to)` each, in order */
  spans: [number, number][]
  /** The pass of the repeat it was played in: 1 for the first time, 2 for the second */
  pass: number
}

export function playSteps(melody: Score, order = playOrder(melody)): PlayStep[] {
  const sections = sheetSections(melody)
  const sectionOf = (measure: number) =>
    sections.findIndex(s => measure >= s.from && measure < s.to)
  const steps: PlayStep[] = []
  let prev = -2
  for (const { measure, pass } of order) {
    const section = sectionOf(measure)
    const last = steps[steps.length - 1]
    // (the same section in the same pass is one go, even with an ending skipped in the middle)
    if (last && last.section === section && last.pass === pass && measure > prev) {
      const span = last.spans[last.spans.length - 1] as [number, number]
      if (span[1] === measure) span[1]++
      else last.spans.push([measure, measure + 1])
      last.to = measure + 1
    } else
      steps.push({ section, from: measure, to: measure + 1, spans: [[measure, measure + 1]], pass })
    prev = measure
  }
  return steps
}

/**
 * The lyric words of a run of measures, for a verse (0 is the first). A verse the run has no words
 * for (the chorus a second time, written once) is read from the first.
 */
export function stepWords(melody: Score, step: PlayStep, verse = step.pass - 1): string[] {
  const read = (v: number) => {
    let text = ''
    for (const [from, to] of step.spans)
      for (const m of melody.measures.slice(from, to))
        for (const voice of m.voices)
          for (const e of voice) {
            const syl = e.kind === 'note' && !e.cue ? e.syllables[v] : ''
            if (syl) text += syl.endsWith('-') ? syl.slice(0, -1) : `${syl} `
          }
    return lyricWords(text)
  }
  const mine = read(verse)
  return mine.length || verse === 0 ? mine : read(0)
}

/** A section of the chart: its label and the lyrics in it */
export interface ChartText {
  label: string
  text: string
}

/**
 * How alike two lyrics are, 0 to 1: the Dice coefficient of their word pairs, or of their words
 * (counted for less) where the words are the same but the order is not, as when a section is
 * sung from a different place.
 */
export function lyricSimilarity(a: string[], b: string[]): number {
  const dice = (x: Set<string>, y: Set<string>) => {
    if (!x.size || !y.size) return 0
    let both = 0
    for (const g of x) if (y.has(g)) both++
    return (2 * both) / (x.size + y.size)
  }
  const pairs = (w: string[]) => new Set(w.slice(1).map((x, i) => `${w[i]} ${x}`))
  const single = dice(new Set(a), new Set(b))
  return a.length < 2 || b.length < 2 ? single : Math.max(dice(pairs(a), pairs(b)), single * 0.85)
}

/** How many verses of lyrics are written under a run of measures (strophic songs print all of them under one section) */
export function verseRows(melody: Score, step: PlayStep): number {
  let rows = 0
  for (const [from, to] of step.spans)
    for (const m of melody.measures.slice(from, to))
      for (const voice of m.voices)
        for (const e of voice)
          if (e.kind === 'note' && !e.cue)
            e.syllables.forEach((s, i) => {
              if (s) rows = Math.max(rows, i + 1)
            })
  return rows
}

/** The chart sections the lyrics of every verse of a step say, best match first for each verse; null where none is near */
export function matchVerses(melody: Score, step: PlayStep, chart: ChartText[]): (string | null)[] {
  const chartWords = chart.map(c => lyricWords(c.text))
  return Array.from({ length: Math.max(1, verseRows(melody, step)) }, (_, v) => {
    const mine = stepWords(melody, step, v)
    const scores = chartWords.map(w => lyricSimilarity(mine, w))
    const best = Math.max(0, ...scores)
    return mine.length >= 3 && best >= 0.3 ? (chart[scores.indexOf(best)] as ChartText).label : null
  })
}

export interface Matched {
  step: PlayStep
  /** The chart section it is, or null where the lyrics do not say */
  label: string | null
  score: number
}

/**
 * The chart section of each step, by the lyrics: the sheet's words (the verse of the pass) against
 * each chart section's. Identical sections (Chorus 1, Chorus 2) go to the first one not used yet.
 * A step with no words (an instrumental) goes by the name of its sheet section.
 */
export function matchChart(melody: Score, steps: PlayStep[], chart: ChartText[]): Matched[] {
  const sections = sheetSections(melody)
  const chartWords = chart.map(c => lyricWords(c.text))
  const used = new Set<number>()
  return steps.map(step => {
    const mine = stepWords(melody, step)
    if (mine.length < 3) {
      const name = (sections[step.section]?.name ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
      const byName = chart.findIndex(
        c => name && c.label.toLowerCase().replace(/[^a-z0-9]/g, '') === name
      )
      return { step, label: byName >= 0 ? (chart[byName] as ChartText).label : null, score: 0 }
    }
    const scores = chartWords.map(w => lyricSimilarity(mine, w))
    const best = Math.max(0, ...scores)
    if (best < 0.3) return { step, label: null, score: best }
    const tied = scores.flatMap((s, i) => (s >= best - 0.15 ? [i] : []))
    // (the earliest of the near matches not used yet: a chart repeats a chorus's words in its ending)
    const pick = tied.find(i => !used.has(i)) ?? (scores.indexOf(best) as number)
    used.add(pick)
    return { step, label: (chart[pick] as ChartText).label, score: best }
  })
}
