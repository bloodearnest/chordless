/**
 * A melody written as MusicXML 4.0 (partwise): the interchange format every notation program and
 * web renderer reads (`docs/MELODY.md`, "The format"). Chord symbols are `<harmony>`, written from
 * our own text so the app's spelling stays the app's; sections are rehearsal marks.
 */
import type { Melody, MelodyEvent, MelodyNote } from './melody.ts'

const DIVISIONS = 24 // per quarter: whole divisions for 16ths, 32nds, and triplets of them

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

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
    for (let dots = 0; dots <= 2; dots++) if (Math.abs(base * (2 - 1 / 2 ** dots) - q) < 1e-6) return { type: name, dots }
  return { type: 'quarter', dots: 0 }
}

/** "Bb/D" as root, kind text and bass: the app's text is kept as the kind's `text` so nothing is lost on a round trip */
function harmony(text: string): string {
  const m = /^([A-G])([b#]?)(.*?)(?:\/([A-G])([b#]?))?$/.exec(text)
  if (!m) return `<harmony><root><root-step>C</root-step></root><kind text="${esc(text)}">other</kind></harmony>`
  const alter = (a: string | undefined) => (a === 'b' ? -1 : a === '#' ? 1 : 0)
  const root = `<root><root-step>${m[1]}</root-step>${alter(m[2]) ? `<root-alter>${alter(m[2])}</root-alter>` : ''}</root>`
  const bass = m[4] ? `<bass><bass-step>${m[4]}</bass-step>${alter(m[5]) ? `<bass-alter>${alter(m[5])}</bass-alter>` : ''}</bass>` : ''
  const kind = /^m(?!aj)/.test(m[3] ?? '') ? 'minor' : /sus/.test(m[3] ?? '') ? 'suspended-fourth' : 'major'
  return `<harmony>${root}<kind text="${esc(m[3] ?? '')}">${kind}</kind>${bass}</harmony>`
}

function noteXml(n: MelodyNote, voice: number, prev: MelodyNote | undefined): string {
  const { type, dots } = typeOf(n.duration)
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
    `<voice>${voice}</voice><type>${type}</type>${'<dot/>'.repeat(dots)}` +
    `${n.tieStop || n.tieStart ? `<notations>${n.tieStop ? '<tied type="stop"/>' : ''}${n.tieStart ? '<tied type="start"/>' : ''}</notations>` : ''}` +
    `${n.cue ? '' : lyrics}</note>`
  )
}

function restXml(e: Extract<MelodyEvent, { kind: 'rest' }>, voice: number): string {
  const { type, dots } = typeOf(e.duration)
  return (
    `<note>${e.cue ? '<cue/>' : ''}<rest${e.wholeMeasure ? ' measure="yes"' : ''}/>` +
    `<duration>${Math.round(e.duration * DIVISIONS)}</duration><voice>${voice}</voice>` +
    `${e.wholeMeasure ? '' : `<type>${type}</type>${'<dot/>'.repeat(dots)}`}</note>`
  )
}

export function writeMusicXml(melody: Melody): string {
  const out: string[] = []
  out.push('<?xml version="1.0" encoding="UTF-8"?>')
  out.push('<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">')
  out.push('<score-partwise version="4.0">')
  out.push(`<work><work-title>${esc(melody.title ?? '')}</work-title></work>`)
  out.push(`<identification>${melody.notice.map((n) => `<rights>${esc(n)}</rights>`).join('')}</identification>`)
  out.push('<part-list><score-part id="P1"><part-name>Melody</part-name></score-part></part-list>')
  out.push('<part id="P1">')
  let last: { fifths: number; beats: number; beatType: number } | null = null
  melody.measures.forEach((m, mi) => {
    out.push(`<measure number="${m.number}"${!m.full && mi === 0 ? ' implicit="yes"' : ''}>`)
    if (!last || last.fifths !== m.fifths || last.beats !== m.beats || last.beatType !== m.beatType) {
      out.push(
        `<attributes>${mi === 0 ? `<divisions>${DIVISIONS}</divisions>` : ''}<key><fifths>${m.fifths}</fifths></key>` +
          `<time><beats>${m.beats}</beats><beat-type>${m.beatType}</beat-type></time>` +
          `${mi === 0 ? '<clef><sign>G</sign><line>2</line></clef>' : ''}</attributes>`,
      )
      last = m
    }
    if (m.section) out.push(`<direction placement="above"><direction-type><rehearsal>${esc(m.section)}</rehearsal></direction-type></direction>`)
    if (m.tempo) out.push(`<direction placement="above"><direction-type><words/></direction-type><sound tempo="${m.tempo}"/></direction>`)
    // Chord symbols come first in their measure's first voice, placed by <forward>/<backup> to their beat
    const chords = [...m.chords].sort((a, b) => a.start - b.start)
    m.voices.forEach((v, vi) => {
      if (vi > 0) out.push(`<backup><duration>${Math.round(m.length * DIVISIONS)}</duration></backup>`)
      let prev: MelodyNote | undefined
      for (const e of v) {
        while (vi === 0 && chords[0] && chords[0].start <= e.start + 1e-6) out.push(harmony((chords.shift() as { text: string }).text))
        if (e.kind === 'rest') {
          out.push(restXml(e, vi + 1))
          prev = undefined
        } else {
          out.push(noteXml(e, vi + 1, prev))
          prev = e
        }
      }
      if (vi === 0) for (const c of chords) out.push(harmony(c.text))
    })
    out.push('</measure>')
  })
  out.push('</part>')
  out.push('</score-partwise>')
  return out.join('\n')
}
