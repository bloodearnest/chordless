/**
 * Setlist entries left by the first import of setlists from folders of ChordPro files (removed 2026-10-09). A file
 * it found no chart in (a title alone) became an entry for no song: its song id is `placeholder-hash-…` and its
 * notes say which file it was, `ChordPro inline: 7king-of-wonders-chords-E.txt`. A church setlist cannot name a
 * song its library does not have, so the server refuses those setlists. Once the song is imported, the entry is
 * the song of that title, in the key the file was named for.
 */

const MARKER = /^ChordPro inline: (.+)$/
const KEY = /^[A-G](?:b|#|♭|♯)?m?$/

/** Whether an entry is one of those: its song id, and its notes naming the file */
export function isPlaceholderEntry(entry: { songId: string; notes?: string | null }): boolean {
  return entry.songId.startsWith('placeholder-') && MARKER.test(entry.notes ?? '')
}

/**
 * The song the file was for, from its name: "7king-of-wonders-chords-E.txt" is "king of wonders" in E (its
 * place in the set, "-chords" and the extension are not the title). Null for notes that name no file.
 */
export function placeholderSong(notes: string): { title: string; key: string | null } | null {
  const file = MARKER.exec(notes)?.[1]
  if (!file) return null
  const words = file
    .replace(/\.[^.]+$/, '')
    .replace(/^\d+/, '')
    .split(/[-_\s]+/)
    .filter(word => word && word.toLowerCase() !== 'chords')
  const last = words.at(-1)
  const key = words.length > 1 && last && KEY.test(last) ? last : null
  if (key) words.pop()
  const title = words.join(' ')
  return title ? { title, key } : null
}
