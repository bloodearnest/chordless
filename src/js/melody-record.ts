/**
 * Making a song's melody record (docs/MELODY.md): the parsed melody, the key it is in, and the hash
 * of the MusicXML it is written as, which is how the sync tells that it changed here.
 */
import type { MelodyRecord } from './data-types.ts'
import type { Melody } from './melody.ts'
import { writeMusicXml } from './melody-musicxml.ts'
import { hashText } from './utils/hash.ts'

/** A record for the song `uuid` (a new one, or the one of `previous` changed): not yet in Drive until it is synced */
export function melodyRecord(
  uuid: string,
  melody: Melody,
  key: string | null,
  previous?: MelodyRecord
): MelodyRecord {
  const now = new Date().toISOString()
  return {
    ...previous,
    uuid,
    melody,
    key,
    createdDate: previous?.createdDate ?? now,
    modifiedDate: now,
    contentHash: hashText(writeMusicXml(melody)),
  }
}
