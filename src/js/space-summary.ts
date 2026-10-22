/**
 * What a space holds, for the Account and Teams page (docs/ACCOUNT.md): its songs and setlists, and
 * about how big they are. The size is an estimate: the browser reports IndexedDB's usage for the
 * whole origin only, so a space's is the text of its charts and the JSON of its setlists.
 */
import { withSource } from './other-songs.ts'
import { contentsOf } from './space-transfer.ts'

export interface SpaceSummary {
  songs: number
  setlists: number
  bytes: number
}

/** The summary of the space with this id, read from its own database */
export async function summaryOf(spaceId: string): Promise<SpaceSummary> {
  const { songs, setlists } = await withSource(spaceId, db => contentsOf(db))
  return { songs: songs.count, setlists: setlists.count, bytes: songs.bytes + setlists.bytes }
}
