/**
 * What the Worker holds for a space and answers with (docs/D1_PHASE1_PLAN.md, "Space data and its sync";
 * migrations/0012_space_data.sql): its songs (the index only: who they are, never what they say), setlists with
 * their songs, people and pad sets. The device and the Worker both use these, so the wire is one definition.
 *
 * The device's own records (`data-types.ts`) are not these: a device keeps what it needs to sync with Drive as well,
 * and a deleted record is a flag there. Here a record that is gone is simply not in the answer.
 */

/** A song of a space, without its chart: the chart stays on the devices and in the space's Drive */
export interface SpaceSong {
  songUuid: string
  /** `ccli-<number>`, or `title-<normalised title>` (the record's deterministic id) */
  songId: string
  title: string
  ccli: string | null
  key: string | null
  /** The CCLI licence number the chart came in under (docs/CCLI.md) */
  licence: string | null
  isDefault: boolean
  variantOf: string | null
  variantLabel: string
  contentHash: string | null
  /** The Drive file that holds the chart, where there is one */
  fileRef: string | null
  version: number
  modifiedAt: string
}

/** A song in a setlist: its title and CCLI number are copied from the song, so the setlist reads without it */
export interface SpaceSetlistSong {
  songUuid: string
  songId: string
  title: string
  ccli: string | null
  key: string | null
  tempo: number | null
  notes: string
  annotations: unknown[]
  /** The rest of the entry, kept as it came */
  extra: Record<string, unknown>
}

export interface SpaceSetlist {
  setlistId: string
  /** YYYY-MM-DD */
  date: string
  time: string
  type: string
  name: string
  leaderId: string | null
  createdBy: string | null
  createdAt: string
  /** The rest of the record (what is shared by link, and so on), kept as it came */
  body: Record<string, unknown>
  songs: SpaceSetlistSong[]
  version: number
  modifiedAt: string
}

export interface SpacePerson {
  personId: string
  name: string
  /** Lower-case addresses the person writes from */
  emails: string[]
  /** Who they are in the team (`provider:sub`), where it is known */
  teamMember: string | null
  /** Set when the person was merged into another: the record stays, so an id not yet replaced still resolves */
  mergedInto: string | null
  version: number
  modifiedAt: string
}

export interface SpacePadSet {
  padSetId: string
  name: string
  version: number
  modifiedAt: string
}

/** Everything a space holds, or the part of it a device asked for */
export interface SpaceData {
  songs: SpaceSong[]
  setlists: SpaceSetlist[]
  people: SpacePerson[]
  padSets: SpacePadSet[]
  /**
   * The setlists answered are those dated from this day on (a year back, by default); null for every one.
   * A first sync asks for everything.
   */
  from: string | null
}

/** The kinds of record, as a route and a batch name them */
export type SpaceRecordKind = 'song' | 'setlist' | 'person' | 'pad-set'

/** One change of a batch */
export interface SpaceOp {
  kind: SpaceRecordKind
  op: 'put' | 'delete'
  id: string
  /** The version the change was made from: null to make a record, absent to delete whatever is there */
  baseVersion?: number | null
  /** What to write, for a put */
  record?: unknown
}

/** What became of one change */
export type SpaceOpResult =
  | { status: 'ok'; version: number }
  /** The record is not as the change was made from: `current` is what it is now (null if the id is another space's) */
  | { status: 'conflict'; current: unknown }
  /** The change was made from a version of a record that is no longer there */
  | { status: 'missing' }
  | { status: 'forbidden'; error: string }
  | { status: 'invalid'; error: string }
