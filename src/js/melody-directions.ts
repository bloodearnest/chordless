/**
 * The words and signs a lead sheet puts over the staff to send the player somewhere: "D.S. al Coda",
 * "2nd time to Coda", "Fine", the segno and coda signs, and plain instructions ("Play 3 times").
 * The signs are characters of the music font in the text (U+E047 segno, U+E048 coda).
 */
import type { MelodyDirection } from './melody.ts'

const SEGNO = ''
const CODA = ''

/** What one line of direction text, with its signs, says; null for nothing that is a direction */
export function parseDirection(raw: string): MelodyDirection | null {
  const text = raw.replace(/[-]/g, '').replace(/\s+/g, ' ').trim()
  const hasCoda = raw.includes(CODA)
  const hasSegno = raw.includes(SEGNO)
  const alMatch = /\bal\s+(coda|fine)\b/i.exec(text)
  const al = alMatch ? (alMatch[1]?.toLowerCase() as 'coda' | 'fine') : null
  const timeMatch = /(\d+)(?:st|nd|rd|th)\s+time/i.exec(text)
  // ("Repeat 3x Last time to Coda": the last time is the third)
  const lastTime = /\blast\s+time\b/i.test(text) ? /\brepeat\s+(\d+)\s*x/i.exec(text) : null
  const time = timeMatch ? Number(timeMatch[1]) : lastTime ? Number(lastTime[1]) : null
  const make = (kind: MelodyDirection['kind']): MelodyDirection => ({
    kind,
    al: kind === 'da-segno' || kind === 'da-capo' ? al : null,
    time,
    text,
  })
  if (/D\.\s?S\./i.test(text)) return make('da-segno')
  if (/D\.\s?C\./i.test(text)) return make('da-capo')
  if (/\bto\s+coda\b/i.test(text)) return make('to-coda')
  if (/^fine$/i.test(text)) return make('fine')
  if (!text || /^(coda|segno)$/i.test(text)) {
    if (hasSegno || /^segno$/i.test(text)) return make('segno')
    if (hasCoda || /^coda$/i.test(text)) return make('coda')
    return null
  }
  // (a number alone is a measure number or an ending's, not an instruction)
  if (/^\(?[\d,\s]+\)?$/.test(text)) return null
  return make('text')
}
