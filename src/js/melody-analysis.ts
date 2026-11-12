/**
 * What a song's melody says about singing it (docs/LEAD_SHEETS.md, "Uses"), worked out from the score
 * kept on the device each time it is wanted, not stored in the chart: the score is the source, so
 * the numbers cannot disagree with it. A range typed into the chart (`x_chordless_range`) is the
 * person's, and wins; it is also all there is for a song with no melody.
 */

import { rangeOfMetadata } from './chart-range.ts'
import type { ChartMetadata, ScoreRecord } from './data-types.ts'
import type { Score } from './score.ts'
import { readMusicXml } from './score-musicxml-read.ts'
import { type MelodyExtremes, melodyExtremes } from './score-transpose.ts'
import type { NoteRange } from './voice-range.ts'

export interface SongMelody {
  /** The range to use: the chart's own if it has one, else the melody's */
  range: NoteRange
  /** The key the range is written in */
  rangeKey: string
  /** The melody's own highest and lowest notes and the beats on them; null when the song has no melody */
  extremes: MelodyExtremes | null
}

/** By the score's hash: the parse is 2 to 4 ms, and a list of songs asks for many */
const parsed = new Map<string, Score | null>()
const extremes = new Map<string, MelodyExtremes | null>()

/** The melody a record's score gives (null if it will not read), parsed once for a score */
export function melodyOfRecord(record: ScoreRecord): Score | null {
  const hit = parsed.get(record.contentHash)
  if (hit !== undefined) return hit
  const melody = readMusicXml(record.xml)
  parsed.set(record.contentHash, melody)
  return melody
}

/** The lowest and highest note of a melody record, and the beats on each (null if it will not read or has no sung note) */
export function extremesOf(record: ScoreRecord): MelodyExtremes | null {
  const hit = extremes.get(record.contentHash)
  if (hit !== undefined) return hit
  const melody = melodyOfRecord(record)
  const found = melody ? melodyExtremes(melody) : null
  extremes.set(record.contentHash, found)
  return found
}

/**
 * The range and the extremes of a song, given its chart's metadata and its melody record if it has
 * one. Null when neither gives a range.
 */
export function songMelody(
  metadata: ChartMetadata | undefined,
  record: ScoreRecord | undefined
): SongMelody | null {
  const chartKey = metadata?.key ?? ''
  const found = record ? extremesOf(record) : null
  const typed = rangeOfMetadata(metadata)
  if (typed) return { range: typed, rangeKey: chartKey, extremes: found }
  if (!found) return null
  const { low, high } = found
  return { range: { low, high }, rangeKey: record?.key || chartKey, extremes: found }
}

/** Quarter notes as people say them: "3", "2½", "¼" (to the nearest quarter), "0" for none */
export function formatBeats(beats: number): string {
  const quarters = Math.round(beats * 4)
  const whole = Math.floor(quarters / 4)
  const part = ['', '¼', '½', '¾'][quarters % 4]
  return whole === 0 && part ? part : `${whole}${part}`
}
