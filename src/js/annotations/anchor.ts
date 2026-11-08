/**
 * Where an annotation sits on a chart, and finding that place again (docs/ANNOTATIONS.md).
 *
 * A chart is fixed in place, and the fix reaches every device by sync (with no record of what it was
 * before), so an annotation finds its place again from what it keeps plus the chart as it is. An
 * anchor names a section by label and a spot by the lyrics around it, and keeps a snapshot of the
 * line, the lines either side and the section's first line. Found again, by how alike the lines are,
 * its stored anchor is rebuilt from the chart as it now is ("healed"), so the next edit starts from
 * here and a run of small edits does not wear the match away. One that cannot be placed is orphaned
 * (never dropped), and a guess that is not sure leaves what is stored alone, so undoing the edit
 * finds it again.
 */
import type { AnnotationAnchor, ChartAnnotation, ChartSection } from '../data-types.ts'
import { normalLyrics } from '../utils/lyric-words.ts'

/** How many characters of lyrics either side of a spot an anchor remembers */
const CONTEXT = 12
/** How much of a line, of a line beside it, and of a section's first line a snapshot keeps */
const LINE_CAP = 120
const NEIGHBOUR_CAP = 60
const HEAD_CAP = 60
/** How alike two lines must be (0 to 1) to be the same line, reworded; and to count as a neighbour that is the same */
const SAME_LINE = 0.6
const SAME_NEIGHBOUR = 0.8
/** How alike two sections' first lines must be for one to be the other, renamed */
const SAME_SECTION = 0.7

/** The lyrics of a line as one string, chords left out */
export function lineLyrics(section: ChartSection, line: number): string {
  return section.lines[line]?.segments.map(s => s.lyrics).join('') ?? ''
}

/** How alike two lines are: 1 if they say the same, falling as more has to be changed to make one the other */
export function similarity(a: string, b: string): number {
  const x = normalLyrics(a)
  const y = normalLyrics(b)
  if (x === y) return 1
  if (!x || !y) return 0
  let previous = Array.from({ length: y.length + 1 }, (_, i) => i)
  for (let i = 1; i <= x.length; i++) {
    const row = [i]
    for (let j = 1; j <= y.length; j++) {
      row[j] = Math.min(
        (previous[j] as number) + 1,
        (row[j - 1] as number) + 1,
        (previous[j - 1] as number) + (x[i - 1] === y[j - 1] ? 0 : 1)
      )
    }
    previous = row
  }
  return 1 - (previous[y.length] as number) / Math.max(x.length, y.length)
}

/** A line of a section's lyrics, '' beyond its ends */
const lineAt = (section: ChartSection, line: number) => lineLyrics(section, line)

/** The first line of a section that says anything */
function sectionHead(section: ChartSection): string {
  for (let i = 0; i < section.lines.length; i++) {
    const text = lineLyrics(section, i)
    if (normalLyrics(text)) return text.slice(0, HEAD_CAP)
  }
  return ''
}

/** Which of the lines of a section that say the same this is, from 0 */
function occurrence(section: ChartSection, line: number): number {
  const key = normalLyrics(lineLyrics(section, line))
  let seen = 0
  for (let i = 0; i < line; i++) if (normalLyrics(lineLyrics(section, i)) === key) seen++
  return seen
}

function nthOfLabel(sections: ChartSection[], index: number): number {
  const label = (sections[index] as ChartSection).label
  let nth = 0
  for (let i = 0; i < index; i++) if ((sections[i] as ChartSection).label === label) nth++
  return nth
}

function findSection(sections: ChartSection[], label: string | null, nth: number): number {
  let seen = 0
  for (let i = 0; i < sections.length; i++) {
    if ((sections[i] as ChartSection).label !== label) continue
    if (seen === nth) return i
    seen++
  }
  return -1
}

/** The anchor for a section's title */
export function sectionAnchor(sections: ChartSection[], section: number): AnnotationAnchor {
  const here = sections[section] as ChartSection
  return {
    kind: 'section',
    label: here.label,
    nth: nthOfLabel(sections, section),
    sectionHead: sectionHead(here),
  }
}

/** The anchor for a spot `offset` characters into a line's lyrics */
export function textAnchor(
  sections: ChartSection[],
  section: number,
  line: number,
  offset: number
): AnnotationAnchor {
  const here = sections[section] as ChartSection
  const text = lineLyrics(here, line)
  const at = Math.max(0, Math.min(offset, text.length))
  return {
    kind: 'text',
    label: here.label,
    nth: nthOfLabel(sections, section),
    line,
    offset: at,
    before: text.slice(Math.max(0, at - CONTEXT), at),
    after: text.slice(at, at + CONTEXT),
    lineText: text.slice(0, LINE_CAP),
    prevLine: lineAt(here, line - 1).slice(0, NEIGHBOUR_CAP),
    nextLine: lineAt(here, line + 1).slice(0, NEIGHBOUR_CAP),
    occ: occurrence(here, line),
    sectionHead: sectionHead(here),
  }
}

/**
 * The nearest place in a line an annotation can sensibly start, to an approximate offset: the start of a
 * word, or of a segment (where a chord is). Offsets worked out from lyrics as drawn (with the
 * chords hidden, hyphens and spaces are folded) can be a few characters off the chart's own.
 */
export function snapOffset(section: ChartSection, line: number, approx: number): number {
  const text = lineLyrics(section, line)
  const starts = new Set<number>([0])
  let at = 0
  for (const segment of section.lines[line]?.segments ?? []) {
    starts.add(at)
    at += segment.lyrics.length
  }
  for (let i = 1; i < text.length; i++) {
    if (/\S/.test(text[i] as string) && /[\s-]/.test(text[i - 1] as string)) starts.add(i)
  }
  let best = 0
  for (const start of starts) {
    if (Math.abs(start - approx) < Math.abs(best - approx)) best = start
  }
  return Math.min(best, text.length)
}

/** Where an annotation has been placed on the chart as it is now */
export type Placement =
  | { place: 'song' }
  | { place: 'section'; section: number }
  | { place: 'text'; section: number; line: number; offset: number }
  /** Its place is gone from the chart: shown with the song's annotations, marked */
  | { place: 'orphan' }

/** A placement, and whether it was found for sure (a guess at the section, or none, is not) */
export type Resolved = Placement & { sure: boolean }

type TextAnchor = Extract<AnnotationAnchor, { kind: 'text' }>

/** Whether `anchor` still reads true at `offset` of `text` */
function holdsAt(text: string, offset: number, anchor: TextAnchor): boolean {
  return (
    offset <= text.length &&
    text.slice(Math.max(0, offset - anchor.before.length), offset) === anchor.before &&
    text.slice(offset, offset + anchor.after.length) === anchor.after
  )
}

/** Where words start in some text */
const wordStarts = (text: string) => Array.from(text.matchAll(/\S+/g), match => match.index ?? 0)

/** Where in a line (as it is now) the spot that was `anchor.offset` into the line it was is */
function offsetIn(text: string, anchor: TextAnchor): number {
  const clamp = (at: number) => Math.max(0, Math.min(at, text.length))
  if (
    anchor.lineText !== undefined &&
    anchor.lineText === text.slice(0, LINE_CAP) &&
    holdsAt(text, anchor.offset, anchor)
  ) {
    return clamp(anchor.offset)
  }
  // The text either side of the spot, as it was
  const around = anchor.before + anchor.after
  if (around) {
    const at = text.indexOf(around)
    if (at >= 0) return clamp(at + anchor.before.length)
  }
  // The word it was at the start of, wherever that is now; else the same word by number
  const now = wordStarts(text)
  if (!now.length) return 0
  const first = /\S+/.exec(anchor.after)?.[0]
  const wasAt = wordStarts((anchor.lineText as string).slice(0, anchor.offset)).length
  if (first) {
    const same = now.filter(start => text.startsWith(first, start))
    if (same.length) {
      return same.reduce((best, start) =>
        Math.abs(start - anchor.offset) < Math.abs(best - anchor.offset) ? start : best
      )
    }
  }
  return now[Math.min(wasAt, now.length - 1)] as number
}

/**
 * How much a line that was split, or joined to another, is still the line it was: one of them
 * contained in the other, scored by how much of the longer the shorter is (0 if it is not, or is
 * too short to mean anything)
 */
function contained(a: string, b: string): number {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a]
  if (short.length < 8 || !long.includes(short)) return 0
  return 0.65 + 0.3 * (short.length / long.length)
}

/** The line most like the one an anchor was made on, with the section it is in */
function bestLine(sections: ChartSection[], anchor: TextAnchor, own: number) {
  const memo = new Map<string, number>()
  const alike = (a: string, b: string) => {
    const key = `${a}\u0000${b}`
    let value = memo.get(key)
    if (value === undefined) {
      value = similarity(a, b)
      memo.set(key, value)
    }
    return value
  }
  const wanted = anchor.lineText as string
  const wantedNormal = normalLyrics(wanted)
  let best: { section: number; line: number; score: number } | null = null
  for (const [si, section] of sections.entries()) {
    for (let li = 0; li < section.lines.length; li++) {
      const text = lineLyrics(section, li)
      const sim = Math.max(
        alike(wanted, text.slice(0, LINE_CAP)),
        contained(wantedNormal, normalLyrics(text.slice(0, LINE_CAP)))
      )
      if (sim < SAME_LINE) continue
      let score = sim
      if (si === own) score += 0.1
      // The lines beside it tell apart lines that are repeated (a chorus says its line again)
      const before = lineAt(section, li - 1).slice(0, NEIGHBOUR_CAP)
      const after = lineAt(section, li + 1).slice(0, NEIGHBOUR_CAP)
      if (alike(anchor.prevLine ?? '', before) >= SAME_NEIGHBOUR) score += 0.1
      if (alike(anchor.nextLine ?? '', after) >= SAME_NEIGHBOUR) score += 0.1
      if (sim === 1 && anchor.occ === occurrence(section, li)) score += 0.05
      // Nearest where it was, when all else is equal
      score -= 0.001 * Math.abs(li - anchor.line) + (si === own ? 0 : 0.001 * Math.abs(si - own))
      if (!best || score > best.score) best = { section: si, line: li, score }
    }
  }
  return best
}

/** The section a title (or a spot's section) is on, if it is there: by label, else by its first line */
function sectionFor(
  sections: ChartSection[],
  anchor: { label: string | null; nth: number; sectionHead?: string }
): { index: number; sure: boolean } | null {
  const named = findSection(sections, anchor.label, anchor.nth)
  if (named >= 0) return { index: named, sure: true }
  // Renamed or renumbered: the section whose first line is the same
  if (anchor.sectionHead) {
    let best = -1
    let score = SAME_SECTION
    sections.forEach((section, i) => {
      const sim = similarity(anchor.sectionHead as string, sectionHead(section))
      if (sim >= score) {
        best = i
        score = sim
      }
    })
    if (best >= 0) return { index: best, sure: true }
  }
  // The same name, another one of them (one was taken away)
  const same = sections
    .map((section, i) => ({ section, i }))
    .filter(({ section }) => section.label === anchor.label)
  const near = same.sort((a, b) => Math.abs(a.i - anchor.nth) - Math.abs(b.i - anchor.nth))[0]
  return near ? { index: near.i, sure: false } : null
}

export function resolveAnchor(sections: ChartSection[], anchor: AnnotationAnchor): Resolved {
  if (anchor.kind === 'song') return { place: 'song', sure: true }
  if (anchor.kind === 'section') {
    const found = sectionFor(sections, anchor)
    return found
      ? { place: 'section', section: found.index, sure: found.sure }
      : { place: 'orphan', sure: false }
  }

  const own = sectionFor(sections, anchor)
  const ownIndex = own?.index ?? -1

  if (anchor.lineText === undefined) {
    // Made before lines were kept: the text either side of the spot, in its section, then anywhere
    const order = sections
      .map((_, i) => i)
      .sort((a, b) => (a === ownIndex ? -1 : b === ownIndex ? 1 : a - b))
    for (const si of order) {
      const section = sections[si] as ChartSection
      const lines = section.lines
        .map((_, i) => i)
        .sort((a, b) => Math.abs(a - anchor.line) - Math.abs(b - anchor.line))
      for (const li of lines) {
        const text = lineLyrics(section, li)
        if (si === ownIndex && li === anchor.line && holdsAt(text, anchor.offset, anchor)) {
          return { place: 'text', section: si, line: li, offset: anchor.offset, sure: true }
        }
        const around = anchor.before + anchor.after
        const at = around ? text.indexOf(around) : -1
        if (at >= 0)
          return {
            place: 'text',
            section: si,
            line: li,
            offset: at + anchor.before.length,
            sure: true,
          }
      }
    }
  } else {
    const found = bestLine(sections, anchor, ownIndex)
    if (found) {
      const text = lineLyrics(sections[found.section] as ChartSection, found.line)
      return {
        place: 'text',
        section: found.section,
        line: found.line,
        offset: offsetIn(text, anchor),
        sure: true,
      }
    }
  }
  // Its line is gone: on its section if that is there, which is a guess that leaves what is stored alone
  return own
    ? { place: 'section', section: own.index, sure: false }
    : { place: 'orphan', sure: false }
}

export interface PlacedAnnotation {
  annotation: ChartAnnotation
  placement: Placement
  /** Where it is stored, if that is not where it is now: the anchor to keep instead (see healedAnchor) */
  healed?: AnnotationAnchor
}

/** Anchors are equal when every field is, whatever the order they were written in */
function sameAnchor(a: AnnotationAnchor, b: AnnotationAnchor): boolean {
  const flat = (anchor: AnnotationAnchor) =>
    JSON.stringify(Object.entries(anchor).sort(([x], [y]) => (x < y ? -1 : 1)))
  return flat(a) === flat(b)
}

/**
 * The anchor to keep for an annotation found for sure: rebuilt from the chart as it is now, if
 * that differs from what is kept (it moved, or the line changed, or what is kept is from before
 * snapshots). Nothing for one that was not found for sure.
 */
export function healedAnchor(
  sections: ChartSection[],
  anchor: AnnotationAnchor,
  resolved: Resolved
): AnnotationAnchor | undefined {
  if (!resolved.sure) return undefined
  let rebuilt: AnnotationAnchor
  if (resolved.place === 'text')
    rebuilt = textAnchor(sections, resolved.section, resolved.line, resolved.offset)
  else if (resolved.place === 'section') rebuilt = sectionAnchor(sections, resolved.section)
  else return undefined
  return sameAnchor(rebuilt, anchor) ? undefined : rebuilt
}

export function placeAnnotations(
  sections: ChartSection[],
  annotations: ChartAnnotation[]
): PlacedAnnotation[] {
  return annotations.map(annotation => {
    const resolved = resolveAnchor(sections, annotation.anchor)
    const { sure: _sure, ...placement } = resolved
    const healed = healedAnchor(sections, annotation.anchor, resolved)
    return { annotation, placement: placement as Placement, ...(healed && { healed }) }
  })
}
