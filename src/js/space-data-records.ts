/** The shared metadata sent to D1. Projections are explicit: chart text and device state never travel. */
import type { Person, Setlist, SetlistEntry, SongIndexRecord } from './data-types.ts'
import type {
  SpacePadSet,
  SpacePerson,
  SpaceRecordKind,
  SpaceSetlist,
  SpaceSong,
} from './space-data-types.ts'
import { withLocalSongs } from './sync/setlist-hash.ts'

export type SpaceRecord = SpaceSong | SpaceSetlist | SpacePerson | SpacePadSet
export const SPACE_STORES = {
  song: 'song_index',
  setlist: 'setlists',
  person: 'people',
  'pad-set': 'pad_sets',
} as const
export const recordId = (kind: SpaceRecordKind, record: SpaceRecord): string =>
  (record as unknown as Record<string, unknown>)[
    { song: 'songUuid', setlist: 'setlistId', person: 'personId', 'pad-set': 'padSetId' }[kind]
  ] as string

export function sharedRecord(kind: SpaceRecordKind, value: unknown): SpaceRecord | null {
  if (!value) return null
  if (kind === 'song') {
    const song = value as SongIndexRecord
    return {
      songUuid: song.songUuid,
      songId: song.songId,
      title: song.title,
      ccli: song.ccli,
      key: song.key,
      licence: song.licence,
      isDefault: song.isDefault,
      variantOf: song.variantOf,
      variantLabel: song.variantLabel,
      contentHash: song.contentHash,
      fileRef: song.fileRef,
      version: song.version ?? 0,
      modifiedAt: song.modifiedAt,
    }
  }
  if (kind === 'setlist') {
    const setlist = value as Setlist
    if (setlist.deletedAt) return null
    const {
      owner: _owner,
      ownerId: _ownerId,
      share: _share,
      ...unknownBody
    } = setlist.spaceDataBody ?? {}
    return {
      setlistId: setlist.id,
      date: setlist.date,
      time: setlist.time,
      type: setlist.type,
      name: setlist.name,
      leaderId: setlist.leaderId || null,
      leaderName: setlist.leaderName ?? null,
      createdBy: setlist.createdBy ?? null,
      createdAt: setlist.createdDate,
      body: {
        ...unknownBody,
        ...(setlist.owner !== undefined ? { owner: setlist.owner } : {}),
        ...(setlist.ownerId !== undefined ? { ownerId: setlist.ownerId } : {}),
        ...(setlist.share !== undefined ? { share: setlist.share } : {}),
      },
      songs: setlist.songs
        .filter(entry => !entry.local)
        .map(entry => ({
          songUuid: entry.songUuid || entry.songId,
          songId: entry.songId,
          title: entry.title ?? entry.songId,
          ccli: entry.ccli ?? null,
          key: entry.key,
          tempo: entry.tempo,
          notes: entry.notes,
          annotations: entry.annotations ?? [],
          extra: entry.spaceDataExtra ?? {},
        })),
      version: setlist.version ?? 0,
      modifiedAt: setlist.modifiedDate,
    }
  }
  if (kind === 'person') {
    const person = value as Person
    if (person.deleted) return null
    return {
      personId: person.id,
      name: person.name,
      leaderEligible: person.leaderEligible,
      emails: person.emails,
      teamMember: person.teamMember ?? null,
      mergedInto: person.mergedInto ?? null,
      version: person.version ?? 0,
      modifiedAt: person.modifiedDate,
    }
  }
  const pad = value as SpacePadSet
  return {
    padSetId: pad.padSetId,
    name: pad.name,
    version: pad.version,
    modifiedAt: pad.modifiedAt,
  }
}

/** Put server fields on a local record, retaining Drive links and songs added only for this person. */
export function localRecord(
  kind: SpaceRecordKind,
  record: SpaceRecord,
  previous?: unknown
): unknown {
  if (kind === 'setlist') {
    const setlist = record as SpaceSetlist
    const old = previous as Setlist | undefined
    const songs = setlist.songs.map(
      (song, order): SetlistEntry => ({
        songUuid: song.songUuid,
        songId: song.songId,
        title: song.title,
        ccli: song.ccli,
        key: song.key,
        tempo: song.tempo,
        notes: song.notes,
        spaceDataExtra: song.extra,
        annotations:
          song.annotations.length > 0 ||
          old?.songs.find(entry => !entry.local && entry.songId === song.songId)?.annotations !==
            undefined
            ? (song.annotations as SetlistEntry['annotations'])
            : undefined,
        order,
      })
    )
    return {
      ...old,
      spaceDataBody: setlist.body,
      id: setlist.setlistId,
      date: setlist.date,
      time: setlist.time,
      type: setlist.type,
      name: setlist.name,
      leaderId: setlist.leaderId,
      leaderName: setlist.leaderName ?? null,
      createdBy: setlist.createdBy ?? undefined,
      createdDate: setlist.createdAt,
      modifiedDate: setlist.modifiedAt,
      version: setlist.version,
      songs: withLocalSongs(songs, old?.songs),
      deletedAt: null,
      share: (setlist.body.share as Setlist['share']) ?? null,
      owner: typeof setlist.body.owner === 'string' ? setlist.body.owner : undefined,
      ownerId: typeof setlist.body.ownerId === 'string' ? setlist.body.ownerId : undefined,
    }
  }
  if (kind === 'person') {
    const person = record as SpacePerson
    return {
      ...(previous as Person),
      id: person.personId,
      name: person.name,
      leaderEligible: person.leaderEligible,
      emails: person.emails,
      teamMember: person.teamMember ?? undefined,
      mergedInto: person.mergedInto ?? undefined,
      modifiedDate: person.modifiedAt,
      version: person.version,
      deleted: false,
    }
  }
  return { ...record }
}

/** Ignore transport bookkeeping when deciding whether an edit changed shared content. */
export function sameContent(a: unknown, b: unknown): boolean {
  const clean = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(clean)
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value)
          .filter(
            ([key, value]) => key !== 'version' && key !== 'modifiedAt' && value !== undefined
          )
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, value]) => [key, clean(value)])
      )
    return value
  }
  return JSON.stringify(clean(a)) === JSON.stringify(clean(b))
}
