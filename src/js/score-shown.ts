/**
 * A song's content shown as its lyrics or as its melody sheet (docs/MELODY.md), the same in a
 * setlist and in the library: the `<song-display>` and the `<score-view>` beside it in one
 * `.song-content`, one of them hidden. The sheet's component is loaded the first time one is shown.
 */
import type { ScoreView } from '../components/score-view.ts'
import type { ScoreRecord } from './data-types.ts'
import { melodyOfRecord } from './melody-analysis.ts'
import type { Score } from './score.ts'

/** A melody, the key it is written in, and the key to show it in */
export interface ShownScore {
  melody: Score
  key: string
  songKey: string
}

/** The melody a record gives, and its key (the song's own when the record names none); null if there is none */
export function scoreWithKey(
  record: ScoreRecord | undefined,
  songKey: string | null | undefined
): { melody: Score; key: string } | null {
  const melody = record && melodyOfRecord(record)
  return melody && record ? { melody, key: record.key || songKey || '' } : null
}

/** Show a song's content as this melody's sheet, or (with none) as its lyrics */
export async function showScore(content: HTMLElement, shown: ShownScore | null): Promise<void> {
  const display = content.querySelector<HTMLElement>('song-display')
  const sheet = content.querySelector<ScoreView>('score-view')
  if (!shown) {
    if (sheet) sheet.hidden = true
    if (display) display.style.display = ''
    return
  }
  await import('../components/score-view.ts')
  const made = sheet ?? document.createElement('score-view')
  made.melody = shown.melody
  made.melodyKey = shown.key
  made.songKey = shown.songKey
  made.hidden = false
  if (!sheet) content.appendChild(made)
  if (display) display.style.display = 'none'
}
