/**
 * A song's metadata other than its chart (which variant it is, what that is called, who imported
 * it and when, its source): what Drive keeps on the file as properties, and how a pull takes a
 * change another device made to it, which does not change the file's checksum so is not seen as
 * a change to the file.
 *
 * Each song keeps what these were when last synced (`syncedMetadata`), so a field can be told
 * apart as changed here (it differs from that), in Drive (Drive's differs from that), or both.
 */

import type { SongRecord } from '../data-types.ts'
import { songFileMetadata } from '../drive-metadata.ts'
import { songSource } from '../song-source.ts'

const FIELDS = [
  'songId',
  'variantOf',
  'isDefault',
  'variantLabel',
  'importDate',
  'importUser',
  'importSource',
] as const

/** The synced fields as Drive's properties say them: all strings */
export type SyncedMetadata = Record<(typeof FIELDS)[number], string>

/** What this song's file would say, as the sync writes it */
export function metadataOfSong(song: SongRecord): SyncedMetadata {
  const written = songFileMetadata(song, null, { spaceId: '' }).appProperties
  return Object.fromEntries(FIELDS.map(field => [field, written[field] ?? ''])) as SyncedMetadata
}

/** What a file's properties say, in the same form */
export function metadataOfProps(props: Record<string, string>): SyncedMetadata {
  return {
    songId: props.songId ?? '',
    variantOf: props.variantOf ?? '',
    isDefault: props.isDefault === 'true' ? 'true' : 'false',
    variantLabel: props.variantLabel ?? '',
    importDate: props.importDate ?? '',
    importUser: props.importUser ?? '',
    importSource: songSource(props.importSource),
  }
}

/** The song's fields that a synced field is, for the ones taken from Drive */
function recordFields(taken: Partial<SyncedMetadata>): Partial<SongRecord> {
  const fields: Partial<SongRecord> = {}
  if (taken.songId !== undefined) {
    fields.id = taken.songId
    if (taken.songId.startsWith('ccli-')) fields.ccliNumber = taken.songId.slice('ccli-'.length)
  }
  if (taken.variantOf !== undefined) fields.variantOf = taken.variantOf || null
  if (taken.isDefault !== undefined) fields.isDefault = taken.isDefault === 'true'
  if (taken.variantLabel !== undefined) fields.variantLabel = taken.variantLabel
  if (taken.importDate !== undefined) fields.importDate = taken.importDate
  if (taken.importUser !== undefined) fields.importUser = taken.importUser || null
  if (taken.importSource !== undefined) fields.importSource = taken.importSource
  return fields
}

/**
 * What a pull is to change in a song whose file has not changed, from the file's properties as
 * Drive has them now: each field Drive changed since the last sync, that is not also changed here.
 * (A field changed both here and in Drive is left: the change here is sent, and wins.) With no
 * record of the last sync (a song synced before it was kept), only an empty field is filled.
 * @returns what to change in the song, or null when nothing is to be
 */
export function remoteMetadataChanges(
  song: SongRecord,
  props: Record<string, string>
): Partial<SongRecord> | null {
  const here = metadataOfSong(song)
  const remote = metadataOfProps(props)
  const was = song.syncedMetadata
  const taken: Partial<SyncedMetadata> = {}
  for (const field of FIELDS) {
    if (was) {
      if (remote[field] !== was[field] && here[field] === was[field]) taken[field] = remote[field]
    } else if (here[field] === '' && remote[field] !== '') {
      taken[field] = remote[field]
    }
  }
  const after = { ...here, ...taken }
  const agrees = FIELDS.every(field => after[field] === remote[field])
  // What is remembered as synced: all of Drive's once the song and Drive are the same; else what
  // was, with the fields just taken
  const synced = agrees ? remote : was ? { ...was, ...taken } : null
  const remembersMore = synced && (!was || FIELDS.some(field => synced[field] !== was[field]))
  if (!Object.keys(taken).length && !remembersMore) return null
  return { ...recordFields(taken), ...(synced ? { syncedMetadata: synced } : {}) }
}
