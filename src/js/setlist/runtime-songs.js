/**
 * A setlist as it is shown: each of its songs parsed, in the key and tempo the
 * setlist has for it. (The setlist stores only the song's id and what differs:
 * its key, tempo and any edits to the chart.)
 */
import { getSongById } from '../song-utils.js'
import { transposeSong } from '../transpose.ts'

/**
 * A tempo as written in a chart or stored: 120, "120", "120 (1/8)".
 * @returns {{bpm: number | null, tempoNote: string | null}}
 */
export function parseTempoMetadata(raw) {
  if (raw === undefined || raw === null || raw === '') {
    return { bpm: null, tempoNote: null }
  }
  if (typeof raw === 'number') {
    return { bpm: raw, tempoNote: null }
  }
  const str = `${raw}`.trim()
  let tempoNote = null
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
 * @param {object} setlist
 * @param {object} options
 * @param {object} options.db the organisation's database
 * @param {{parse: (text: string) => object}} options.parser a ChordProParser
 * @param {number} options.fontSize the font size, in rem, each song starts at
 * @returns {Promise<object[]>} the songs, as the page works with them
 */
export async function buildRuntimeSongs(setlist, { db, parser, fontSize }) {
  const songs = []

  for (const songEntry of setlist.songs) {
    // Get source text (local edits or from Songs collection)
    let sourceText
    let canonicalSong = null
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

    // Get target key from setlist (explicit snapshot)
    // Fallback to canonical song's key for backwards compatibility with old setlists
    let targetKey = songEntry.key
    if (targetKey === null || targetKey === undefined) {
      targetKey = canonicalSong?.key || null
    }

    // Apply transposition if requested and we have a reference key
    if (targetKey && originalKey && targetKey !== originalKey) {
      transposeSong(parsed, originalKey, targetKey)
      parsed.metadata.key = targetKey
    } else if (targetKey && !originalKey) {
      // Still reflect the requested key in metadata even if we can't transpose
      parsed.metadata.key = targetKey
    }

    // Get target tempo from setlist (explicit snapshot)
    // Fallback to canonical song's tempo for backwards compatibility with old setlists
    let targetTempo = songEntry.tempo
    if (targetTempo === null || targetTempo === undefined) {
      targetTempo = canonicalSong?.tempo || null
    }

    // Apply tempo override
    if (targetTempo) {
      parsed.metadata.tempo = targetTempo
    }

    // Use tempo and time signature from database if available (already parsed), otherwise use ChordPro
    const parsedTempoInfo = parseTempoMetadata(parsed.metadata.tempo)
    let currentBPM = parsedTempoInfo.bpm
    let timeSignature = parsed.metadata.time // ChordPro uses 'time'
    let tempoNote = parsedTempoInfo.tempoNote || null
    if (canonicalSong?.metadata) {
      const canonicalTempoInfo = parseTempoMetadata(canonicalSong.metadata.tempo)
      // The setlist's own tempo, if it has one, wins over the library song's
      if (canonicalTempoInfo.bpm !== null && !songEntry.tempo) {
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
    // Override with explicit tempoNote if available from database
    if (canonicalSong?.metadata?.tempoNote) {
      tempoNote = canonicalSong.metadata.tempoNote
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
