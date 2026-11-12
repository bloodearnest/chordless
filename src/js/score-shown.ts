/**
 * A song's content shown as its lyrics or as its melody sheet (docs/LEAD_SHEETS.md), the same in a
 * setlist and in the library: the `<song-display>` and the `<score-view>` beside it in one
 * `.song-content`, one of them hidden. The sheet's component is loaded the first time one is shown.
 */
import type { ScoreView } from '../components/score-view.ts'
import type { SongDisplay } from '../components/song-display.ts'
import type { ScoreRecord } from './data-types.ts'
import { melodyOfRecord } from './melody-analysis.ts'
import type { Score } from './score.ts'
import { songCues } from './score-section.ts'

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
  if (!shown) {
    const sheet = content.querySelector<ScoreView>('score-view')
    if (sheet) sheet.hidden = true
    if (display) display.style.display = ''
    return
  }
  await import('../components/score-view.ts')
  // (looked for after the import: a song's sheet is asked for twice as the page opens, and the second
  // asks while the first waits for the import, so both would make one)
  const sheet = content.querySelector<ScoreView>('score-view')
  const made = sheet ?? document.createElement('score-view')
  made.melody = shown.melody
  made.melodyKey = shown.key
  made.songKey = shown.songKey
  made.hidden = false
  if (!sheet) content.appendChild(made)
  if (display) display.style.display = 'none'
}

/**
 * Put a song's lead sheet back into content that was made again (a new key draws the lyrics anew),
 * with the lyrics hidden, so that they are not seen for the time it takes to engrave the new sheet: the
 * sheet it had stays until the new one is ready (`<score-view>`).
 */
export function keepSheet(content: HTMLElement, display: HTMLElement, sheet: HTMLElement): void {
  display.style.display = 'none'
  content.appendChild(sheet)
}

/** The lead sheet that is shown in some content, to be kept through drawing the song again (null when the lyrics are) */
export function shownSheet(content: ParentNode | null | undefined): HTMLElement | null {
  return content?.querySelector<HTMLElement>('score-view:not([hidden])') ?? null
}

/**
 * Give a song's sections the notes of its lead sheet they have (docs/LEAD_SHEETS.md, "In the chart"), or take them
 * away (with no melody). Returns whether any section has some, which is when the song's section states are
 * to be worked out again: a part with no words shows its notes by default.
 */
export function attachCues(
  content: ParentNode,
  found: { melody: Score; key: string } | null
): boolean {
  const display = content.querySelector<SongDisplay>('song-display')
  if (!display) return false
  const cues = songCues(found, display.parsed)
  const changed = Boolean(cues) !== Boolean(display.cues)
  display.cues = cues
  return changed || Boolean(cues)
}
