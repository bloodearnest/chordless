/**
 * A chart's melody range, as the `{x_chordless_range: D4-E5}` directive in its ChordPro:
 * docs/RANGE.md. ChordPro reserves the `x_` prefix for an application's own directives, so other
 * programs ignore it. The notes are in the chart's own `{key:}`, and are names with an octave
 * (middle C is C4), spelled the way the key spells them.
 */
import type { ChartMetadata } from './data-types.ts'
import { keyOfChart } from './library-repair.ts'
import { alterOf, midiOf, noteName, type Step, semitonesBetween } from './pitch.ts'
import type { NoteRange } from './voice-range.ts'

const NAME = '[A-G][#b♯♭]?\\d'
const RANGE = new RegExp(`^\\s*(${NAME})\\s*[-–]\\s*(${NAME})\\s*$`)
/** The whole line, so it can be replaced or removed with its line ending */
const DIRECTIVE = /^[ \t]*\{[ \t]*x_chordless_range[ \t]*:([^}]*)\}[ \t]*(\r?\n)?/im

/** MIDI number of a note name like 'D4', 'F#5' or 'Bb3' (one that matched NAME) */
function parseNote(name: string): number {
  const [, letter, accidental, octave] = /^([A-G])([#b♯♭]?)(\d)$/.exec(name) as RegExpExecArray
  return midiOf(letter as Step, alterOf(accidental), Number(octave))
}

/** The notes a range's pickers offer: A2 to C6 (a singer's span), and wider if the range is */
export const LOWEST_OFFERED = 45
export const HIGHEST_OFFERED = 84

/**
 * How wide a range is, in the scale tones it covers (D4 to E5 is nine: a 9th, counting the notes
 * of the scale in between) and in semitones (fourteen). The notes are counted by their names in
 * the key, so a flat or a sharp does not change them. A leader asks how many notes a song asks of
 * a singer, and that does not change with the key; the semitones are there for being exact.
 */
export function rangeSpan(range: NoteRange, key: string): { notes: number; semitones: number } {
  const place = (midi: number) => {
    const [, letter, octave] = /^([A-G])[#b]?(\d)$/.exec(noteName(midi, key)) as RegExpExecArray
    return Number(octave) * 7 + 'CDEFGAB'.indexOf(letter)
  }
  return { notes: place(range.high) - place(range.low) + 1, semitones: range.high - range.low }
}

/** The range as the directive says it, 'D4-E5', in a key */
export function formatRange(range: NoteRange, key: string): string {
  return `${noteName(range.low, key)}-${noteName(range.high, key)}`
}

/** The range a chart says (in the chart's own key), or null if it says none or it is not one */
export function rangeOfChart(chordpro: string): NoteRange | null {
  return parseRange(DIRECTIVE.exec(chordpro)?.[1] ?? '')
}

/** The chart without a range: its directive line is taken out, with its line ending */
export function withoutRange(chordpro: string): string {
  return chordpro.replace(DIRECTIVE, '')
}

/** The range a directive's value says ('D4-E5'), or null if it is not one */
export function parseRange(value: string): NoteRange | null {
  const notes = RANGE.exec(value)
  if (!notes) return null
  const low = parseNote(notes[1])
  const high = parseNote(notes[2])
  return low <= high ? { low, high } : null
}

/** The range in a parsed chart's metadata, where its directives are (in the chart's own key) */
export function rangeOfMetadata(metadata: ChartMetadata | undefined): NoteRange | null {
  return parseRange(String(metadata?.x_chordless_range ?? ''))
}

/**
 * The chart with this range in it: `range` is in `rangeKey`, and is written in the chart's own
 * `{key:}`. A chart with no `{key:}` is given `rangeKey`. A range already in the chart is
 * replaced where it stands; otherwise the line goes after the key's.
 */
export function withRange(chordpro: string, range: NoteRange, rangeKey: string): string {
  const chartKey = keyOfChart(chordpro)
  const key = chartKey ?? rangeKey
  const shift = chartKey && chartKey !== rangeKey ? semitonesBetween(rangeKey, chartKey) : 0
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
