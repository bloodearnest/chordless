/**
 * The sample setlist: a few public-domain hymns, with chords written for Chordless, that the
 * welcome card offers a new user to try. The charts are static files (public/samples/) fetched
 * when asked for, so nothing is loaded up front.
 */
import type { SetlistEntry } from './data-types.ts'
import { createSetlist, getCurrentDB } from './db.ts'
import { createSong, findExistingSong } from './song-utils.ts'

/** What public/samples/index.json holds */
interface SampleIndex {
  setlistName: string
  /** File names in public/samples/, in setlist order */
  songs: string[]
}

/** The import source recorded on a sample song, to tell it from the user's own */
export const SAMPLE_SOURCE = 'sample'

async function fetchText(path: string): Promise<string> {
  const response = await fetch(path)
  if (!response.ok) throw new Error(`Could not load ${path} (${response.status})`)
  return response.text()
}

/** The {title: ...} of a chart */
function titleOf(chart: string): string | null {
  return chart.match(/^\{title:\s*(.+?)\s*\}/m)?.[1] ?? null
}

/**
 * Add the sample songs (those the library does not have already) and a setlist of them for
 * next Sunday.
 * @returns the new setlist's id
 */
export async function addSampleSetlist(): Promise<string> {
  const index: SampleIndex = JSON.parse(await fetchText('/samples/index.json'))
  const db = await getCurrentDB()

  const entries: SetlistEntry[] = []
  for (const file of index.songs) {
    const chart = await fetchText(`/samples/${file}`)
    const title = titleOf(chart)
    const song =
      (await findExistingSong(null, title, db)) ??
      (await createSong(chart, { importSource: SAMPLE_SOURCE }))
    entries.push({
      order: entries.length,
      songId: song.id,
      songUuid: song.uuid,
      key: song.key ?? null,
      tempo: typeof song.tempo === 'number' ? song.tempo : null,
      notes: '',
    })
  }

  const setlist = { ...createSetlist({ name: index.setlistName }), songs: entries }
  await db.saveSetlist(setlist)
  return setlist.id
}
