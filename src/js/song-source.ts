/**
 * Where a song came from (`importSource`) is its origin: SongSelect, a file, something typed or
 * pasted. How it reached this device is not an origin, and is never kept as one: Google Drive
 * (a sync), a copy between spaces, an import from a zip file. A song keeps the origin it had,
 * whatever carried it, and where that is not known the origin is empty.
 */

/** Ways a song gets from one place to another, which some code once recorded as its source */
const WAYS_OF_ARRIVING = new Set(['drive', 'copy', 'import'])

/** The origin to keep for a song whose source is recorded as this: empty where it only says how it arrived */
export function songSource(recorded: string | null | undefined): string {
  return recorded && !WAYS_OF_ARRIVING.has(recorded) ? recorded : ''
}
