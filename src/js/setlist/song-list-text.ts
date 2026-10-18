/**
 * The songs of a setlist as plain text to paste into a message, e.g. to the media team: one line
 * each, the title and its CCLI number in brackets where it has one.
 */

/** What a setlist song needs to be listed (a RuntimeSong has it) */
export interface ListedSong {
  title: string
  metadata?: { ccli?: unknown; ccliSongNumber?: unknown } | null
  _canonicalSong?: { ccliNumber?: string | null } | null
}

/** The song's CCLI number: the library's, else the one in the chart ('' if there is none) */
export function ccliOf(song: ListedSong): string {
  const found =
    song._canonicalSong?.ccliNumber || song.metadata?.ccli || song.metadata?.ccliSongNumber
  return found ? String(found).trim() : ''
}

export function songListText(songs: ListedSong[]): string {
  return songs
    .map(song => {
      const ccli = ccliOf(song)
      return ccli ? `${song.title} (${ccli})` : song.title
    })
    .join('\n')
}
