/**
 * The storage API: what the sync engine needs of wherever a space's files are kept.
 *
 * Google Drive is the first backend (`drive-storage.ts`); the Worker broker will serve the same
 * calls to team-space members, and a test fake implements them in memory. Nothing here is
 * Drive-shaped: a file is known by an opaque `ref` the backend chose, and is told apart by its
 * `props`, so another backend can keep them as it can. See docs/STORAGE_API.md.
 */
import type { SpaceMember } from '../data-types.ts'

/** The folders of a space that sync keeps files in */
export type Collection = 'songs' | 'setlists'

/** A file as the backend lists it */
export interface StoredFile {
  /** What the backend calls the file; opaque, and kept for the file's life (a Drive file id) */
  ref: string
  name: string
  /** Small string properties that identify the file (the setlist id, a song's variant links) */
  props: Record<string, string>
  /**
   * Changes whenever the content does, and only then (Drive's md5Checksum). Records keep the one
   * they last synced, so a different one means the file changed elsewhere. Null if unknown.
   */
  rev: string | null
  /** ISO time of the last change to the content, by the backend's clock */
  modified: string | null
  created: string | null
}

/** What a file is written with. A null prop removes that key; the other props are kept. */
export interface FileInput {
  name: string
  props: Record<string, string | null>
  /** What kind of file it is (`text/plain`, `application/json`): listings can tell files apart by it */
  type: string
}

export type FileBody = string | Blob | ArrayBuffer | Uint8Array

/** What a write answers with */
export interface WriteResult {
  file: StoredFile
  /**
   * Whether the backend stored exactly what was sent. When it did not (it reports another
   * content), the sync keeps the record as changed, so the next sync sends it again.
   */
  intact: boolean
}

/** The folder a space is kept in */
export interface RootInfo {
  ref: string
  name: string
  /** In the backend's bin: not gone, but not to be synced with */
  trashed: boolean
  /** Whether this person may add files; null when the backend did not say */
  canWrite: boolean | null
}

/** A file or folder that exists, wherever it is: what it is, and whether it is in the bin */
export interface FileStatus extends StoredFile {
  trashed: boolean
}

/** A space's own files, once its root is known */
export interface SpaceStorage {
  /** The people the space is shared with, for choosing leaders */
  members(): Promise<SpaceMember[]>
  /** The live files of a collection */
  list(collection: Collection): Promise<StoredFile[]>
  /** The refs of every live file in the space. Throws if it cannot be listed whole. */
  inventory(): Promise<Set<string>>
  /** A file or folder by ref, wherever it is; null if it does not exist */
  status(ref: string): Promise<FileStatus | null>
  readText(ref: string): Promise<string>
  create(collection: Collection, input: FileInput, body: FileBody): Promise<WriteResult>
  /**
   * Create several files at once. One entry per item, in order: null for a file that could not
   * be created, so a bad file does not stop the others.
   */
  createMany(
    collection: Collection,
    items: { input: FileInput; body: string }[]
  ): Promise<(WriteResult | null)[]>
  update(ref: string, input: FileInput, body: FileBody): Promise<WriteResult>
}

/** A backend: where spaces are found, made and opened */
export interface StorageBackend {
  /** Whether the person can use the backend at all (signed in, and it answers) */
  available(): Promise<boolean>
  /** The root a space was linked to, or null if it does not exist (or cannot be seen) */
  inspectRoot(ref: string): Promise<RootInfo | null>
  /** The space's root by its name, without making anything */
  findRootByName(name: string): Promise<RootInfo | null>
  /** The space's root by name, made if there is none */
  ensureRoot(name: string, spaceId: string): Promise<{ ref: string; isNew: boolean }>
  renameRoot(ref: string, name: string): Promise<void>
  space(rootRef: string): SpaceStorage
  /**
   * How many writes the backend has refused for lack of permission (not for a rate limit), since
   * it was loaded. The sync asks after a push to find out whether the person can only read.
   */
  writeRefusals(): number
}
