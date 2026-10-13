/**
 * Where to send someone to get the SongSelect version of a song: the import never takes a chart
 * from an email's PDFs (they are other people's copies, often old ones from before SongSelect).
 * With the song's CCLI number it is the song's own page, which the bookmarklet imports from
 * (songselect-bookmarklet.ts reads the number from /songs/<number>). Without one, SongSelect's
 * search for the title, to find the song and then use the bookmarklet there.
 *
 * Open it in a new window (target="_blank" rel="noopener"), so the import page stays where it is.
 */
const ORIGIN = 'https://songselect.ccli.com'

/** Is this a CCLI song number (not a licence number or a stray figure)? */
export function isCcliNumber(ccli: string | null | undefined): ccli is string {
  return Boolean(ccli && /^\d{4,9}$/.test(ccli))
}

export function songSelectLink(song: { ccli: string | null; title: string }): string {
  if (isCcliNumber(song.ccli)) return `${ORIGIN}/songs/${song.ccli}`
  // Without the brackets of "Thanksgiving (What Shall We Do)": SongSelect finds either title
  const title = song.title
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return `${ORIGIN}/search/results?search=${encodeURIComponent(title || song.title)}`
}
