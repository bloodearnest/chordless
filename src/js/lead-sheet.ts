/**
 * A SongSelect lead sheet, as an import reads it (docs/RANGE.md, docs/MELODY.md): the melody is
 * read from the PDF once (`score-pdfjs.ts`), and its range, and how it was found, come from that.
 */
import { rangeOfChart, withRange } from './chart-range.ts'
import type { ChordlessDB } from './db.ts'
import { keyOfChart } from './library-repair.ts'
import { signatureMatchesKey } from './pitch.ts'
import type { Score } from './score.ts'
import { writeMusicXml } from './score-musicxml.ts'
import { scoreRecord } from './score-record.ts'
import { melodyRange, sungNotes } from './score-transpose.ts'
import type { NoteRange } from './voice-range.ts'

/** A lead sheet is about 130 KB: anything much bigger is not one */
const MAX_LEAD_SHEET = 8 * 1024 * 1024

/**
 * What came of a lead sheet: its melody's range was put in the chart, it had no melody, it could
 * not be read, or it was in another key than the chart (so its notes would not be the chart's)
 */
export type LeadSheetOutcome = 'read' | 'no-melody' | 'unreadable' | 'other-key'

/** A melody to keep with a song, and the key it is written in (the chart's) */
export interface KeptMelody {
  melody: Score
  key: string
}

/** A chart after its lead sheet is read: with the range in it, what came of it, how it was read, and the melody to keep */
export interface LeadSheetRead {
  chordproText: string
  outcome?: LeadSheetOutcome
  melody?: MelodyRead
  notes?: KeptMelody
}

/** What was read from a sheet: the range, and enough of how to check it against the page */
export interface MelodyRead extends NoteRange {
  /** The key signature the sheet opens with: sharps (positive) or flats (negative) */
  keySignature: number
  /** Sung notes read; the small instrumental ones left out, and those full size with no lyric */
  notes: number
  instrumental: number
  unsung: number
  /** Bars (measures) read */
  bars: number
  /** The bar numbers the lowest and highest notes are in, as the sheet prints them (the first, if there are several) */
  lowAt: number
  highAt: number
}

/** The range of a melody's sung notes, and how it was read; null if no note is sung */
export function readOfMelody(melody: Score): MelodyRead | null {
  const range = melodyRange(melody)
  if (!range) return null
  const sung = sungNotes(melody)
  let notes = 0
  let instrumental = 0
  let unsung = 0
  let lowAt: number | undefined
  let highAt: number | undefined
  for (const [index, measure] of melody.measures.entries())
    for (const voice of measure.voices)
      for (const e of voice) {
        if (e.kind !== 'note') continue
        if (e.cue) instrumental++
        else if (!sung(index, e)) unsung++
        else {
          notes++
          if (e.midi === range.low) lowAt ??= measure.number
          if (e.midi === range.high) highAt ??= measure.number
        }
      }
  return {
    ...range,
    // (a note was sung, so there is a first measure)
    keySignature: (melody.measures[0] as Score['measures'][number]).fifths,
    notes,
    instrumental,
    unsung,
    bars: melody.measures.length,
    // (the range is of sung notes, so both were met)
    lowAt: lowAt as number,
    highAt: highAt as number,
  }
}

/**
 * The chart with its melody's range in it, from the song's lead sheet (docs/RANGE.md), and the
 * melody to keep with it (docs/MELODY.md). The lead sheet is never kept, and one that cannot be
 * read leaves the chart as it came: the song is imported without a range, and can be given one.
 * A chart with a range of its own keeps it, and a sheet in another key gives neither.
 * `read` reads a PDF (it is large, so loaded only when there is one to read).
 */
export async function chartWithLeadSheet(
  chordproText: string,
  leadSheet: unknown,
  read: (pdf: ArrayBuffer) => Promise<Score | null>
): Promise<LeadSheetRead> {
  const key = keyOfChart(chordproText)
  if (!(leadSheet instanceof ArrayBuffer) || leadSheet.byteLength > MAX_LEAD_SHEET) {
    return { chordproText }
  }
  // (one with no key has nothing to put the notes in)
  if (!key) return { chordproText }
  const ranged = Boolean(rangeOfChart(chordproText))
  let melody: Score | null
  try {
    melody = await read(leadSheet.slice(0))
  } catch (error) {
    console.warn('[Import] Could not read the melody of the lead sheet:', error)
    return ranged ? { chordproText } : { chordproText, outcome: 'unreadable' }
  }
  // (its notes are only the chart's if it is in the chart's key)
  const inKey = melody !== null && signatureMatchesKey(melody.measures[0]?.fifths ?? 0, key)
  const notes = melody && inKey ? { melody, key } : undefined
  if (ranged) return { chordproText, notes }
  const found = melody && readOfMelody(melody)
  if (!found) return { chordproText, outcome: 'no-melody' }
  if (!inKey) return { chordproText, outcome: 'other-key', melody: found }
  return {
    chordproText: withRange(chordproText, found, key),
    outcome: 'read',
    melody: found,
    notes,
  }
}

/** Keep a melody with a song (replacing the one it had), to be synced beside the chart; false if it could not be saved */
export async function keepMelody(
  db: ChordlessDB,
  songUuid: string,
  notes: KeptMelody
): Promise<boolean> {
  try {
    const previous = await db.getScore(songUuid)
    await db.saveScore(scoreRecord(songUuid, writeMusicXml(notes.melody), notes.key, previous))
    return true
  } catch (error) {
    console.warn('[Import] Could not keep the melody:', error)
    return false
  }
}
