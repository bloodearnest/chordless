/**
 * A setlist as it is shown: each of its songs parsed, in the key and tempo the
 * setlist has for it. (The setlist stores only the song's id and what differs:
 * its key, tempo and any edits to the chart.)
 */

import type {
  ParsedChart,
  Setlist,
  SetlistEntry,
  SongWithContent,
  TempoInput,
} from '../data-types.ts'
import type { ChordlessDB } from '../db.ts'
import { getSongById } from '../song-utils.ts'
import { transposeSong } from '../transpose.ts'

/**
 * A song of a setlist as the page works with it (see buildRuntimeSongs).
 */
export interface RuntimeSong {
  title: string
  parsed: ParsedChart
  /** Its position in the setlist */
  songIndex: number
  metadata: {
    title?: string
    key?: string
    time?: string
    tempo: number | null
    tempoNote: string
    timeSignature: string | null | undefined
    [directive: string]: string | number | null | undefined
  }
  /** The key the chart is written in; never changes */
  originalKey: string | null
  currentKey: string | undefined
  currentBPM: number | null
  currentFontSize: number
  currentCapo: number
  songId: string
  sourceText: string
  hasLocalEdits: boolean
  /** Kept to make the song's model */
  _setlistEntry: SetlistEntry
  _canonicalSong: SongWithContent | null
}

/**
 * A tempo as written in a chart or stored: 120, "120", "120 (1/8)".
 */
export function parseTempoMetadata(raw: TempoInput): {
  bpm: number | null
  tempoNote: string | null
} {
  if (raw === undefined || raw === null || raw === '') {
    return { bpm: null, tempoNote: null }
  }
  if (typeof raw === 'number') {
    return { bpm: raw, tempoNote: null }
  }
  const str = `${raw}`.trim()
  let tempoNote: string | null = null
  let bpmPart = str
  const parenMatch = str.match(/\(([^)]+)\)/)
  if (parenMatch) {
    tempoNote = parenMatch[1].trim()
    bpmPart = str.replace(/\([^)]*\)/g, '').trim()
  }
  const bpmMatch = bpmPart.match(/-?\d+(?:\.\d+)?/)
  const bpm = bpmMatch ? Number(bpmMatch[0]) : null
  return {
    bpm: Number.isFinite(bpm) ? bpm : null,
    tempoNote,
  }
}

/**
 * Parse each of a setlist's songs: its own edited chart if it has one, otherwise the
 * library's, transposed to the setlist's key and given the setlist's tempo. A song
 * missing from the library is left out.
 *
 * @param options.db the organisation's database
 * @param options.parser a ChordProParser
 * @param options.fontSize the font size, in rem, each song starts at
 * @returns the songs, as the page works with them
 */
export async function buildRuntimeSongs(
  setlist: Setlist,
  {
    db,
    parser,
    fontSize,
  }: { db: ChordlessDB; parser: { parse: (text: string) => ParsedChart }; fontSize: number }
): Promise<RuntimeSong[]> {
  const songs: RuntimeSong[] = []

  for (const songEntry of setlist.songs) {
    // Get source text (local edits or from Songs collection)
    let sourceText: string
    let canonicalSong: SongWithContent | null = null
    if (songEntry.chordproEdits) {
      sourceText = songEntry.chordproEdits
    } else {
      // Get song with content using deterministic ID
      try {
        canonicalSong = await getSongById(songEntry.songId, db)
        sourceText = canonicalSong.chordpro
      } catch (error) {
        console.error('[ERROR] Song not found in DB:', songEntry.songId, error)
        continue
      }
    }

    // Parse the chordpro
    const parsed = parser.parse(sourceText)

    // Capture original key from ChordPro file (for transposition reference)
    const originalKey = parsed.metadata.key || null

    // Get target key from setlist (explicit snapshot); an old setlist with none uses the
    // library song's key
    const targetKey = songEntry.key ?? canonicalSong?.key ?? null

    // Apply transposition if requested and we have a reference key
    if (targetKey && originalKey && targetKey !== originalKey) {
      transposeSong(parsed, originalKey, targetKey)
      parsed.metadata.key = targetKey
    } else if (targetKey && !originalKey) {
      // Still reflect the requested key in metadata even if we can't transpose
      parsed.metadata.key = targetKey
    }

    // Get target tempo from setlist (explicit snapshot); same fallback as the key
    const targetTempo = songEntry.tempo ?? canonicalSong?.tempo ?? null

    // Apply tempo override
    if (targetTempo) {
      parsed.metadata.tempo = targetTempo
    }

    // Use tempo and time signature from database if available (already parsed), otherwise use ChordPro
    const parsedTempoInfo = parseTempoMetadata(parsed.metadata.tempo)
    let currentBPM = parsedTempoInfo.bpm
    let timeSignature: string | null | undefined = parsed.metadata.time // ChordPro uses 'time'
    let tempoNote = parsedTempoInfo.tempoNote || null
    if (canonicalSong?.metadata) {
      const canonicalTempoInfo = parseTempoMetadata(canonicalSong.metadata.tempo)
      // The setlist's own tempo, if it has one, wins over the library song's
      if (canonicalTempoInfo.bpm !== null && !targetTempo) {
        currentBPM = canonicalTempoInfo.bpm
      }
      timeSignature = canonicalSong.metadata.timeSignature || parsed.metadata.time
      tempoNote = canonicalTempoInfo.tempoNote || tempoNote
    }

    // Derive default tempoNote from time signature denominator if not explicitly set
    if (!tempoNote) {
      tempoNote = '1/4' // Default to quarter notes
    }
    if (timeSignature && (!tempoNote || tempoNote === '1/4')) {
      const [, denominator] = timeSignature.split('/').map(s => s.trim())
      if (denominator) {
        tempoNote = `1/${denominator}`
      }
    }

    // Create song object for runtime
    songs.push({
      title: parsed.metadata.title || `Song ${songEntry.order + 1}`,
      parsed: parsed,
      songIndex: songEntry.order,
      metadata: {
        ...parsed.metadata,
        tempo: currentBPM,
        tempoNote: tempoNote,
        timeSignature: timeSignature,
      },
      originalKey: originalKey, // Immutable original
      currentKey: parsed.metadata.key,
      currentBPM: currentBPM,
      currentFontSize: fontSize,
      currentCapo: 0, // Capo is loaded from localStorage in loadState()
      songId: songEntry.songId,
      sourceText: sourceText,
      hasLocalEdits: Boolean(songEntry.chordproEdits),
      // Store references needed for model creation
      _setlistEntry: songEntry,
      _canonicalSong: canonicalSong,
    })
  }

  return songs
}
