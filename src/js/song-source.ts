/**
 * Where a song came from (`importSource`) is its origin: SongSelect, a file, something typed or
 * pasted. How it reached this device is not an origin, and is never kept as one: Google Drive
 * (a sync), a copy between spaces, an import from a zip file. A song keeps the origin it had,
 * whatever carried it, and where that is not known the origin is empty.
 */

/** The source of a chart that came from SongSelect, which is the authority on the details of its song */
export const SONGSELECT = 'songselect'

/** Ways a song gets from one place to another, which some code once recorded as its source */
const WAYS_OF_ARRIVING = new Set(['drive', 'copy', 'import'])

/** The origin to keep for a song whose source is recorded as this: empty where it only says how it arrived */
export function songSource(recorded: string | null | undefined): string {
  return recorded && !WAYS_OF_ARRIVING.has(recorded) ? recorded : ''
}

/** What is known of who made a song and when, to say beside it: "Imported by Jo, 3/10/2026, SongSelect" */
export function describeOrigin(song: {
  importUser?: string | null
  importDate?: string
  importSource?: string | null
}): string {
  const source = song.importSource === 'songselect' ? 'SongSelect' : song.importSource
  const date = song.importDate ? new Date(song.importDate).toLocaleDateString() : ''
  return [
    song.importUser ? `Imported by ${song.importUser}` : 'Importer unknown',
    date,
    source && !['file', 'paste', 'manual'].includes(source) ? source : '',
  ]
    .filter(Boolean)
    .join(', ')
}
