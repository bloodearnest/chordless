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
  /** Text after the label's directive on the same line: `{comment: Chorus} (first time a cappella)` */
  note?: string
  lines: ChartLine[]
}

/**
 * The {directive: value} lines of a chart, and the CCLI trailer. A tempo is the chart's text,
 * or a number once a setlist has put its own tempo there (see buildRuntimeSongs).
 */
export interface ChartMetadata {
  title?: string
  artist?: string
  author?: string
  key?: string
  tempo?: string | number
  time?: string
  copyright?: string
  ccli?: string
  ccliSongNumber?: string
  ccliTrailer?: string
  [directive: string]: string | number | undefined
}

export interface ParsedChart {
  metadata: ChartMetadata
  sections: ChartSection[]
}

// ==================== How a section is shown ====================

/**
 * What a section hides: nothing, its chords (lyrics only) or its lyrics (chords only); or the
 * whole section is collapsed or hidden
 */
export type HideMode = 'none' | 'chords' | 'lyrics' | 'collapse' | 'hide'

export interface SectionState {
  hideMode: HideMode
  isCollapsed: boolean
  isHidden: boolean
}

// ==================== Stored records ====================

/** A tempo as an import, Drive or an older record may give it: a number of BPM, or a chart's text */
export type TempoInput = number | string | null | undefined

/** What a device records about a song's synced Drive file */
export interface SongDriveProperties {
  songId: string
  songUuid: string
  contentHash: string
  ccliNumber: string
  title: string
  titleNormalized: string
  variantLabel: string
  appVersion?: string
}

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
  importUser: string | null
  importSource: string
  sourceUrl: string | null
  modifiedDate: string

  driveFileId: string | null
  driveModifiedTime: string | null
  driveChecksum?: string | null
  lastSyncedAt: string | null
  /** Hash of the chart as last synced: a change since is a local change */
  syncedContentHash?: string | null
  /** What this device recorded about the synced file */
  driveProperties?: SongDriveProperties | null
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
  /** When it was last edited: a time in ms (from sync) or an ISO string */
  lastModified?: number | string
}

/** A song in a setlist: a reference, with this setlist's key and tempo for it */
export interface SetlistEntry {
  order: number
  songId: string
  songUuid: string
  key: string | null
  tempo: number | null
  notes: string
  /** This setlist's own edited ChordPro text for the song, if it has one */
  chordproEdits?: string
}

/**
 * A setlist's share link (docs/SHARING.md). Lives in the setlist's own file, which only the
 * organisation can read: the key is what makes the public share file readable.
 */
export interface SetlistShare {
  /** The public, encrypted file in the organisation's shares/ folder */
  fileId: string
  /** The AES key, base64url (43 characters); only ever in the link's # and here */
  key: string
  /** YYYY-MM-DD the share was first made, which can push `expires` out for a late share */
  created: string
  /** YYYY-MM-DD after which the share is revoked and recipients delete their copy */
  expires: string
  /** Hash of the bundle last uploaded: a different one means the share needs updating */
  bundleHash: string
}

/** What a device keeps about a share link it opened, with the setlist it received */
export interface ReceivedShare {
  fileId: string
  /** From the link's #: kept so the link works again without it */
  key: string
  /** The worker's ETag for the file last downloaded, to ask whether it changed */
  etag: string
  /** YYYY-MM-DD */
  expires: string
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
  /** Set while the setlist is shared by link */
  share?: SetlistShare | null
  /** Only on the copy of a setlist received by link (see share-receiver.ts) */
  received?: ReceivedShare
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

/**
 * A song as getSongWithContent gives it: the stored record's identity and import details,
 * what its chart says, and the chart's text and parsed form.
 */
export interface SongWithContent {
  uuid: string
  id: string
  variantOf: string | null
  isDefault: boolean
  variantLabel: string
  ccliNumber: string | null
  titleNormalized: string
  importDate: string
  importUser: string | null
  importSource: string
  modifiedDate: string
  title: string
  artist: string | null | undefined
  author: string | null
  /** The record's key and tempo: what the library saved, and what the song was imported with */
  key: string | null
  originalKey: string | null
  tempo: number | null
  originalTempo: number | null
  /** For the UI: what the chart says, else what the record says */
  metadata: {
    key: string | null | undefined
    tempo: string | number | null
    timeSignature: string | null
    tempoNote?: string
    /** The chart's {copyright}, else the record's */
    copyright?: string
    /** From the chart's CCLI lines: the {ccli} directive, and the CCLI Song # trailer */
    ccli?: string
    ccliSongNumber?: string
    ccliTrailer?: string
  }
  chordpro: string
  chordproFileId: string
  parsed: ParsedChart
  /** Set by getLibrarySongs when asked: the last setlist the song was played in */
  lastUsageInfo?: { date: string; leader: string; key: string | null }
}

// ==================== Google Drive ====================

/** A Drive file or folder, with the fields Chordless asks for */
export interface DriveFile {
  id: string
  name?: string
  mimeType?: string
  modifiedTime?: string
  createdTime?: string
  md5Checksum?: string
  parents?: string[]
  trashed?: boolean
  appProperties?: Record<string, string>
}

/** One page of a Drive file listing */
export interface DriveFileList {
  files?: DriveFile[]
  nextPageToken?: string
}

/** What a file is created or updated with (a null appProperty removes that key) */
export interface DriveFileWrite {
  name?: string
  mimeType?: string
  description?: string
  parents?: string[]
  appProperties?: Record<string, string | null>
}

export type DriveContent = string | Blob | ArrayBuffer | Uint8Array
