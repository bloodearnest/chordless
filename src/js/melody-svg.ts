/**
 * Reads the melody out of a SongSelect lead sheet's SVG (what `GetSongLeadPreview` returns, one SVG
 * per page, engraved by Verovio; `docs/MELODY.md`, "A better source than the PDF").
 *
 * Verovio draws every symbol as a reference to a named music font glyph (SMuFL code points) and
 * wraps them in groups named for what they are (`measure`, `note`, `rest`, `beam`, `harm`...), so
 * this is a walk of the tree: a note's length is its head glyph, its beams or flags and its dots; a
 * rest's is its glyph; its pitch is the head's height against the staff lines, the clef and the key
 * signature, and the sheet's accidentals. Every measure is then added up against the time signature,
 * which is how a wrong reading shows.
 */
import {
  type Melody,
  type MelodyChord,
  type MelodyEvent,
  type MelodyMeasure,
  type MelodyNote,
  midiOf,
} from './melody.ts'

export interface El {
  name: string
  attrs: Record<string, string>
  children: El[]
  /** The text directly inside, in order, joined */
  text: string
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
    if (e[0] === '#')
      return String.fromCodePoint(
        e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      )
    return ENTITIES[e] ?? m
  })
}

/** A small XML reader: elements, attributes and text; no namespaces, DTDs or CDATA, which Verovio does not write */
export function parseXml(xml: string): El {
  const root: El = { name: '#root', attrs: {}, children: [], text: '' }
  const stack = [root]
  const tag =
    /<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|<[?!][^>]*>|([^<]+)/g
  const attr = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
  for (let m = tag.exec(xml); m; m = tag.exec(xml)) {
    const top = stack[stack.length - 1] as El
    if (m[5] !== undefined) {
      if (m[5].trim()) top.text += decode(m[5])
    } else if (m[2] === undefined) {
      // a declaration or comment
    } else if (m[1]) {
      stack.pop()
    } else {
      const el: El = { name: m[2], attrs: {}, children: [], text: '' }
      for (let a = attr.exec(m[3] ?? ''); a; a = attr.exec(m[3] ?? ''))
        el.attrs[a[1] as string] = decode(a[2] ?? a[3] ?? '')
      top.children.push(el)
      if (!m[4]) stack.push(el)
    }
  }
  return root.children[0] as El
}

const classes = (e: El) => (e.attrs.class ?? '').split(/\s+/)
const is = (e: El, cls: string) => classes(e).includes(cls)

/** Every descendant (not the element itself), in document order, that the test accepts */
function all(e: El, test: (c: El) => boolean, out: El[] = []): El[] {
  for (const c of e.children) {
    if (test(c)) out.push(c)
    all(c, test, out)
  }
  return out
}

const byClass = (e: El, cls: string) => all(e, c => is(c, cls))
const firstByClass = (e: El, cls: string) => byClass(e, cls)[0]

/**
 * A chord symbol's text. The flat after a root ("Eb") is drawn in the music font as a private use
 * character (U+EA64 in these sheets, which is the only one seen); the sharp is assumed to be the next code
 */
const CHORD_ACCIDENTAL: Record<string, string> = {
  '\uea64': 'b',
  '\uea65': '#',
  '\ue260': 'b',
  '\ue262': '#',
}
const chordText = (s: string) => s.replace(/[\ue000-\uf8ff]/g, c => CHORD_ACCIDENTAL[c] ?? '?')

/** The text of an element, tspans joined */
function textOf(e: El): string {
  return (e.text + e.children.map(textOf).join('')).replace(/\s+/g, ' ').trim()
}

/**
 * What follows a syllable: a short drawn bar is a hyphen (the word goes on), a long one the extender
 * of a syllable held over several notes. The extender is the word's own last syllable, so it is '_'
 */
function connectorOf(verse: El): string {
  const bar = all(verse, c => c.name === 'rect')[0]
  if (!bar) return ''
  return Number(bar.attrs.width) > 150 ? '_' : '-'
}

/** A `<use>`d glyph: its SMuFL code ("E0A4") and where it is placed */
interface Glyph {
  code: string
  x: number
  y: number
  scale: number
}

function glyphOf(use: El): Glyph | null {
  const href = use.attrs['xlink:href'] ?? use.attrs.href ?? ''
  const t = /translate\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)\s*\)/.exec(use.attrs.transform ?? '')
  const s = /scale\(\s*(-?[\d.]+)/.exec(use.attrs.transform ?? '')
  if (!href.startsWith('#') || !t) return null
  return {
    code: (href.slice(1).split('-')[0] as string).toUpperCase(),
    x: Number(t[1]),
    y: Number(t[2]),
    scale: s ? Number(s[1]) : 1,
  }
}

const glyphs = (e: El) => all(e, c => c.name === 'use').flatMap(u => glyphOf(u) ?? [])

/** The numbers in a path ("M0 3237 L4939 3237", "M3641,4362 C...") */
const nums = (d: string) => (d.match(/-?\d*\.?\d+/g) ?? []).map(Number)

const FLAT = 'E260'
const NATURAL = 'E261'
const SHARP = 'E262'
const DOUBLE_SHARP = 'E263'
const DOUBLE_FLAT = 'E264'
const ACCIDENTAL: Record<string, number> = {
  [FLAT]: -1,
  [NATURAL]: 0,
  [SHARP]: 1,
  [DOUBLE_SHARP]: 2,
  [DOUBLE_FLAT]: -2,
}

/** Notehead glyphs: whole, half, and the filled head of a quarter and shorter */
const HEAD: Record<string, number> = { E0A2: 4, E0A3: 2, E0A4: 1, E0A9: 1 }
/** Rest glyphs: whole, half, quarter, 8th, 16th, 32nd, 64th */
const REST: Record<string, number> = {
  E4E3: 4,
  E4E4: 2,
  E4E5: 1,
  E4E6: 0.5,
  E4E7: 0.25,
  E4E8: 0.125,
  E4E9: 0.0625,
}
/** Flags: 8th up/down, 16th up/down, 32nd up/down, 64th up/down */
const FLAGS: Record<string, number> = {
  E240: 1,
  E241: 1,
  E242: 2,
  E243: 2,
  E244: 3,
  E245: 3,
  E246: 4,
  E247: 4,
}

/** Steps as C=0..B=6; the order accidentals are added to a key signature */
const STEPS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const
const FLAT_ORDER = [6, 2, 5, 1, 4, 0, 3]
const SHARP_ORDER = [3, 0, 4, 1, 5, 2, 6]

/** The diatonic number (octave * 7 + step) of the bottom staff line for a clef sitting on staff line `line` (1 is the bottom) */
function bottomLine(clef: string, line: number): number | null {
  if (clef === 'E050') return 4 * 7 + 4 - 2 * (line - 1) // G clef: the line is G4
  if (clef === 'E062') return 3 * 7 + 3 - 2 * (line - 1) // F clef: the line is F3
  if (clef === 'E05C') return 4 * 7 + 0 - 2 * (line - 1) // C clef: the line is C4
  return null
}

export interface ReadStats {
  measures: number
  /** Measures whose voices all add up to the time signature */
  full: number
  /** Measures that do not (the pickup and the last may be short legitimately) */
  short: MelodyMeasure[]
  notes: number
  rests: number
  warnings: string[]
}

/** One bar of one staff as it sits on the page, before it is turned into time */
interface Raw {
  m: El
  systemIndex: number
}

function lengthOf(beats: number, beatType: number): number {
  return (beats * 4) / beatType
}

/** Read the pages' SVG text, in page order, into a melody */
export function readMelodySvg(svgs: string[], stats?: ReadStats): Melody {
  return readMelodyTrees(svgs.map(parseXml), stats)
}

/**
 * Read pages already parsed. The PDF reader (`melody-pdf.ts`) builds the same tree from the page's
 * drawing, so everything from here on is shared.
 */
export function readMelodyTrees(roots: El[], stats?: ReadStats): Melody {
  const warnings: string[] = stats?.warnings ?? []
  const raws: Raw[] = []
  const notice: string[] = []
  let title: string | null = null
  let systemIndex = 0
  for (const root of roots) {
    for (const head of byClass(root, 'pgHead')) {
      const t = firstByClass(head, 'text')
      if (t && title === null) title = textOf(t)
    }
    for (const foot of [...byClass(root, 'pgHead'), ...byClass(root, 'pgFoot')]) {
      for (const t of foot.children.flatMap(x => (x.name === 'text' ? [x] : []))) {
        const s = textOf(t)
        if (s) notice.push(s)
      }
    }
    for (const sys of byClass(root, 'system')) {
      for (const m of sys.children.filter(c => is(c, 'measure'))) raws.push({ m, systemIndex })
      systemIndex++
    }
  }

  const measures: MelodyMeasure[] = []
  let fifths = 0
  let beats = 4
  let beatType = 4
  let tempo: number | null = null
  let keyAlters: number[] = [0, 0, 0, 0, 0, 0, 0]
  let clef = { code: 'E050', line: 2 }
  let n = 0

  const heads: Head[] = []
  for (const { m, systemIndex } of raws) {
    n++
    const staff = firstByClass(m, 'staff')
    if (!staff) continue

    // The staff lines are the five paths directly in the staff
    const lineYs = staff.children
      .filter(c => c.name === 'path')
      .map(c => nums(c.attrs.d ?? ''))
      .filter(v => v.length === 4 && v[1] === v[3])
      .map(v => v[1] as number)
      .sort((a, b) => b - a)
    if (lineYs.length !== 5) {
      warnings.push(`measure ${n}: ${lineYs.length} staff lines`)
      continue
    }
    const bottomY = lineYs[0] as number
    const half = ((lineYs[0] as number) - (lineYs[4] as number)) / 8

    const clefEl = staff.children.find(c => is(c, 'clef'))
    const clefGlyph = clefEl ? glyphs(clefEl)[0] : undefined
    if (clefGlyph)
      clef = { code: clefGlyph.code, line: Math.round((bottomY - clefGlyph.y) / (2 * half)) + 1 }
    const bottomDia = bottomLine(clef.code, clef.line)
    if (bottomDia === null) {
      warnings.push(`measure ${n}: clef ${clef.code} not read`)
      continue
    }

    const keySig = staff.children.find(c => is(c, 'keySig'))
    if (keySig) {
      const accs = glyphs(keySig)
      keyAlters = [0, 0, 0, 0, 0, 0, 0]
      const flats = accs.filter(g => g.code === FLAT).length
      const sharps = accs.filter(g => g.code === SHARP).length
      fifths = sharps - flats
      FLAT_ORDER.slice(0, flats).forEach(s => {
        keyAlters[s] = -1
      })
      SHARP_ORDER.slice(0, sharps).forEach(s => {
        keyAlters[s] = 1
      })
    }
    const meter = staff.children.find(c => is(c, 'meterSig'))
    if (meter) {
      const digits = glyphs(meter)
      const rows = [...new Set(digits.map(g => g.y))].sort((a, b) => a - b)
      const num = (y: number | undefined) =>
        digits
          .filter(g => g.y === y)
          .sort((a, b) => a.x - b.x)
          .map(g => parseInt(g.code, 16) - 0xe080)
      if (rows.length === 2) {
        beats = Number(num(rows[0]).join(''))
        beatType = Number(num(rows[1]).join(''))
      } else if (digits[0]?.code === 'E08A') {
        beats = 4 // common time
        beatType = 4
      } else if (digits[0]?.code === 'E08B') {
        beats = 2 // cut time
        beatType = 2
      } else warnings.push(`measure ${n}: time signature not read`)
    }
    const measureLen = lengthOf(beats, beatType)

    // The tempo mark: the number after the "="
    const tempoEl = firstByClass(m, 'tempo')
    let measureTempo: number | null = null
    if (tempoEl) {
      const mm = /=\s*(\d+)/.exec(textOf(tempoEl))
      if (mm) {
        measureTempo = Number(mm[1])
        tempo = measureTempo
      }
    }

    // Notes and rests, voice by voice, in the order they are drawn
    const measureAlters = new Map<number, number>()
    const voices: MelodyEvent[][] = []
    /** Where an event is on the page, when the source says (the PDF's drawing does): lines of different voices are lined up by it */
    const xOf = new Map<MelodyEvent, number>()
    const headXs: { x: number; start: number }[] = []
    for (const layer of byClass(staff, 'layer')) {
      const events: MelodyEvent[] = []
      let t = 0
      voices.push(events)
      const walk = (parent: El, tupletRatio: number, beams: El | null) => {
        for (const c of parent.children) {
          if (is(c, 'beam')) walk(c, tupletRatio, c)
          else if (is(c, 'tuplet')) walk(c, tupletRatio * tupletFactor(c), beams)
          else if (is(c, 'graceGrp')) continue
          else if (is(c, 'rest') || is(c, 'mRest')) {
            const g = glyphs(c)[0]
            const dots = dotCount(c)
            const whole = is(c, 'mRest') || g?.code === 'E4E3'
            if (!g) {
              warnings.push(`measure ${n}: rest ${c.attrs.id} has no glyph`)
              continue
            }
            let dur = REST[g.code]
            if (dur === undefined) {
              warnings.push(`measure ${n}: rest glyph ${g.code}`)
              continue
            }
            if (whole && dur === 4) dur = measureLen
            else dur = dur * dotFactor(dots) * tupletRatio
            events.push({
              kind: 'rest',
              id: c.attrs.id ?? '',
              start: t,
              duration: dur,
              tupletRatio,
              wholeMeasure: whole,
              cue: g.scale < 0.65,
            })
            if (c.attrs['data-x'])
              xOf.set(events[events.length - 1] as MelodyEvent, Number(c.attrs['data-x']))
            t += dur
          } else if (is(c, 'chord') || is(c, 'note')) {
            const notes = is(c, 'chord') ? byClass(c, 'note') : [c]
            const owner = c
            let first = true
            let dur = 0
            for (const note of notes) {
              const head = firstByClass(note, 'notehead')
              const hg = head ? glyphs(head)[0] : undefined
              if (!hg) {
                warnings.push(`measure ${n}: note ${note.attrs.id} has no head`)
                continue
              }
              const base = HEAD[hg.code]
              if (base === undefined) {
                warnings.push(`measure ${n}: head glyph ${hg.code}`)
                continue
              }
              const stemEl = firstByClass(owner, 'stem')
              const stemX = stemEl ? (nums(firstPath(stemEl)?.attrs.d ?? '')[0] ?? null) : null
              let d = base
              if (base === 1) {
                const flag = firstByClass(owner, 'flag')
                const fg = flag ? glyphs(flag)[0] : undefined
                let levels = fg ? (FLAGS[fg.code] ?? 0) : 0
                if (beams && stemX !== null) levels = beamLevels(beams, stemX)
                d = 1 / 2 ** levels
              }
              const dots = dotCount(owner)
              d = d * dotFactor(dots) * tupletRatio
              dur = d

              // Pitch: the head's height on the staff, then the key and the sheet's accidentals
              const dia = bottomDia + Math.round((bottomY - hg.y) / half)
              const stepIndex = ((dia % 7) + 7) % 7
              const octave = Math.floor(dia / 7)
              let alter = measureAlters.get(dia) ?? keyAlters[stepIndex] ?? 0
              const acc = firstByClass(note, 'accid')
              const ag = acc ? glyphs(acc)[0] : undefined
              if (ag && ACCIDENTAL[ag.code] !== undefined) {
                alter = ACCIDENTAL[ag.code] as number
                measureAlters.set(dia, alter)
              }
              const sylls = byClass(note, 'verse').map(v => textOf(v) + connectorOf(v))
              const step = STEPS[stepIndex] as (typeof STEPS)[number]
              events.push({
                kind: 'note',
                id: note.attrs.id ?? '',
                step,
                alter,
                octave,
                midi: midiOf(step, alter, octave),
                start: first ? t : t,
                duration: d,
                tupletRatio,
                tieStart: false,
                tieStop: false,
                cue: hg.scale < 0.65,
                syllables: sylls,
                withPrevious: !first,
              })
              if (owner.attrs['data-x'])
                xOf.set(events[events.length - 1] as MelodyEvent, Number(owner.attrs['data-x']))
              headXs.push({ x: hg.x, start: t })
              heads.push({
                sys: systemIndex,
                x: hg.x + (HEAD_WIDTH * hg.scale) / 2,
                y: hg.y,
                note: events[events.length - 1] as MelodyNote,
              })
              first = false
            }
            t += dur
          } else if (c.children.length && !is(c, 'verse') && !is(c, 'accid') && !is(c, 'dots'))
            walk(c, tupletRatio, beams)
        }
      }
      walk(layer, 1, null)
    }

    const aligned =
      voices.length > 1 && voices.every(v => v.every(e => xOf.has(e)))
        ? alignVoices(voices, xOf)
        : null
    const voiceLengths = voices.map(v => end(v))
    const total = Math.max(0, ...voiceLengths)
    // The sung line has to add up; an instrumental one in cue size may stop short (the PDF draws no spacer rests) but not run over
    const sung = voices.findIndex(v => v.some(e => !e.cue))
    const main = aligned ?? voiceLengths[Math.max(0, sung)] ?? 0
    const full =
      voiceLengths.length > 0 &&
      Math.abs(main - measureLen) < 1e-6 &&
      voiceLengths.every(l => l <= measureLen + 1e-6)

    // Chord symbols sit above the beat they belong to: the nearest head along the staff
    const chords: MelodyChord[] = byClass(m, 'harm').flatMap(h => {
      const text = chordText(textOf(h))
      const tx = firstByClass(h, 'text')
      const x = Number(h.children[0]?.attrs.x ?? tx?.attrs.x ?? 0)
      if (!text) return []
      const near = headXs.reduce<{ x: number; start: number } | null>(
        (b, c) => (!b || Math.abs(c.x - x) < Math.abs(b.x - x) ? c : b),
        null
      )
      return [{ start: near ? near.start : 0, text }]
    })

    const reh = firstByClass(m, 'reh')
    const barLines = byClass(m, 'barLine')
    measures.push({
      number: n,
      voices,
      chords,
      section: reh ? textOf(reh) : null,
      barline: barlineOf(barLines[barLines.length - 1]),
      length: total,
      full,
      fifths,
      beats,
      beatType,
      tempo: measureTempo ?? (measures.length === 0 ? tempo : null),
    })
  }

  // Ties and the sheet's own lines: a tie is a curve from one head to the next of the same pitch
  tieNotes(raws, heads, warnings)

  const mm: ReadStats = {
    measures: measures.length,
    full: measures.filter(x => x.full).length,
    short: measures.filter(x => !x.full),
    notes: measures.reduce((s, x) => s + x.voices.flat().filter(e => e.kind === 'note').length, 0),
    rests: measures.reduce((s, x) => s + x.voices.flat().filter(e => e.kind === 'rest').length, 0),
    warnings,
  }
  if (stats) Object.assign(stats, mm)
  return { title, measures, notice: [...new Set(notice)] }
}

function end(events: MelodyEvent[]): number {
  return events.reduce((m, e) => Math.max(m, e.start + e.duration), 0)
}

function firstPath(e: El): El | undefined {
  return e.children.find(c => c.name === 'path')
}

/** The dots after a head or rest: its ellipses (a chord's dots group has one row of them for each head, so count a row) */
function dotCount(e: El): number {
  const rows = new Map<string, number>()
  for (const g of byClass(e, 'dots'))
    for (const d of all(g, x => x.name === 'ellipse'))
      rows.set(d.attrs.cy ?? '', (rows.get(d.attrs.cy ?? '') ?? 0) + 1)
  return Math.max(0, ...rows.values())
}

const dotFactor = (dots: number) => 2 - 1 / 2 ** dots

/** 3:2 for a triplet, and so on: the notes inside last `normal / actual` of what they are written */
function tupletFactor(t: El): number {
  const num = glyphs(t)
    .filter(g => /^E08[0-9]$/.test(g.code))
    .sort((a, b) => a.x - b.x)
    .map(g => parseInt(g.code, 16) - 0xe080)
  const actual = Number(num.join('')) || 3
  let normal = 1
  while (normal * 2 <= actual) normal *= 2
  return normal / actual
}

/**
 * How many beams join a stem at `x`: the beam polygons that run across it. A sloped secondary beam
 * is drawn in pieces, one between each pair of stems, that meet end to end; they are one beam.
 */
function beamLevels(beam: El, x: number): number {
  interface P {
    x0: number
    x1: number
    yLeft: number
    yRight: number
    chain: number
  }
  const polys: P[] = beam.children
    .filter(c => c.name === 'polygon')
    .flatMap(p => {
      const pts = (p.attrs.points ?? '')
        .split(/\s+/)
        .map(pt => pt.split(',').map(Number) as [number, number])
      if (pts.length < 4) return []
      const [tl, tr] = pts as [[number, number], [number, number]]
      return [
        {
          x0: Math.min(tl[0], tr[0]),
          x1: Math.max(tl[0], tr[0]),
          yLeft: tl[1],
          yRight: tr[1],
          chain: 0,
        },
      ]
    })
  polys.sort((a, b) => a.x0 - b.x0)
  polys.forEach((p, i) => {
    p.chain = i
  })
  for (const a of polys)
    for (const b of polys)
      if (a !== b && Math.abs(a.x1 - b.x0) < 8 && Math.abs(a.yRight - b.yLeft) < 12)
        b.chain = a.chain
  const chains = new Set<number>()
  for (const p of polys) if (p.x0 - 25 <= x && x <= p.x1 + 25) chains.add(p.chain)
  return chains.size
}

function barlineOf(b: El | undefined): MelodyMeasure['barline'] {
  if (!b) return 'none'
  const lines = all(b, c => c.name === 'path').length
  const dots = all(b, c => c.name === 'ellipse' || c.name === 'circle').length
  if (dots) return 'repeat-end'
  const dashed = all(b, c => c.name === 'path' && !!c.attrs['stroke-dasharray']).length
  if (dashed) return 'dashed'
  if (lines >= 2) return 'final'
  return 'single'
}

/** A notehead's centre on its system, and the note it is */
interface Head {
  sys: number
  x: number
  y: number
  note: MelodyNote
}

/** A solid head is about this wide, in the music font's units (an em is 1000) */
const HEAD_WIDTH = 314

/**
 * Tie curves: a tie is a crescent from the centre of one head to the centre of the next of the same
 * pitch, so the heads at its two ends are tied. A tie that runs off the end of a system has only one.
 */
function tieNotes(raws: Raw[], heads: Head[], warnings: string[]) {
  // A tie starts just after the centre of its first head and ends just before the centre of the second
  const before = (sys: number, x: number, y: number) =>
    heads
      .filter(h => h.sys === sys && h.x <= x + 40 && h.x >= x - 260 && Math.abs(h.y - y) < 400)
      .sort((p, q) => q.x - p.x)[0]
  const after = (sys: number, x: number, y: number) =>
    heads
      .filter(h => h.sys === sys && h.x >= x - 40 && h.x <= x + 260 && Math.abs(h.y - y) < 400)
      .sort((p, q) => p.x - q.x)[0]
  for (const { m, systemIndex } of raws) {
    for (const tie of byClass(m, 'tie')) {
      const v = nums(firstPath(tie)?.attrs.d ?? '')
      if (v.length < 8) continue
      const a = before(systemIndex, v[0] as number, v[1] as number)
      const b = after(systemIndex, v[6] as number, v[7] as number)
      // A curve between two different pitches is a slur
      if (a && b && a.note.midi !== b.note.midi) continue
      if (a) a.note.tieStart = true
      if (b) b.note.tieStop = true
      // A tie that runs off the end of a system goes on into the first head of the next, drawn without its own curve
      if (a && !b) {
        const next = heads.find(h => h.sys === systemIndex + 1)
        if (next && next.note.midi === a.note.midi) next.note.tieStop = true
      }
      if (!a && !b) warnings.push(`tie ${tie.attrs.id} joins no heads`)
    }
  }
}

/**
 * Lines up the voices of a measure that were drawn without spacer rests (the PDF's drawing has none),
 * by where each event is on the page: events at the same place start together, and the next place
 * is when the first of the events still sounding ends. The line that is sung and one in cue size
 * that runs with it, or takes over from its rests, come out as one timeline. Returns when it ends.
 */
function alignVoices(voices: MelodyEvent[][], xOf: Map<MelodyEvent, number>): number {
  const all = voices.flatMap(v => v).sort((a, b) => (xOf.get(a) as number) - (xOf.get(b) as number))
  const sounding: MelodyEvent[] = []
  let time = 0
  let latest = 0
  for (let i = 0; i < all.length; ) {
    const x0 = xOf.get(all[i] as MelodyEvent) as number
    let j = i
    while (j < all.length && (xOf.get(all[j] as MelodyEvent) as number) - x0 < 40) j++
    for (const e of all.slice(i, j)) {
      e.start = time
      sounding.push(e)
      latest = Math.max(latest, time + e.duration)
    }
    const ends = sounding.map(e => e.start + e.duration).filter(end => end > time + 1e-9)
    time = ends.length ? Math.min(...ends) : latest
    i = j
  }
  return latest
}
