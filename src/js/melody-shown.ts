/**
 * A song's content shown as its lyrics or as its melody sheet (docs/MELODY.md), the same in a
 * setlist and in the library: the `<song-display>` and the `<melody-sheet>` beside it in one
 * `.song-content`, one of them hidden. The sheet's component is loaded the first time one is shown.
 */
import type { MelodySheet } from '../components/melody-sheet.ts'
import type { MelodyRecord } from './data-types.ts'
import type { Melody } from './melody.ts'
import { melodyOfRecord } from './melody-analysis.ts'

/** A melody, the key it is written in, and the key to show it in */
export interface ShownMelody {
  melody: Melody
  key: string
  songKey: string
}

/** The melody a record gives, and its key (the song's own when the record names none); null if there is none */
export function melodyWithKey(
  record: MelodyRecord | undefined,
  songKey: string | null | undefined
): { melody: Melody; key: string } | null {
  const melody = record && melodyOfRecord(record)
  return melody && record ? { melody, key: record.key || songKey || '' } : null
}

/** Show a song's content as this melody's sheet, or (with none) as its lyrics */
export async function showMelody(content: HTMLElement, shown: ShownMelody | null): Promise<void> {
  const display = content.querySelector<HTMLElement>('song-display')
  const sheet = content.querySelector<MelodySheet>('melody-sheet')
  if (!shown) {
    if (sheet) sheet.hidden = true
    if (display) display.style.display = ''
    return
  }
  await import('../components/melody-sheet.ts')
  const made = sheet ?? document.createElement('melody-sheet')
  made.melody = shown.melody
  made.melodyKey = shown.key
  made.songKey = shown.songKey
  made.hidden = false
  if (!sheet) content.appendChild(made)
  if (display) display.style.display = 'none'
}
