/**
 * Spike for docs/MELODY.md: read a SongSelect lead sheet preview (the `GetSongLeadPreview` response,
 * saved as JSON) into a melody, check every measure against its time signature, and score the notes
 * against the preview's own MIDI and time map.
 *
 *   node scripts/melody-spike.ts preview.json [--musicxml out.musicxml] [--dump]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { type MelodyNote } from '../src/js/melody.ts'
import { readMelodySvg, type ReadStats } from '../src/js/melody-svg.ts'

interface TimeEvent {
  on: string[] | null
  off: string[] | null
  restsOn: string[] | null
  restsOff: string[] | null
  qstamp: number
  tstamp: number
}

const b64 = (s: string) => Buffer.from(s.replace(/^data:[^,]*,\s*/, '').trim(), 'base64')

/** Note-ons of a standard MIDI file: ms from the start and the pitch (one tempo is assumed, as in these) */
function midiNotes(buf: Buffer): { ms: number; pitch: number }[] {
  let p = 14
  const division = buf.readUInt16BE(12)
  const out: { ms: number; pitch: number }[] = []
  let usPerQuarter = 500000
  const tempos: { tick: number; us: number }[] = []
  const ons: { tick: number; pitch: number }[] = []
  while (p < buf.length) {
    const len = buf.readUInt32BE(p + 4)
    const end = p + 8 + len
    p += 8
    let tick = 0
    let status = 0
    while (p < end) {
      let delta = 0
      let b: number
      do {
        b = buf[p++] as number
        delta = (delta << 7) | (b & 0x7f)
      } while (b & 0x80)
      tick += delta
      let s = buf[p] as number
      if (s & 0x80) {
        status = s
        p++
      } else s = status
      if (s === 0xff) {
        const type = buf[p++] as number
        let l = 0
        let c: number
        do {
          c = buf[p++] as number
          l = (l << 7) | (c & 0x7f)
        } while (c & 0x80)
        if (type === 0x51) tempos.push({ tick, us: buf.readUIntBE(p, 3) })
        p += l
      } else if (s === 0xf0 || s === 0xf7) {
        let l = 0
        let c: number
        do {
          c = buf[p++] as number
          l = (l << 7) | (c & 0x7f)
        } while (c & 0x80)
        p += l
      } else {
        const hi = s & 0xf0
        const a = buf[p] as number
        const v = buf[p + 1] as number
        p += hi === 0xc0 || hi === 0xd0 ? 1 : 2
        if (hi === 0x90 && v > 0) ons.push({ tick, pitch: a })
      }
    }
    p = end
  }
  const toMs = (tick: number) => {
    let ms = 0
    let last = 0
    let us = usPerQuarter
    for (const t of tempos) {
      if (t.tick >= tick) break
      ms += ((t.tick - last) * us) / division / 1000
      last = t.tick
      us = t.us
    }
    usPerQuarter = us
    return ms + ((tick - last) * us) / division / 1000
  }
  for (const o of ons) out.push({ ms: toMs(o.tick), pitch: o.pitch })
  return out
}

const args = process.argv.slice(2)
const file = args[0]
if (!file) throw new Error('usage: melody-spike.ts preview.json [--musicxml out]')
const res = JSON.parse(readFileSync(file, 'utf8'))
const payload = res.payload ?? res
const svgs: string[] = (payload.svgs as string[]).map((s) => b64(s).toString('utf8'))
const stats = { warnings: [] as string[] } as ReadStats
const melody = readMelodySvg(svgs, stats)

console.log(`${melody.title}: ${stats.measures} measures, ${stats.full} add up to the time signature`)
console.log(`${stats.notes} notes, ${stats.rests} rests`)
for (const m of stats.short) console.log(`  measure ${m.number}: ${m.length} of ${(m.beats * 4) / m.beatType}`)
for (const w of stats.warnings.slice(0, 20)) console.log(`  warning: ${w}`)
console.log(`notice: ${melody.notice.join(' / ')}`)

// Against the time map
const timemap = payload.timemap as TimeEvent[]
const onAt = new Map<string, number>()
const offAt = new Map<string, number>()
for (const e of timemap) {
  for (const id of e.on ?? []) onAt.set(id, e.qstamp)
  for (const id of e.off ?? []) offAt.set(id, e.qstamp)
}
const notes: MelodyNote[] = melody.measures.flatMap((m) => m.voices.flat().filter((e): e is MelodyNote => e.kind === 'note'))
let known = 0
let durOk = 0
const durBad: string[] = []
for (const n of notes) {
  const on = onAt.get(n.id)
  const off = offAt.get(n.id)
  if (on === undefined || off === undefined) continue
  known++
  if (Math.abs(off - on - n.duration) < 1e-6) durOk++
  else durBad.push(`${n.id} ${n.step}${n.octave} ours ${n.duration} map ${off - on}`)
}
console.log(`time map: ${known}/${notes.length} notes found by id; ${durOk} with the same length`)
for (const d of durBad.slice(0, 8)) console.log(`  ${d}`)

// Against the MIDI: a note of ours at the time the map starts it, with the same pitch
const midi = payload.midi ? midiNotes(b64(payload.midi)) : []
const timeMs = new Map<string, number>()
for (const e of timemap) for (const id of e.on ?? []) timeMs.set(id, e.tstamp)
let pitchOk = 0
let pitchChecked = 0
const pitchBad: string[] = []
for (const n of notes) {
  if (n.tieStop) continue
  const ms = timeMs.get(n.id)
  if (ms === undefined) continue
  pitchChecked++
  if (midi.some((x) => Math.abs(x.ms - ms) < 5 && x.pitch === n.midi)) pitchOk++
  else pitchBad.push(`${n.id} ${n.step}${n.alter ? (n.alter > 0 ? '#' : 'b') : ''}${n.octave} (${n.midi}) at ${ms}ms: midi has ${midi.filter((x) => Math.abs(x.ms - ms) < 5).map((x) => x.pitch)}`)
}
console.log(`midi: ${midi.length} notes; ${pitchOk}/${pitchChecked} of ours match a MIDI note at the same time and pitch`)
for (const d of pitchBad.slice(0, 8)) console.log(`  ${d}`)

// Lyrics: the words the notes carry against the words of the chart (--cho file)
const cho = args.indexOf('--cho')
if (cho >= 0 && args[cho + 1]) {
  const chart = readFileSync(args[cho + 1] as string, 'utf8')
    .replace(/\{[^}]*\}/g, ' ')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/ - /g, '')
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z']/g, '')
  const chartWords = new Set(chart.split(/\s+/).map(norm).filter(Boolean))
  const words: string[] = []
  let cur = ''
  for (const n of notes) {
    const s = n.syllables[0] ?? ''
    if (!s || /^\d+\.$/.test(s)) continue
    cur += s.replace(/[-_]$/, '')
    if (!s.endsWith('-')) {
      words.push(cur)
      cur = ''
    }
  }
  const missing = words.filter((w) => !chartWords.has(norm(w)))
  console.log(`lyrics: ${words.length - missing.length}/${words.length} words of verse 1 are in the chart${missing.length ? `; not: ${[...new Set(missing)].slice(0, 12).join(' ')}` : ''}`)
}

if (args.includes('--dump')) {
  for (const m of melody.measures) {
    const body = m.voices.map((v) => v.map((e) => (e.kind === 'rest' ? `r${e.duration}` : `${e.step}${e.alter ? (e.alter > 0 ? '#' : 'b') : ''}${e.octave}:${e.duration}${e.tieStart ? '~' : ''}${e.syllables[0] ?? ''}${e.cue ? '(c)' : ''}`)).join(' ')).join(' | ')
    console.log(`${String(m.number).padStart(3)} ${m.section ?? ''} ${m.chords.map((c) => `${c.text}@${c.start}`).join(' ')} :: ${body} ${m.full ? '' : '!!'}`)
  }
}
const xo = args.indexOf('--musicxml')
if (xo >= 0 && args[xo + 1]) {
  const { writeMusicXml } = await import('../src/js/melody-musicxml.ts')
  writeFileSync(args[xo + 1] as string, writeMusicXml(melody))
}
