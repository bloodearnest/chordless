/**
 * A melody written as MusicXML 4.0 (partwise): the interchange format every notation program and
 * web renderer reads (`docs/MELODY.md`, "The format"). Chord symbols are `<harmony>`, written from
 * our own text so the app's spelling stays the app's; sections are rehearsal marks.
 */
import type {
  Melody,
  MelodyChord,
  MelodyDirection,
  MelodyEvent,
  MelodyMeasure,
  MelodyNote,
} from './melody.ts'
import { keyAlters } from './pitch.ts'

const DIVISIONS = 24 // per quarter: whole divisions for 16ths, 32nds, and triplets of them

/** For text and for attribute values: quotes are escaped too, since a chord's text goes in an attribute */
const esc = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')

const TYPES: [number, string][] = [
  [4, 'whole'],
  [2, 'half'],
  [1, 'quarter'],
  [0.5, 'eighth'],
  [0.25, '16th'],
  [0.125, '32nd'],
  [0.0625, '64th'],
]

/** Note type and dot count for a length in quarters: 0.75 is an eighth with one dot */
function typeOf(q: number): { type: string; dots: number } {
  for (const [base, name] of TYPES)
    for (let dots = 0; dots <= 2; dots++)
      if (Math.abs(base * (2 - 1 / 2 ** dots) - q) < 1e-6) return { type: name, dots }
  return { type: 'quarter', dots: 0 }
}

/** "Bb/D" as root, kind text and bass: the app's text is kept as the kind's `text` so nothing is lost on a round trip */
function harmony(text: string): string {
  const m = /^([A-G])([b#]?)(.*?)(?:\/([A-G])([b#]?))?$/.exec(text)
  if (!m)
    return `<harmony><root><root-step>C</root-step></root><kind text="${esc(text)}">other</kind></harmony>`
  const alter = (a: string | undefined) => (a === 'b' ? -1 : a === '#' ? 1 : 0)
  const root = `<root><root-step>${m[1]}</root-step>${alter(m[2]) ? `<root-alter>${alter(m[2])}</root-alter>` : ''}</root>`
  const bass = m[4]
    ? `<bass><bass-step>${m[4]}</bass-step>${alter(m[5]) ? `<bass-alter>${alter(m[5])}</bass-alter>` : ''}</bass>`
    : ''
  const kind = /^m(?!aj)/.test(m[3] ?? '')
    ? 'minor'
    : /sus/.test(m[3] ?? '')
      ? 'suspended-fourth'
      : 'major'
  return `<harmony>${root}<kind text="${esc(m[3] ?? '')}">${kind}</kind>${bass}</harmony>`
}

/** `<time-modification>` for a tuplet: 2/3 is three in the time of two */
function timeModification(ratio: number): string {
  if (ratio === 1) return ''
  for (let normal = 1; normal <= 16; normal++) {
    const actual = normal / ratio
    if (Math.abs(actual - Math.round(actual)) < 1e-6)
      return `<time-modification><actual-notes>${Math.round(actual)}</actual-notes><normal-notes>${normal}</normal-notes></time-modification>`
  }
  return ''
}

const ACCIDENTAL_NAMES: Record<number, string> = {
  '-2': 'flat-flat',
  '-1': 'flat',
  0: 'natural',
  1: 'sharp',
  2: 'double-sharp',
}

/**
 * The accidentals a measure prints, by the usual rule: a note is marked when its alteration is not the
 * one in force, which is the key signature's at the start of the measure and then the last one given
 * to that note name in that octave. A note tied from the last measure keeps its alteration unmarked.
 * Verovio, like other engravers, prints an accidental only when the MusicXML names one: `<alter>`
 * is how it sounds.
 */
class Accidentals {
  private readonly key: Record<string, number>
  private readonly carried: Map<string, number>
  private readonly inForce = new Map<string, number>()
  constructor(fifths: number, carried: Map<string, number>) {
    this.key = keyAlters(fifths)
    this.carried = carried
  }

  /** The `<accidental>` element for a note, or '' where none is printed */
  of(n: MelodyNote): string {
    const at = `${n.step}${n.octave}`
    const carried = n.tieStop ? this.carried.get(at) : undefined
    const current = this.inForce.get(at) ?? carried ?? this.key[n.step] ?? 0
    this.inForce.set(at, n.alter)
    if (n.alter === current) return ''
    return `<accidental>${ACCIDENTAL_NAMES[n.alter] ?? ''}</accidental>`
  }

  /** The alterations of the notes tied on out of this measure, for the next to carry */
  carryOn(n: MelodyNote, into: Map<string, number>): void {
    if (n.tieStart) into.set(`${n.step}${n.octave}`, n.alter)
  }
}

/** `<notations>` for a note or rest: its ties, and the tuplet bracket it opens or closes */
function notations(ties: string, e: { tuplet?: 'start' | 'stop' }): string {
  const bracket = e.tuplet ? `<tuplet type="${e.tuplet}" bracket="yes"/>` : ''
  return ties || bracket ? `<notations>${ties}${bracket}</notations>` : ''
}

function noteXml(
  n: MelodyNote,
  voice: number,
  prev: MelodyNote | undefined,
  accidental = ''
): string {
  const { type, dots } = typeOf(n.duration / n.tupletRatio)
  const lyrics = n.syllables
    .map((raw, i) => {
      if (!raw || /^\d+\.$/.test(raw)) return ''
      const joinsNext = raw.endsWith('-')
      const text = raw.replace(/[-_]$/, '')
      const joinsPrev = !!prev?.syllables[i]?.endsWith('-')
      const syllabic = joinsPrev ? (joinsNext ? 'middle' : 'end') : joinsNext ? 'begin' : 'single'
      return `<lyric number="${i + 1}"><syllabic>${syllabic}</syllabic><text>${esc(text)}</text>${raw.endsWith('_') ? '<extend/>' : ''}</lyric>`
    })
    .join('')
  return (
    `<note>${n.cue ? '<cue/>' : ''}${n.withPrevious ? '<chord/>' : ''}` +
    `<pitch><step>${n.step}</step>${n.alter ? `<alter>${n.alter}</alter>` : ''}<octave>${n.octave}</octave></pitch>` +
    `<duration>${Math.round(n.duration * DIVISIONS)}</duration>` +
    `${n.tieStop ? '<tie type="stop"/>' : ''}${n.tieStart ? '<tie type="start"/>' : ''}` +
    `<voice>${voice}</voice><type>${type}</type>${'<dot/>'.repeat(dots)}${accidental}${timeModification(n.tupletRatio)}` +
    notations(
      `${n.tieStop ? '<tied type="stop"/>' : ''}${n.tieStart ? '<tied type="start"/>' : ''}`,
      n
    ) +
    `${n.cue ? '' : lyrics}</note>`
  )
}

function restXml(e: Extract<MelodyEvent, { kind: 'rest' }>, voice: number): string {
  const { type, dots } = typeOf(e.duration / e.tupletRatio)
  return (
    `<note>${e.cue ? '<cue/>' : ''}<rest${e.wholeMeasure ? ' measure="yes"' : ''}/>` +
    `<duration>${Math.round(e.duration * DIVISIONS)}</duration><voice>${voice}</voice>` +
    `${e.wholeMeasure ? '' : `<type>${type}</type>${'<dot/>'.repeat(dots)}${timeModification(e.tupletRatio)}`}` +
    `${notations('', e)}</note>`
  )
}

/** A sign or instruction over a measure: the sign or the words, and what the player does about it as `<sound>` */
function directionXml(d: MelodyDirection): string {
  const words = `<words>${esc(d.text)}</words>`
  const sound =
    d.kind === 'segno'
      ? '<sound segno="segno"/>'
      : d.kind === 'coda'
        ? '<sound coda="coda"/>'
        : d.kind === 'to-coda'
          ? '<sound tocoda="coda"/>'
          : d.kind === 'fine'
            ? '<sound fine="yes"/>'
            : d.kind === 'da-segno'
              ? '<sound dalsegno="segno"/>'
              : d.kind === 'da-capo'
                ? '<sound dacapo="yes"/>'
                : ''
  const type = d.kind === 'segno' ? '<segno/>' : d.kind === 'coda' ? '<coda/>' : words
  return `<direction placement="above"><direction-type>${type}</direction-type>${sound}</direction>`
}

/** The barline at the start of a measure: a repeat sign and the start of a numbered ending, when there are any */
function leftBarline(m: MelodyMeasure): string {
  const ending = m.ending?.start
    ? `<ending number="${esc(m.ending.label.replace(/,/g, ', '))}" type="start">${esc(m.ending.label)}.</ending>`
    : ''
  if (!m.repeatStart && !ending) return ''
  return `<barline location="left">${m.repeatStart ? '<bar-style>heavy-light</bar-style>' : ''}${ending}${m.repeatStart ? '<repeat direction="forward"/>' : ''}</barline>`
}

/** The barline at the end of a measure; a plain one is the default and is not written */
function rightBarline(m: MelodyMeasure): string {
  const style =
    m.barline === 'double'
      ? 'light-light'
      : m.barline === 'final' || m.barline === 'repeat-end'
        ? 'light-heavy'
        : m.barline === 'dashed'
          ? 'dashed'
          : ''
  // (an ending that ends here is closed by a hook; the last, open one is "discontinue")
  const ending = m.ending?.stop
    ? `<ending number="${esc(m.ending.label.replace(/,/g, ', '))}" type="${m.ending.closed ? 'stop' : 'discontinue'}"/>`
    : ''
  const repeat = m.barline === 'repeat-end' ? '<repeat direction="backward"/>' : ''
  if (!style && !ending && !repeat) return ''
  return `<barline location="right">${style ? `<bar-style>${style}</bar-style>` : ''}${ending}${repeat}</barline>`
}

/**
 * A voice as lines that do not overlap. A MusicXML voice is one line of notes in time; a sheet's voice
 * can hold two that run together (a cue line over another), which are written as voices of their own. A
 * note that sounds with the one before it (a chord) stays with it.
 */
function lanesOf(voice: MelodyEvent[]): MelodyEvent[][] {
  const lanes: { events: MelodyEvent[]; end: number }[] = []
  let current: { events: MelodyEvent[]; end: number } | undefined
  for (const e of voice) {
    const at = Math.round(e.start * DIVISIONS)
    const chord = e.kind === 'note' && e.withPrevious
    if (!chord || !current) {
      current = lanes.find(l => l.end <= at)
      if (!current) {
        current = { events: [], end: 0 }
        lanes.push(current)
      }
    }
    current.events.push(e)
    if (!chord) current.end = at + Math.round(e.duration * DIVISIONS)
  }
  return lanes.map(l => l.events)
}

export function writeMusicXml(melody: Melody): string {
  const out: string[] = []
  out.push('<?xml version="1.0" encoding="UTF-8"?>')
  out.push(
    '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">'
  )
  out.push('<score-partwise version="4.0">')
  out.push(`<work><work-title>${esc(melody.title ?? '')}</work-title></work>`)
  out.push(
    `<identification>${melody.notice.map(n => `<rights>${esc(n)}</rights>`).join('')}</identification>`
  )
  out.push(
    '<part-list><score-part id="P1"><part-name print-object="no">Melody</part-name></score-part></part-list>'
  )
  out.push('<part id="P1">')
  let last: { fifths: number; beats: number; beatType: number } | null = null
  // alterations of notes tied across the barline
  let carried = new Map<string, number>()
  melody.measures.forEach((m, mi) => {
    out.push(`<measure number="${m.number}"${!m.full && mi === 0 ? ' implicit="yes"' : ''}>`)
    if (
      !last ||
      last.fifths !== m.fifths ||
      last.beats !== m.beats ||
      last.beatType !== m.beatType
    ) {
      out.push(
        `<attributes>${mi === 0 ? `<divisions>${DIVISIONS}</divisions>` : ''}<key><fifths>${m.fifths}</fifths></key>` +
          `<time><beats>${m.beats}</beats><beat-type>${m.beatType}</beat-type></time>` +
          `${mi === 0 ? '<clef><sign>G</sign><line>2</line></clef>' : ''}</attributes>`
      )
      last = m
    }
    const left = leftBarline(m)
    if (left) out.push(left)
    if (m.section)
      out.push(
        `<direction placement="above"><direction-type><rehearsal>${esc(m.section)}</rehearsal></direction-type></direction>`
      )
    if (m.tempo)
      out.push(
        `<direction placement="above"><direction-type><words/></direction-type><sound tempo="${m.tempo}"/></direction>`
      )
    for (const d of m.directions) out.push(directionXml(d))
    // Chord symbols come first in their measure's first voice, placed by <forward>/<backup> to their beat
    const chords = [...m.chords].sort((a, b) => a.start - b.start)
    // Where the voice is in the measure, in divisions: a line drawn with no spacer rests (a cue line
    // that comes in late) is moved to where its notes start, with <forward>, and the next voice goes
    // back to the start with <backup> by as far as the last one went
    let cursor = 0
    const accidentals = new Accidentals(m.fifths, carried)
    const tiedOn = new Map<string, number>()
    m.voices.flatMap(lanesOf).forEach((v, vi) => {
      if (vi > 0) {
        out.push(`<backup><duration>${cursor}</duration></backup>`)
        cursor = 0
      }
      let prev: MelodyNote | undefined
      for (const e of v) {
        const at = Math.round(e.start * DIVISIONS)
        const sounds = e.kind === 'rest' || !e.withPrevious
        // A chord symbol goes at its own place: a late voice has a gap before it, and a chord that falls in
        // the gap is written there (a <forward> to it, then the symbol), not after the gap
        while (vi === 0 && chords[0] && chords[0].start <= e.start + 1e-6) {
          const symbol = chords.shift() as MelodyChord
          const place = Math.round(symbol.start * DIVISIONS)
          if (sounds && place > cursor && place <= at) {
            out.push(`<forward><duration>${place - cursor}</duration></forward>`)
            cursor = place
          } else if (place < cursor) {
            // (a chord that falls inside a held note: back to it, and on again after)
            out.push(
              `<backup><duration>${cursor - place}</duration></backup>`,
              harmony(symbol.text),
              `<forward><duration>${cursor - place}</duration></forward>`
            )
            continue
          }
          out.push(harmony(symbol.text))
        }
        if (sounds && at > cursor) {
          out.push(`<forward><duration>${at - cursor}</duration></forward>`)
          cursor = at
        }
        if (e.kind === 'rest') {
          out.push(restXml(e, vi + 1))
          prev = undefined
        } else {
          out.push(noteXml(e, vi + 1, prev, accidentals.of(e)))
          accidentals.carryOn(e, tiedOn)
          prev = e
        }
        if (sounds) cursor += Math.round(e.duration * DIVISIONS)
      }
      // chords after the last note of the line: out to each one and back to where the line ended
      if (vi === 0)
        for (const c of chords) {
          const delta = Math.round(c.start * DIVISIONS) - cursor
          const [there, back] = delta > 0 ? ['forward', 'backup'] : ['backup', 'forward']
          if (delta === 0) out.push(harmony(c.text))
          else
            out.push(
              `<${there}><duration>${Math.abs(delta)}</duration></${there}>`,
              harmony(c.text),
              `<${back}><duration>${Math.abs(delta)}</duration></${back}>`
            )
        }
    })
    carried = tiedOn
    const right = rightBarline(m)
    if (right) out.push(right)
    out.push('</measure>')
  })
  out.push('</part>')
  out.push('</score-partwise>')
  return out.join('\n')
}
