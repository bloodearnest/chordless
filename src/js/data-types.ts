/**
 * The shapes of the data Chordless parses and stores. docs/DATA_MODEL.md describes them in
 * prose; these are what the code checks against. Types only: nothing here exists at runtime.
 */
import type { TeamRole } from './team-roles.ts'

// ==================== A parsed chart (ChordProParser) ====================

/** The lyrics under (or after) one chord */
export interface ChartSegment {
  chord: string
  lyrics: string
  /** Annotations that sit at the start of this segment, put there to be drawn (never by the parser) */
  annotations?: ShownAnnotation[]
  /** Where it starts in the line's lyrics, put there to be drawn (never by the parser) */
  offset?: number
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
 * whole section is collapsed or hidden. 'melody' shows an instrumental section as a line of music in
 * place of its chords (docs/MELODY.md, "In the chart"); only a section with notes in the lead sheet has it.
 */
export type HideMode = 'none' | 'chords' | 'lyrics' | 'melody' | 'collapse' | 'hide'

export interface SectionState {
  hideMode: HideMode
  isCollapsed: boolean
  isHidden: boolean
}

// ==================== Stored records ====================

/** A tempo as an import, Drive or an older record may give it: a number of BPM, or a chart's text */
export type TempoInput = number | string | null | undefined

/** What a device records about a song's synced Drive file */
export interface SongFileProps {
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

  fileRef: string | null
  fileModified: string | null
  fileRev?: string | null
  lastSyncedAt: string | null
  /** Hash of the chart as last synced: a change since is a local change */
  syncedContentHash?: string | null
  /** What this device recorded about the synced file */
  fileProps?: SongFileProps | null
  /** The song's metadata as last synced, in Drive's form (sync/song-metadata.ts): a change since is told from one in Drive */
  syncedMetadata?: Record<string, string> | null
  /**
   * When something about the song other than its chart changed (its source, say), for sync to send:
   * a change since the last sync is a local change. Not kept from Drive.
   */
  metadataChangedAt?: string | null
  contentHash: string
}

/** A file in Drive that this device has deleted the record of, to be put in the Drive trash at the next sync */
export interface PendingDeletion {
  /** The file's ref (a Drive file id) */
  ref: string
  kind: 'song' | 'setlist' | 'score'
  deletedAt: string
}

/**
 * The melody of a song (docs/MELODY.md): the notes of its lead sheet, kept beside its chart. One a
 * song (a variant has its own), keyed by the song's uuid. In Drive it is a MusicXML file in the
 * space's `songs` folder, linked to the chart by its properties (an `.mxl`: the same MusicXML,
 * zipped); here it is the MusicXML text, parsed when it is wanted (`readMusicXml`), as that is a few
 * milliseconds and a stored parse would go stale as the reader improves.
 */
export interface ScoreRecord {
  /** The uuid of the song it belongs to */
  uuid: string
  /** The MusicXML score */
  xml: string
  /** The key the melody is written in, as the chart names it (the sheet has a key signature, not a name) */
  key: string | null
  createdDate: string
  modifiedDate: string
  /** Hash of `xml`: it differs from `syncedContentHash` when it changed here */
  contentHash: string
  /** What it keeps of its file, as the chart's record does (docs/SYNC_ARCHITECTURE.md) */
  fileRef?: string | null
  fileRev?: string | null
  fileModified?: string | null
  lastSyncedAt?: string | null
  syncedContentHash?: string | null
  /**
   * Its file in Drive still has the properties and name from before the rename (`type: 'melody'`,
   * `.melody.mxl`): the next sync that can write gives it the new ones, and clears this
   */
  legacyFile?: boolean
}

/** A song as it is passed to be saved: tempos may still be a chart's text */
export type SongInput = Omit<SongRecord, 'tempo' | 'originalTempo'> & {
  tempo: TempoInput
  originalTempo: TempoInput
}

/** A database a song can come from other than the space's: shared setlists, or another space */
export interface SongSource {
  dbId: string
  label: string
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

// ==================== Annotations on a chart (docs/ANNOTATIONS.md) ====================

/**
 * Where on a song an annotation sits: its structure, never a pixel and never a chord, so it survives
 * transposing, hidden chords, other screen sizes, and (found again by the text around it, see
 * annotations/anchor.ts) a chart that is edited
 */
export type AnnotationAnchor =
  | { kind: 'song' }
  /**
   * A section's title: `nth` counts the sections with the same label, from 0. `sectionHead` is the
   * section's first line of lyrics, to find it again if it is renamed or moved
   */
  | { kind: 'section'; label: string | null; nth: number; sectionHead?: string }
  /**
   * A spot in a lyric line: `offset` characters into the line's lyrics (chords left out), and the text
   * either side. So that the place can be found again after the chart is edited (it is fixed in place
   * and the fix arrives by sync, on devices that never saw the old text), it also keeps a snapshot:
   * the whole line (`lineText`), the lines just above and below it, which of several identical lines
   * it is (`occ`, from 0) and the section's first line. All of those are cut short, and optional
   * (an anchor made before they were kept has none, and gets them when it is found)
   */
  | {
      kind: 'text'
      label: string | null
      nth: number
      line: number
      offset: number
      before: string
      after: string
      lineText?: string
      prevLine?: string
      nextLine?: string
      occ?: number
      sectionHead?: string
    }

/** Typed text, or (not built yet) a drawing, which is private to one musician and never synced or shared */
export type AnnotationBody =
  | { kind: 'text'; text: string }
  | { kind: 'ink'; strokes: number[][]; w: number; h: number }

export interface ChartAnnotation {
  id: string
  anchor: AnnotationAnchor
  body: AnnotationBody
  /** The person (an id in `people`) who made a shared annotation */
  createdBy?: string
  /** ISO time of the last change */
  modified: string
}

/** An annotation as it is drawn: its text, and whether it is shared with the team (else private, drawn in pencil) */
export interface ShownAnnotation {
  id: string
  text: string
  shared: boolean
}

/** An annotation that can travel with a setlist: text only */
export type SharedChartAnnotation = ChartAnnotation & { body: { kind: 'text'; text: string } }

/** A song in a setlist: a reference, with this setlist's key and tempo for it */
export interface SetlistEntry {
  order: number
  songId: string
  songUuid: string
  key: string | null
  tempo: number | null
  notes: string
  /** Annotations on the chart that everyone with the setlist sees (docs/ANNOTATIONS.md) */
  annotations?: SharedChartAnnotation[]
  /** This setlist's own edited ChordPro text for the song, if it has one */
  chordproEdits?: string
}

/**
 * A setlist's share link (docs/SHARING.md). Lives in the setlist's own file, which only the
 * space can read: the key is what makes the public share file readable.
 */
export interface SetlistShare {
  /** The public, encrypted file in the space's shares/ folder */
  fileId: string
  /** The AES key, base64url (43 characters); only ever in the link's # and here */
  key: string
  /** YYYY-MM-DD the share was first made, which can push `expires` out for a late share */
  created: string
  /** YYYY-MM-DD after which the share is revoked and recipients delete their copy */
  expires: string
  /** Hash of the bundle last uploaded: a different one means the share needs updating */
  bundleHash: string
  /**
   * What this device proves itself to the share's live room with, to be the one that says it was
   * updated (docs/LIVE_SYNC.md). Made when the setlist is first live while shared; the room keeps
   * only its hash. Private to the space, like the key
   */
  liveSecret?: string
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
  /** The sharer's setlist id: this setlist, if the user later joins its space */
  setlistId?: string
  /** The leader's name as the sharer sent it: the receiver has no people list to find them in */
  leaderName?: string
}

export interface Setlist {
  id: string
  /** YYYY-MM-DD */
  date: string
  /** HH:MM */
  time: string
  type: string
  name: string
  /** The leader: a person of the space (docs/IDENTITIES.md); none if empty */
  leaderId?: string | null
  /** Before leaders were people: the leader's name and Google account email. Read once, by the upgrade */
  owner?: string
  ownerId?: string
  /**
   * Who made the setlist in Chordless (their Google account email), where known. It is not the
   * leader: an imported setlist's leader is the one named in the email, and this is whoever
   * imported it. Kept so that a setlist can be traced to its maker; nothing decides by it yet.
   */
  createdBy?: string
  songs: SetlistEntry[]
  /** Set while the setlist is shared by link */
  share?: SetlistShare | null
  /** Only on the copy of a setlist received by link (see share-receiver.ts) */
  received?: ReceivedShare
  createdDate: string
  modifiedDate: string

  fileRef?: string | null
  fileModified?: string | null
  fileRev?: string | null
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

// ==================== Spaces ====================

/** A person the space's Drive folder is shared with (cached at each sync) */
export interface SpaceMember {
  email: string
  name?: string
  role?: string
}

/**
 * A space that is shared as a team space, as this device knows it. The id is the one the Worker
 * issued. The owner keeps syncing straight to Drive; anyone else goes through the Worker, and
 * their `rootRef` is this id.
 */
export interface TeamLink {
  id: string
  role: TeamRole
}

/** The 'spaces' store: a space's identity and its link to Drive */
export interface Space {
  id: string
  name: string
  createdDate: string
  modifiedDate: string
  rootRef?: string | null
  /** Where sync stands in the storage's feed of changes: the next incremental sync asks from here */
  changesToken?: string | null
  /** The Google app (OAuth client id) that linked the folder: another app cannot see it (drive.file) */
  driveClientId?: string | null
  members?: SpaceMember[]
  /** When `members` was last read from storage (ISO time): an incremental sync reads it again when it is old */
  membersRefreshedAt?: string
  /** The user can only read the Drive folder: sync doesn't push, and nothing syncable is edited */
  readOnly?: boolean
  /** Set once the space is shared with a team */
  team?: TeamLink
}

/**
 * A person of a space, who can lead setlists (docs/IDENTITIES.md). Each space has its own list;
 * the same human in two spaces is two records.
 */
export interface Person {
  /** A uuid, never changed */
  id: string
  name: string
  /** Lower-cased Google accounts and other addresses the person writes from */
  emails: string[]
  /** In a team space, who they are there (`provider:sub`) */
  teamMember?: string
  /** Set when merged into another person: the record stays so an id not yet replaced still resolves */
  mergedInto?: string
  /** Set when the person was deleted: the record stays, or another device's copy would bring them back */
  deleted?: boolean
  modifiedDate: string

  /** What the person keeps of its file in the space's storage (as a setlist does) */
  fileRef?: string | null
  fileModified?: string | null
  fileRev?: string | null
  lastSyncedAt?: string | null
  syncedContentHash?: string | null
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
  /** Set when the song is from another database than the space's (see other-songs.ts) */
  source?: SongSource
  /** The space a song of the library is in, set where the device has more than one */
  spaceName?: string
  /** How many variants the song has, set by getLibrarySongs when it lists every variant */
  variantCount?: number
  /** Set by getLibrarySongs when asked: the last setlist the song was played in */
  lastUsageInfo?: { date: string; leader: string; key: string | null }
  /** For a version that has not been played, when another version of its song has */
  playedInOtherVersion?: boolean
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
  /** Bytes, as a string (only a file with content has one) */
  size?: string
  parents?: string[]
  trashed?: boolean
  appProperties?: Record<string, string>
  /** The shared drive it is in, if it is in one (a request for `driveId`) */
  driveId?: string
  /** What the user may do with it (a request for `capabilities`) */
  capabilities?: { canEdit?: boolean; canAddChildren?: boolean; canTrash?: boolean }
}

/** One entry of Drive's feed of changes: a file that changed, or one that is gone for good */
export interface DriveChange {
  fileId: string
  /** The file was deleted for good (or lost to this person): there is no `file` */
  removed?: boolean
  file?: DriveFile
}

/** One page of a Drive file listing */
export interface DriveFileList {
  /** (Drive lists the files of a page, none if there are none) */
  files: DriveFile[]
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
