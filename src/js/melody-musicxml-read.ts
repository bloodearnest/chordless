/**
 * Reads MusicXML into a `Melody`: the other half of `melody-musicxml.ts`, which writes it. This is how
 * a melody is kept (a MusicXML file beside the chart, docs/MELODY.md) and how one from another
 * program comes in. It reads partwise scores, the first part, and what a lead sheet has: pitches and
 * lengths, voices (with `<backup>` and `<forward>`), chords, ties, tuplets, lyrics, chord symbols,
 * rehearsal marks, tempo, key and time changes, repeats and endings, and the jump signs.
 *
 * What it does not read: grace notes (they have no length and are skipped), a second staff, and
 * anything that makes the music other than notes and rests. A file with no part is null.
 */

import type {
  Melody,
  MelodyChord,
  MelodyDirection,
  MelodyEnding,
  MelodyEvent,
  MelodyMeasure,
  MelodyNote,
} from './melody.ts'
import { midiOf } from './melody.ts'
import { parseDirection } from './melody-directions.ts'
import type { El } from './melody-read.ts'
import { parseXml } from './xml.ts'

const child = (e: El, name: string) => e.children.find(c => c.name === name)
const kids = (e: El, name: string) => e.children.filter(c => c.name === name)
const textOf = (e: El | undefined) => (e?.text ?? '').trim()
const numberOf = (e: El | undefined, fallback: number) => {
  const n = Number(textOf(e))
  return textOf(e) !== '' && Number.isFinite(n) ? n : fallback
}

const STEPS = ['C', 'D', 'E', 'F', 'G', 'A', 'B']

/** The chord symbol a `<harmony>` writes: the root, what follows it, and the bass */
function chordText(h: El): string {
  const kind = child(h, 'kind')
  // (a symbol that was not a chord of our spelling is written whole, as the text of kind "other")
  if (textOf(kind) === 'other' && kind?.attrs.text) return kind.attrs.text
  const name = (step: El | undefined, alter: El | undefined) => {
    const a = Math.round(numberOf(alter, 0))
    return `${textOf(step)}${a > 0 ? '#'.repeat(a) : 'b'.repeat(-a)}`
  }
  const root = child(h, 'root')
  const bass = child(h, 'bass')
  return (
    name(child(root ?? h, 'root-step'), child(root ?? h, 'root-alter')) +
    (kind?.attrs.text ?? '') +
    (bass ? `/${name(child(bass, 'bass-step'), child(bass, 'bass-alter'))}` : '')
  )
}

/** The text of a note's lyric for a verse: the syllable with its hyphen or extender, as the sheet gives it */
function syllableOf(lyric: El): string {
  const text = kids(lyric, 'text')
    .map(t => t.text)
    .join('')
  const syllabic = textOf(child(lyric, 'syllabic'))
  return `${text}${syllabic === 'begin' || syllabic === 'middle' ? '-' : ''}${child(lyric, 'extend') ? '_' : ''}`
}

/** An ending's label as the sheet prints it: "1", "2,3" (MusicXML writes "2, 3") */
const endingLabel = (number: string | undefined) => (number ?? '').replace(/\s*,\s*/g, ',')

/** What the measure's own barlines say */
interface Edges {
  repeatStart: boolean
  repeatEnd: boolean
  style: string
  endingStart: string | null
  endingStop: 'stop' | 'discontinue' | null
}

function readBarline(b: El, edges: Edges) {
  const location = b.attrs.location ?? 'right'
  const style = textOf(child(b, 'bar-style'))
  const repeat = child(b, 'repeat')?.attrs.direction
  const ending = child(b, 'ending')
  if (location === 'left') {
    if (repeat === 'forward') edges.repeatStart = true
    if (ending?.attrs.type === 'start') edges.endingStart = endingLabel(ending.attrs.number)
  } else {
    edges.style = style
    if (repeat === 'backward') edges.repeatEnd = true
    if (ending?.attrs.type === 'stop' || ending?.attrs.type === 'discontinue')
      edges.endingStop = ending.attrs.type
  }
}

function barlineOf(edges: Edges): MelodyMeasure['barline'] {
  if (edges.repeatEnd) return 'repeat-end'
  if (edges.style === 'light-light') return 'double'
  if (edges.style === 'light-heavy') return 'final'
  if (edges.style === 'dashed') return 'dashed'
  return 'single'
}

/**
 * The title of the score: the work's, else the movement's, else the credit printed as the title (a
 * `credit-type` of title, or failing that the largest words on the page), which is where MuseScore
 * puts it when the score was not given a work title
 */
function titleOf(root: El): string | null {
  const named =
    textOf(child(child(root, 'work') ?? root, 'work-title')) ||
    textOf(child(root, 'movement-title'))
  if (named) return named
  const credits = kids(root, 'credit').flatMap(credit => {
    const words = child(credit, 'credit-words')
    const text = textOf(words)
    if (!words || !text) return []
    const isTitle = kids(credit, 'credit-type').some(type => textOf(type) === 'title')
    return [{ text, isTitle, size: Number(words.attrs['font-size']) || 0 }]
  })
  const best = credits.find(credit => credit.isTitle) ?? credits.sort((a, b) => b.size - a.size)[0]
  return best?.text ?? null
}

/** The melody of a MusicXML document, or null if it is not a partwise score with a part */
export function readMusicXml(xml: string): Melody | null {
  const root = parseXml(xml)
  const part = root?.name === 'score-partwise' ? child(root, 'part') : undefined
  if (!root || !part) return null
  const title = titleOf(root)
  const notice = kids(child(root, 'identification') ?? root, 'rights').map(r => r.text.trim())

  const measures: MelodyMeasure[] = []
  let divisions = 1
  let fifths = 0
  let beats = 4
  let beatType = 4
  let open: { label: string; of: MelodyMeasure[] } | null = null

  part.children
    .filter(m => m.name === 'measure')
    .forEach((m, index) => {
      const voices = new Map<number, MelodyEvent[]>()
      const chords: MelodyChord[] = []
      const directions: MelodyDirection[] = []
      const edges: Edges = {
        repeatStart: false,
        repeatEnd: false,
        style: '',
        endingStart: null,
        endingStop: null,
      }
      let section: string | null = null
      let tempo: number | null = null
      let cursor = 0 // in divisions
      let lastStart = 0
      let events = 0

      for (const e of m.children) {
        if (e.name === 'attributes') {
          divisions = numberOf(child(e, 'divisions'), divisions)
          const key = child(e, 'key')
          if (key) fifths = numberOf(child(key, 'fifths'), fifths)
          const time = child(e, 'time')
          if (time) {
            beats = numberOf(child(time, 'beats'), beats)
            beatType = numberOf(child(time, 'beat-type'), beatType)
          }
        } else if (e.name === 'barline') {
          readBarline(e, edges)
        } else if (e.name === 'forward') {
          cursor += numberOf(child(e, 'duration'), 0)
        } else if (e.name === 'backup') {
          cursor -= numberOf(child(e, 'duration'), 0)
        } else if (e.name === 'harmony') {
          chords.push({ start: cursor / divisions, text: chordText(e) })
        } else if (e.name === 'direction') {
          const sound = child(e, 'sound')
          if (sound?.attrs.tempo) tempo = Number(sound.attrs.tempo)
          for (const t of kids(e, 'direction-type').flatMap(d => d.children)) {
            if (t.name === 'rehearsal') section = textOf(t)
            else if (t.name === 'segno' || t.name === 'coda')
              directions.push({ kind: t.name, al: null, time: null, text: '' })
            else if (t.name === 'words' && textOf(t)) {
              const d = parseDirection(textOf(t))
              if (d) directions.push(d)
            }
          }
        } else if (e.name === 'note' && !child(e, 'grace')) {
          const duration = numberOf(child(e, 'duration'), 0)
          const chord = !!child(e, 'chord')
          const start = chord ? lastStart : cursor
          const voice = numberOf(child(e, 'voice'), 1)
          const modification = child(e, 'time-modification')
          const ratio = modification
            ? numberOf(child(modification, 'normal-notes'), 1) /
              numberOf(child(modification, 'actual-notes'), 1)
            : 1
          const bracket = kids(child(e, 'notations') ?? e, 'tuplet')[0]?.attrs.type
          const tuplet: 'start' | 'stop' | undefined =
            bracket === 'start' || bracket === 'stop' ? bracket : undefined
          const base = {
            id: `m${index + 1}n${events++}`,
            start: start / divisions,
            duration: duration / divisions,
            tupletRatio: ratio,
            cue: !!child(e, 'cue'),
            ...(tuplet ? { tuplet } : {}),
          }
          const pitch = child(e, 'pitch')
          let event: MelodyEvent
          if (pitch) {
            const step = textOf(child(pitch, 'step')) as MelodyNote['step']
            const alter = Math.round(numberOf(child(pitch, 'alter'), 0))
            const octave = numberOf(child(pitch, 'octave'), 4)
            const syllables: string[] = []
            for (const [i, lyric] of kids(e, 'lyric').entries()) {
              const verse = Math.max(1, Math.round(Number(lyric.attrs.number ?? i + 1))) - 1
              while (syllables.length < verse) syllables.push('')
              syllables[verse] = syllableOf(lyric)
            }
            const ties = kids(e, 'tie').map(t => t.attrs.type)
            event = {
              kind: 'note',
              ...base,
              step: STEPS.includes(step) ? step : 'C',
              alter,
              octave,
              midi: midiOf(step, alter, octave),
              tieStart: ties.includes('start'),
              tieStop: ties.includes('stop'),
              syllables,
              withPrevious: chord,
            }
          } else {
            event = {
              kind: 'rest',
              ...base,
              wholeMeasure: child(e, 'rest')?.attrs.measure === 'yes',
            }
          }
          const events_ = voices.get(voice) ?? []
          events_.push(event)
          voices.set(voice, events_)
          if (!chord) {
            lastStart = start
            cursor += duration
          }
        }
      }

      const lists = [...voices.values()]
      const end = (v: MelodyEvent[]) => v.reduce((x, e) => Math.max(x, e.start + e.duration), 0)
      const lengths = lists.map(end)
      const length = Math.max(0, ...lengths)
      const measureLength = (beats * 4) / beatType
      // the sung line, or the whole timeline where there are several, has to fill the measure
      const main = lists.length > 1 ? length : (lengths[0] ?? 0)
      const full =
        lists.length > 0 &&
        Math.abs(main - measureLength) < 1e-6 &&
        lengths.every(l => l <= measureLength + 1e-6)

      const measure: MelodyMeasure = {
        number: numberOf(
          { text: m.attrs.number ?? '', name: '', attrs: {}, children: [] },
          index + 1
        ),
        voices: lists,
        chords,
        section,
        barline: barlineOf(edges),
        directions,
        repeatStart: edges.repeatStart,
        ending: null,
        length,
        full,
        fifths,
        beats,
        beatType,
        tempo,
      }
      // An ending is a bracket over the measures from its start to its stop (the barlines only name those two)
      if (edges.endingStart !== null) open = { label: edges.endingStart, of: [] }
      if (open) {
        const ending: MelodyEnding = {
          label: open.label,
          start: edges.endingStart !== null,
          stop: edges.endingStop !== null,
          closed: false,
        }
        measure.ending = ending
        open.of.push(measure)
        if (edges.endingStop) {
          for (const x of open.of) (x.ending as MelodyEnding).closed = edges.endingStop === 'stop'
          open = null
        }
      }
      measures.push(measure)
    })

  return { title, measures, notice }
}
