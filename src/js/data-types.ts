/**
 * The shapes of the data Chordless parses and stores. docs/DATA_MODEL.md describes them in
 * prose; these are what the code checks against. Types only: nothing here exists at runtime.
 */

// ==================== A parsed chart (ChordProParser) ====================

/** The lyrics under (or after) one chord */
export interface ChartSegment {
  chord: string
  lyrics: string
  /** Set by transposeSong */
  transposed?: boolean
  valid?: boolean
}

export interface ChartLine {
  segments: ChartSegment[]
}

export interface ChartSection {
  type: 'section'
  label: string | null
  lines: ChartLine[]
}

/** The {directive: value} lines of a chart, and the CCLI trailer */
export interface ChartMetadata {
  title?: string
  artist?: string
  author?: string
  key?: string
  tempo?: string
  time?: string
  copyright?: string
  ccli?: string
  ccliSongNumber?: string
  ccliTrailer?: string
  [directive: string]: string | undefined
}

export interface ParsedChart {
  metadata: ChartMetadata
  sections: ChartSection[]
}

// ==================== How a section is shown ====================

/** What a section hides: nothing, its chords (lyrics only) or its lyrics (chords only) */
export type HideMode = 'none' | 'chords' | 'lyrics'

export interface SectionState {
  hideMode: HideMode
  isCollapsed: boolean
  isHidden: boolean
}

// ==================== Stored records ====================

/** A tempo as an import, Drive or an older record may give it: a number of BPM, or a chart's text */
export type TempoInput = number | string | null | undefined

/** A song variant: the 'songs' store (metadata only; the chart is in the chordpro store) */
export interface SongRecord {
  uuid: string
  /** The deterministic id: ccli-<number>, or title-<normalised title> */
  id: string
  variantOf: string | null
  isDefault: boolean
  variantLabel: string
  chordproFileId: string

  ccliNumber: string | null
  title: string
  titleNormalized: string
  author: string | null
  copyright: string | null
  key: string | null
  originalKey: string | null
  tempo: number | null
  originalTempo: number | null
  time: string | null

  importDate: string
  importUser: string
  importSource: string
  sourceUrl: string | null
  modifiedDate: string

  driveFileId: string | null
  driveModifiedTime: string | null
  lastSyncedAt: string | null
  contentHash: string
  /** Searchable lyrics; nothing sets this yet (see the TODO) */
  lyricsText?: string
}

/** A song as it is passed to be saved: tempos may still be a chart's text */
export type SongInput = Omit<SongRecord, 'tempo' | 'originalTempo'> & {
  tempo: TempoInput
  originalTempo: TempoInput
}

/** A song with its chart parsed (see getSongWithContent) */
export type LoadedSong = Pick<SongRecord, 'id' | 'uuid'> &
  Partial<SongRecord> & {
    parsed: ParsedChart
    artist?: string | null
  }

/** The 'chordpro' store: a chart's text */
export interface ChordProRecord {
  id: string
  content: string
  contentHash: string
  createdDate?: string
  modifiedDate?: string
  lastModified?: string
}

/** A song in a setlist: a reference, with this setlist's key and tempo for it */
export interface SetlistEntry {
  order: number
  songId: string
  songUuid: string
  key: string | null
  tempo: number | null
  notes: string
}

export interface Setlist {
  id: string
  /** YYYY-MM-DD */
  date: string
  /** HH:MM */
  time: string
  type: string
  name: string
  owner: string
  /** The leader's Google account email (empty for a leader known only by name) */
  ownerId?: string
  songs: SetlistEntry[]
  createdDate: string
  modifiedDate: string

  driveFileId?: string | null
  driveModifiedTime?: string | null
  driveChecksum?: string | null
  lastSyncedAt?: string | null
  syncedContentHash?: string | null
  /** The pre-content-hash field, kept only for old records */
  _lastSyncHash?: string | null
  deletedAt?: string | null
}

/** The 'setlist_local' store: this device's state for a setlist (never synced) */
export interface SetlistLocalState {
  setlistId: string
  padsEnabled: boolean
  padSound: string | null
  clickEnabled: boolean
  sectionVisibility: Record<string, unknown>
  lastUsedDate: string
}

// ==================== Organisations ====================

/** A person the organisation's Drive folder is shared with (cached at each sync) */
export interface OrganisationMember {
  email: string
  name?: string
  role?: string
}

/** The 'organisations' store: an organisation's identity and its link to Drive */
export interface Organisation {
  id: string
  name: string
  createdDate: string
  modifiedDate: string
  driveFolderId?: string | null
  members?: OrganisationMember[]
}

/** A person who can lead setlists: id is their Google account email (empty if only a name) */
export interface Person {
  id: string
  name: string
}
