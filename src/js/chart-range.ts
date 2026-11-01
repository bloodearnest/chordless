/**
 * A chart's melody range, as the `{x_chordless_range: D4-E5}` directive in its ChordPro:
 * docs/RANGE.md. ChordPro reserves the `x_` prefix for an application's own directives, so other
 * programs ignore it. The notes are in the chart's own `{key:}`, and are names with an octave
 * (middle C is C4), spelled the way the key spells them.
 */
import { keyOfChart } from './library-repair.ts'
import { getKeyOffset, transposeNote } from './transpose.ts'
import type { NoteRange } from './voice-range.ts'

const NAME = '[A-G][#b♯♭]?\\d'
const RANGE = new RegExp(`^\\s*(${NAME})\\s*[-–]\\s*(${NAME})\\s*$`)
/** The whole line, so it can be replaced or removed with its line ending */
const DIRECTIVE = /^[ \t]*\{[ \t]*x_chordless_range[ \t]*:([^}]*)\}[ \t]*(\r?\n)?/im

const SEMITONES: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

/** MIDI number of a note name like 'D4', 'F#5' or 'Bb3' (null if it is not one) */
function parseNote(name: string): number | null {
  const [, letter, accidental, octave] = /^([A-G])([#b♯♭]?)(\d)$/.exec(name) ?? []
  if (!letter) return null
  const shift = accidental === '#' || accidental === '♯' ? 1 : accidental ? -1 : 0
  return 12 * (Number(octave) + 1) + SEMITONES[letter] + shift
}

/** A key written with flats (F and the flat keys, and D, G and C minor), so its notes are too */
const FLAT_KEY = /^(?:[A-G]b|F)m?$|^(?:Dm|Gm|Cm)$/

/** A note's name in a key, with its octave: 'F#5' in G, 'Eb5' in Bb */
function noteName(midi: number, key: string | null): string {
  const pitchClass = ((midi % 12) + 12) % 12
  const name = transposeNote('C', pitchClass, Boolean(key && FLAT_KEY.test(key)), key) ?? 'C'
  // B is Cb in a very flat key, and that is an octave up in the number
  return `${name}${Math.floor(midi / 12) - 1 + (name === 'Cb' ? 1 : 0)}`
}

/** The range as the directive says it, 'D4-E5', in a key */
export function formatRange(range: NoteRange, key: string | null): string {
  return `${noteName(range.low, key)}-${noteName(range.high, key)}`
}

/** The range a chart says (in the chart's own key), or null if it says none or it is not one */
export function rangeOfChart(chordpro: string): NoteRange | null {
  const match = DIRECTIVE.exec(chordpro)
  const notes = RANGE.exec(match?.[1] ?? '')
  if (!notes) return null
  const low = parseNote(notes[1])
  const high = parseNote(notes[2])
  return low !== null && high !== null && low <= high ? { low, high } : null
}

/**
 * The semitones from one key to another by the nearest way round, as the key picker lists them:
 * G to A is up two, and B to C up one, not down eleven. A melody moved the long way would be an
 * octave out.
 */
function nearestOffset(from: string, to: string): number {
  return ((((getKeyOffset(from, to) + 6) % 12) + 12) % 12) - 6
}

/**
 * The chart with this range in it: `range` is in `rangeKey`, and is written in the chart's own
 * `{key:}`. A chart with no `{key:}` is given `rangeKey`. A range already in the chart is
 * replaced where it stands; otherwise the line goes after the key's.
 */
export function withRange(chordpro: string, range: NoteRange, rangeKey: string): string {
  const chartKey = keyOfChart(chordpro)
  const key = chartKey ?? rangeKey
  const shift = chartKey && chartKey !== rangeKey ? nearestOffset(rangeKey, chartKey) : 0
  const written = formatRange({ low: range.low + shift, high: range.high + shift }, key)

  const eol = chordpro.includes('\r\n') ? '\r\n' : '\n'
  const line = `{x_chordless_range: ${written}}`
  if (DIRECTIVE.test(chordpro)) {
    return chordpro.replace(DIRECTIVE, (_all, _notes, ending) => `${line}${ending ?? ''}`)
  }

  const lines = chordpro.split(/\r?\n/)
  const at = lines.findIndex(text => /^\s*\{\s*key\s*:/i.test(text))
  if (at !== -1) {
    lines.splice(at + 1, 0, line)
  } else {
    // after the directives the chart opens with (its title, artist, ...)
    let end = 0
    while (end < lines.length && /^\s*\{[^}]*\}\s*$/.test(lines[end])) end++
    lines.splice(end, 0, `{key: ${rangeKey}}`, line)
  }
  return lines.join(eol)
}
