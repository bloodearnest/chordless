/**
 * Google Drive Sync Manager
 *
 * Handles bidirectional sync between the local IndexedDB and Google Drive: it finds the
 * space's folder, lists what is in it, and runs the pull and the push in turn.
 *
 * Sync Strategy:
 * - Track sync state in local database (lastSyncedAt, fileRef, fileModified)
 * - Pull (sync/pull.ts): download what Drive has that is new or changed
 * - Push (sync/push.ts): upload local changes that haven't been synced
 * - Conflict: If both changed, Drive wins
 * - Whether a record has changes that aren't in Drive: sync/changes.ts
 */

import type { Space, SpaceMember } from './data-types.ts'
import { ChordlessDB, getCurrentDB } from './db.ts'
import { GOOGLE_CLIENT_ID } from './google-auth.ts'
import { ChordProParser } from './parser.ts'
import { syncShares } from './share-manager.ts'
import { getCurrentSpace, getSpaceById, setSpaceReadOnly } from './space.ts'
import { SpaceDB } from './space-db.ts'
import { driveStorage } from './storage/browser-drive.ts'
import { storageFor } from './storage/space-storage.ts'
import type { RootInfo, SpaceStorage, StorageBackend } from './storage/types.ts'
import { setlistHasLocalChanges, songHasLocalChanges, songUuidOf } from './sync/changes.ts'
import { pullPeople, pullSetlists, pullSongs } from './sync/pull.ts'
import { pushPeople, pushSetlists, pushSongs } from './sync/push.ts'

export type { ProgressCallback, SyncProgress } from './sync/session.ts'

import { ChangeTokenLost } from './storage/types.ts'
import { type ProgressCallback, type SyncReport, SyncRun } from './sync/session.ts'
import { phase } from './telemetry/telemetry.ts'
import { errorMessage } from './utils/errors.ts'

/** A local setlist or song with changes that are not in Drive */
export interface UnsyncedChange {
  type: 'setlist' | 'song'
  id: string
  label: string
}

/** Where the link to the space's Drive folder is kept */
export interface FolderLink {
  get(): Promise<string | null>
  set(rootRef: string): Promise<void>
  /** Let go of the folder, so the next sync finds or makes one by name */
  clear(): Promise<void>
}

/** Where sync's place in the storage's feed of changes is kept (the space's record) */
export interface ChangeTokenStore {
  get(): Promise<string | null>
  set(token: string): Promise<void>
  clear(): Promise<void>
}

/** How old the cached members may be before an incremental sync reads them again */
/** How long a check of the user's access to the space's folder stands, for the syncs from the feed (a refused write asks again) */
export const ACCESS_REFRESH_MS = 5 * 60_000
export const MEMBERS_REFRESH_MS = 60 * 60_000

/** Where the space's members are cached for offline use */
export interface MemberCache {
  set(members: SpaceMember[]): Promise<void>
  /** When the members were last cached (ISO time), or null if never; without it they are not read again by an incremental sync */
  refreshedAt?(): Promise<string | null>
  /** Record whether the user can only read the folder (so the app stops offering edits) */
  setReadOnly?(readOnly: boolean): Promise<void>
}

/** What a manager is opened with (SyncManager.open), where it is not the defaults: tests give their own */
export interface SyncManagerOptions {
  /** Database to sync. Defaults to the database of the space with this id, or of the one in use. */
  db?: ChordlessDB | null
  /** Where the link to the space's folder is kept. Defaults to its record in the spaces database. */
  folderLink?: FolderLink | null
  /** Where the folder's members are cached. Defaults to the space's record. */
  memberCache?: MemberCache | null
  /** Where the place in the feed of changes is kept. Defaults to the space's record. */
  changeToken?: ChangeTokenStore | null
  /** Where the space's files are kept. Defaults to Google Drive. Tests pass a fake. */
  storage?: StorageBackend | null
}

/**
 * Thrown by resetLocalFromDrive when local records have changes not in Drive.
 */
export class UnsyncedChangesError extends Error {
  unsynced: UnsyncedChange[]

  constructor(unsynced: UnsyncedChange[]) {
    const shown = unsynced.slice(0, 5).map(u => `${u.type} ${u.label || u.id}`)
    const more = unsynced.length > 5 ? ` and ${unsynced.length - 5} more` : ''
    super(
      `${unsynced.length} local change(s) aren't in Drive yet, so nothing was reset: ${shown.join(', ')}${more}`
    )
    this.name = 'UnsyncedChangesError'
    this.unsynced = unsynced
  }
}

/**
 * What to tell the user when the space's linked Drive folder is not there: `folder` is the folder
 * in the Drive trash, or null when Drive cannot find it. `otherApp` is known when the folder was
 * linked by another Google app, which cannot see it (the Drive scope covers only the files an app
 * made itself).
 */
export function folderGoneMessage(folder: { name?: string } | null, otherApp: boolean): string {
  const safe = 'Your songs and setlists are safe on this device.'
  if (folder) {
    return (
      `This space's Google Drive folder "${folder.name}" is in the Drive trash. ` +
      `${safe} Restore it from the trash, or start over in Drive to upload them to a new folder.`
    )
  }
  return otherApp
    ? `This space was synced by an earlier version of Chordless's Google app, which cannot see its Drive folder. ${safe} Start over in Drive to upload them again.`
    : `This space's Google Drive folder can't be found: it was deleted, or belongs to another Google account than the one you are signed in with. ${safe} Sign in with the right account, or start over in Drive to upload them again.`
}

/**
 * Thrown when the Drive folder this space was linked to is gone (deleted, or not visible to this
 * Google account or app) or in the trash. Nothing was changed; startOver() is the way on.
 */
export class DriveFolderGoneError extends Error {
  reason: 'missing' | 'trashed'

  constructor(folder: Pick<RootInfo, 'name'> | null) {
    super(folderGoneMessage(folder, false))
    this.name = 'DriveFolderGoneError'
    this.reason = folder ? 'trashed' : 'missing'
  }
}

/**
 * Thrown when local records belong to a different Drive folder than the one this
 * space now syncs with (e.g. it was renamed before folders were linked).
 * Syncing would re-upload them all as duplicates, so sync stops instead.
 */
export class SpaceFolderMismatchError extends Error {
  count: number

  constructor(count: number, folderName: string) {
    super(
      `${count} setlist(s)/song(s) on this device are stored in a different Google Drive ` +
        `folder than "${folderName}", the one this space now syncs with. ` +
        `Nothing was synced, to avoid uploading them again as duplicates.`
    )
    this.name = 'SpaceFolderMismatchError'
    this.count = count
  }
}

/** "1 song", "3 songs" */
const counted = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`

/** A space's record in the spaces database */
function spaceRecord(spaceId: string) {
  // (kept once it has opened: one that failed to is tried again next time)
  let spaces: SpaceDB | null = null
  const db = async (): Promise<SpaceDB> => {
    if (!spaces) {
      const opening = new SpaceDB()
      await opening.init()
      spaces = opening
    }
    return spaces
  }
  return {
    get: async () => (await db()).getSpace(spaceId),
    update: async (changes: Partial<Space>) => (await db()).updateSpace(spaceId, changes),
  }
}

/**
 * Where a space's link to its Drive folder is stored: its record in the
 * spaces database. Tests pass their own { get, set }.
 */
function spaceFolderLink(record: ReturnType<typeof spaceRecord>): FolderLink {
  return {
    async get() {
      return (await record.get())?.rootRef ?? null
    },
    async set(rootRef: string) {
      try {
        await record.update({ rootRef, driveClientId: GOOGLE_CLIENT_ID })
      } catch (error) {
        console.warn('[DriveSync] Could not record Drive folder link:', error)
      }
    },
    async clear() {
      await record.update({ rootRef: null, driveClientId: null })
    },
  }
}

/** Where a space keeps its place in the feed of changes: its record in the spaces database */
function spaceChangeToken(record: ReturnType<typeof spaceRecord>): ChangeTokenStore {
  // (not essential: without a place kept, the next sync is a full one)
  const update = async (changesToken: string | null) => {
    try {
      await record.update({ changesToken })
    } catch (error) {
      console.warn('[DriveSync] Could not record the place in the feed of changes:', error)
    }
  }
  return {
    get: async () => (await record.get())?.changesToken ?? null,
    set: token => update(token),
    clear: () => update(null),
  }
}

/**
 * Where the space's members (people its Drive folder is shared with) are
 * cached for offline use: its record in the spaces database, as
 * `members`. Tests pass their own { set }.
 */
function spaceMemberCache(spaceId: string, record: ReturnType<typeof spaceRecord>): MemberCache {
  return {
    async set(members: SpaceMember[]) {
      await record.update({ members, membersRefreshedAt: new Date().toISOString() })
    },
    refreshedAt: async () => (await record.get())?.membersRefreshedAt ?? null,
    setReadOnly: readOnly => setSpaceReadOnly(spaceId, readOnly),
  }
}

/**
 * Sync Manager for a specific space
 */
export class SyncManager {
  readonly spaceName: string
  readonly spaceId: string
  readonly db: ChordlessDB
  readonly folderLink: FolderLink
  readonly memberCache: MemberCache
  readonly changeToken: ChangeTokenStore
  /** The space's folder, once init() has found it */
  rootRef: string | null = null
  readonly parser = new ChordProParser()
  /** The storage backend (Google Drive unless a test says otherwise) */
  readonly storage: StorageBackend
  /** The space's files, opened once the folder is known and dropped when a run ends */
  #space: SpaceStorage | null = null
  /** What the last check of the user's access to the folder said, and when (see refreshAccess) */
  #access: { readOnly: boolean; at: number } | null = null

  /**
   * Open the manager of a space, without asking the storage anything: its database (the one
   * given, the space with this id's, or with no id the one in use) and where its folder link,
   * members and place in the feed are kept. init() then finds its folder.
   */
  static async open(
    spaceName: string,
    spaceId: string | null,
    options: SyncManagerOptions = {}
  ): Promise<SyncManager> {
    let { db } = options
    if (!db) {
      // The space asked for, or (with no id) the one in use. A given id must be honoured: a
      // sync of a space that is not in use (the first sync of one just made or joined, or one
      // managed from the Account and Teams page) would otherwise work on the space in use.
      // (what this sync saves is what came from storage, not a change to send)
      if (spaceId) {
        db = new ChordlessDB(spaceId, 'sync')
        await db.init()
      } else {
        db = await getCurrentDB('sync')
      }
      spaceId = db.spaceId
    }
    const id = spaceId ?? db.spaceId
    const record = spaceRecord(id)
    return new SyncManager(spaceName, {
      spaceId: id,
      db,
      folderLink: options.folderLink ?? spaceFolderLink(record),
      memberCache: options.memberCache ?? spaceMemberCache(id, record),
      changeToken: options.changeToken ?? spaceChangeToken(record),
      storage: options.storage ?? driveStorage,
    })
  }

  private constructor(
    spaceName: string,
    parts: {
      spaceId: string
      db: ChordlessDB
      folderLink: FolderLink
      memberCache: MemberCache
      changeToken: ChangeTokenStore
      storage: StorageBackend
    }
  ) {
    this.spaceName = spaceName
    this.spaceId = parts.spaceId
    this.db = parts.db
    this.folderLink = parts.folderLink
    this.memberCache = parts.memberCache
    this.changeToken = parts.changeToken
    this.storage = parts.storage
  }

  /** The space's files, once its folder is known (opened afresh for each sync) */
  get space(): SpaceStorage {
    this.#space ??= this.storage.space(this.folderId)
    return this.#space
  }

  /** The space's Drive folder, once found */
  get folderId(): string {
    if (!this.rootRef) throw new Error('The Drive folder is not known yet: call init()')
    return this.rootRef
  }

  /**
   * Find the space's folder (see resolveDriveFolder)
   * @returns whether it was newly made
   */
  init(): Promise<boolean> {
    return this.resolveDriveFolder()
  }

  /**
   * Let go of this space's Drive folder and every link to a file in it, keeping all the
   * content on this device, so the next sync finds or makes a folder by name and uploads it all
   * again. For when the folder is gone (DriveFolderGoneError): deleted, in the trash, or made
   * by another Google app, which cannot see what the first one made. Nothing in Drive is
   * touched: an old folder that can still be seen is left for the user to delete.
   */
  async startOver(): Promise<void> {
    await this.db.clearFileLinks()
    await this.folderLink.clear()
    await this.changeToken.clear()
    this.rootRef = null
  }

  /**
   * Find this space's Drive folder. Once linked (stored after the first
   * sync) it's used by ID, so renaming the space can't point sync at a
   * different folder. The first sync finds or creates it by name and links it.
   * @returns whether the folder was newly created
   */
  async resolveDriveFolder(): Promise<boolean> {
    const linkedId = await this.folderLink.get()

    if (linkedId) {
      const folder = await this.storage.inspectRoot(linkedId)
      if (!folder || folder.trashed) {
        throw new DriveFolderGoneError(folder)
      }
      this.rootRef = folder.ref
      if (folder.name !== this.spaceName) {
        await this.followRename(folder)
      }
      return false
    }

    const result = await this.storage.ensureRoot(this.spaceName, this.spaceId)
    this.rootRef = result.ref
    await this.folderLink.set(result.ref)
    await this.changeToken.clear()
    return result.isNew
  }

  /**
   * The space was renamed since it was linked to `folder`. If another
   * space folder already has the new name (e.g. another device created
   * it) and this device has nothing synced yet, join that folder. Otherwise
   * rename the linked folder to match, unless that name is taken.
   */
  async followRename(folder: RootInfo): Promise<void> {
    const existing = await this.storage.findRootByName(this.spaceName)

    if (existing && existing.ref !== folder.ref) {
      if (!(await this.hasSyncedRecords())) {
        this.rootRef = existing.ref
        await this.folderLink.set(existing.ref)
        await this.changeToken.clear()
        return
      }
      console.warn(
        `[DriveSync] Not renaming Drive folder "${folder.name}" to "${this.spaceName}": ` +
          'another folder already has that name. Syncing continues with the linked folder.'
      )
      return
    }

    await this.storage.renameRoot(folder.ref, this.spaceName)
  }

  /** Whether any local setlist or song has been synced to Drive */
  async hasSyncedRecords(): Promise<boolean> {
    const records = [...(await this.db.getAllSetlists()), ...(await this.db.getAllSongs())]
    return records.some(record => record.fileRef)
  }

  /**
   * A run for one operation (a sync, a pull, a push, a reset), which holds what it finds out:
   * `goneRefs` for a sync from the feed of changes. A test may make one to give a step.
   */
  newRun(goneRefs: Set<string> | null = null): SyncRun {
    return new SyncRun({
      db: this.db,
      parser: this.parser,
      spaceId: this.spaceId,
      space: this.space,
      goneRefs,
    })
  }

  /** A run has ended: the space's files are opened afresh for the next (its folders may move) */
  #endRun(): void {
    this.#space = null
  }

  /** Do `work` in `run` (an operation's that this is part of), or in a run of its own */
  async #within<T>(run: SyncRun | undefined, work: (run: SyncRun) => Promise<T>): Promise<T> {
    if (run) return work(run)
    try {
      return await work(this.newRun())
    } finally {
      this.#endRun()
    }
  }

  /**
   * Full sync: pull from Drive, then push local changes
   */
  async sync(
    progressCallback: ProgressCallback | null = null
  ): Promise<{ success: true } & SyncReport> {
    progressCallback?.({ stage: 'starting', message: 'Starting sync...' })

    let report: SyncReport
    try {
      const run = this.newRun()
      // Where the feed of changes stands before anything is read: what changes during this sync
      // is seen by the next incremental one
      // and who the space's folder is shared with, for choosing leaders, and whether the user can write
      // to it: three questions that do not depend on each other, asked together
      const [feedPosition] = await phase('chordless.sync.prepare', {}, () =>
        Promise.all([this.#feedPosition(), this.refreshMembers(), this.refreshAccess(run)])
      )

      // Before changing anything, check local records belong to this folder
      progressCallback?.({ stage: 'scanning', message: 'Checking Drive files...' })
      await phase('chordless.sync.inventory', {}, () => this.buildDriveInventory(run))
      // (without the listing the removals below are skipped, and the feed would not name them again)
      const listed = run.inventory !== null
      await this.assertRecordsInThisFolder(run)

      // Songs deleted here go in the Drive trash before anything is pulled, or they would come back
      const trashed = await this.trashPendingDeletions(run)
      if (trashed > 0) {
        progressCallback?.({
          stage: 'pulling',
          message: `Moved ${counted(trashed, 'deleted file')} to the Drive trash`,
        })
      }

      // First, pull changes from Drive
      progressCallback?.({ stage: 'pulling', message: 'Downloading from Drive...' })
      await phase('chordless.sync.pull', {}, () => this.pullFromDrive(progressCallback, run))

      // The pull has adopted the live files it could. A setlist whose file is still gone and
      // that wasn't edited here was removed from Drive: remove it here too
      const removed = await this.removeSetlistsDeletedInDrive(run)
      if (removed > 0) {
        progressCallback?.({
          stage: 'pulling',
          message: `Removed ${counted(removed, 'setlist')} deleted in Drive`,
        })
      }

      // A song whose file was deleted elsewhere, and not edited here, is deleted here too
      const goneSongs = await this.removeSongsDeletedInDrive(run)
      if (goneSongs > 0) {
        progressCallback?.({
          stage: 'pulling',
          message: `Removed ${counted(goneSongs, 'song')} that ${goneSongs === 1 ? 'was' : 'were'} deleted elsewhere`,
        })
      }

      // Share links: update the live ones and end the finished ones, which changes setlists,
      // so before they are pushed
      // Then, push local changes (a user who can only read has none to push). If the access
      // check could not be made, a refusal to upload is how a reader is found out
      try {
        if (!run.readOnly) await this.syncShares(run)
        if (!run.readOnly) {
          progressCallback?.({ stage: 'pushing', message: 'Checking for changes to upload...' })
          await phase('chordless.sync.push', {}, () => this.pushToDrive(progressCallback, run))
        }
      } catch (error) {
        if (!(await this.foundToBeReadOnly(run))) throw error
      }

      // A file that could not be downloaded, or one not seen to be gone, is not named by the feed
      // again: the place stays where it was, so that it is (the old place names it)
      if (!run.downloadsFailed && listed) await this.#keepFeedPosition(feedPosition)
      progressCallback?.({
        stage: 'complete',
        message: run.readOnly
          ? `Sync complete (view-only: your changes stay on this device${run.heldBack ? `, ${run.heldBack} differ from Drive` : ''})`
          : 'Sync complete!',
      })
      report = run.report()
    } catch (error) {
      console.error('[DriveSync] Sync failed:', error)
      progressCallback?.({
        stage: 'error',
        message: `Sync failed: ${errorMessage(error)}`,
      })
      throw error
    } finally {
      this.#endRun()
    }
    return { success: true, ...report }
  }

  /**
   * Where the storage's feed of changes stands now, or null if it has none or cannot say (then
   * no position is kept, and the next sync is a full one)
   */
  async #feedPosition(): Promise<string | null> {
    try {
      return (await this.space.changes?.start()) ?? null
    } catch (error) {
      console.warn('[DriveSync] Could not read the place in the feed of changes:', error)
      return null
    }
  }

  /** Keep a position taken before a sync that has now worked, or forget the old one if there is none */
  async #keepFeedPosition(position: string | null): Promise<void> {
    if (position) await this.changeToken.set(position)
    else await this.changeToken.clear()
  }

  /**
   * Sync from the storage's feed of changes: pull only the files it says changed, remove the
   * records of those it says are gone, and push local changes. Nothing is listed, so with nothing
   * changed it is one request. It does what the full sync does for those files and no more: it
   * does not refresh the members or the share links, and does not check that the records belong
   * to this folder. A full sync is done instead (and the place in the feed made afresh) when there
   * is no place kept, the storage has no feed, or the feed no longer knows the place.
   *
   * The place moves on only when every file it named was dealt with: one that could not be
   * downloaded is named again by the next call, which tries it again.
   * @param options.push - whether to upload local changes too (default yes)
   * @returns what it found, and whether a full sync had to be done instead
   */
  async incrementalSync(
    progressCallback: ProgressCallback | null = null,
    { push = true }: { push?: boolean } = {}
  ): Promise<{ success: true; full: boolean } & SyncReport> {
    const feed = this.space.changes
    const token = feed ? await this.changeToken.get() : null
    if (!feed || !token) return { ...(await this.sync(progressCallback)), full: true }

    let changes: Awaited<ReturnType<typeof feed.since>>
    try {
      changes = await phase('chordless.sync.feed', {}, () => feed.since(token))
    } catch (error) {
      if (!(error instanceof ChangeTokenLost)) throw error
      await this.changeToken.clear()
      return { ...(await this.sync(progressCallback)), full: true }
    }
    // (who the folder is shared with changes rarely: read it again now and then, not at every sync)
    await phase('chordless.sync.members', {}, () => this.#refreshMembersIfOld())
    const run = this.newRun(new Set(changes.gone))
    try {
      if (!push && changes.changed.length === 0 && changes.gone.length === 0) {
        // (nothing to pull and nothing to push: the one request was all it took)
        await this.changeToken.set(changes.token)
        return { success: true, full: false, ...run.report() }
      }
      const songs = changes.changed.filter(c => c.collection === 'songs').map(c => c.file)
      const setlists = changes.changed.filter(c => c.collection === 'setlists').map(c => c.file)
      const people = changes.changed.filter(c => c.collection === 'people').map(c => c.file)

      progressCallback?.({ stage: 'starting', message: 'Starting sync...' })
      await phase('chordless.sync.access', {}, () => this.#refreshAccessIfOld(run))
      await this.trashPendingDeletions(run)

      // (the people first: a setlist whose leader is not stored shows none)
      if (people.length > 0 || changes.gone.length > 0)
        await pullPeople(run, progressCallback, people)
      if (setlists.length > 0) await pullSetlists(run, progressCallback, setlists)
      if (songs.length > 0) await pullSongs(run, progressCallback, songs)
      else run.liveSongUuids = new Set()
      if (changes.gone.length > 0) {
        await this.removeSetlistsDeletedInDrive(run)
        await this.removeSongsDeletedInDrive(run)
        // What is left of them was edited here. The feed says a file is gone once, so the record
        // lets go of it now, or a later sync would update a file in the bin
        await this.#unlinkEditedGone(new Set(changes.gone))
      }

      // (a user who can only read has nothing to push: it finds that out itself)
      if (push) {
        // A share whose setlist changed here is updated with the push, so a live one is at once
        // (a full sync also ends and cleans up shares; this one lists nothing)
        if (!run.readOnly) await this.syncShares(run, { light: true })
        await phase('chordless.sync.push', {}, () => this.pushToDrive(progressCallback, run))
      }

      if (!run.downloadsFailed) await this.changeToken.set(changes.token)
      progressCallback?.({ stage: 'complete', message: 'Sync complete!' })
      return { success: true, full: false, ...run.report() }
    } catch (error) {
      console.error('[DriveSync] Incremental sync failed:', error)
      progressCallback?.({
        stage: 'error',
        message: `Sync failed: ${errorMessage(error)}`,
      })
      throw error
    } finally {
      this.#endRun()
    }
  }

  /**
   * Let go of the gone files of the records that were edited here (and so were kept): each is
   * then as one never uploaded, and the push makes a new file. A record not edited here keeps its
   * link and what it knows of the file, so that the pull can still bring Drive's version over it.
   */
  async #unlinkEditedGone(gone: Set<string>): Promise<void> {
    const edited = new Set<string>()
    for (const setlist of await this.db.getAllSetlists()) {
      if (setlist.fileRef && gone.has(setlist.fileRef) && setlistHasLocalChanges(setlist)) {
        edited.add(setlist.fileRef)
      }
    }
    for (const song of await this.db.getAllSongs()) {
      if (!song.fileRef || !gone.has(song.fileRef)) continue
      const chart = await this.db.getChordPro(song.chordproFileId)
      if (!chart || songHasLocalChanges(song, chart)) edited.add(song.fileRef)
    }
    if (edited.size > 0) await this.db.unlinkFiles(edited)
  }

  /** Read the space's members again if they were last read long ago (an incremental sync has no other time to) */
  async #refreshMembersIfOld(): Promise<void> {
    const refreshedAt = await this.memberCache.refreshedAt?.()
    if (refreshedAt === undefined) return
    if (refreshedAt && Date.now() - Date.parse(refreshedAt) < MEMBERS_REFRESH_MS) return
    await this.refreshMembers()
  }

  /**
   * Put the files of songs deleted here in the Drive trash (where they can be restored from), and
   * stop noting them. One that cannot be (a user who can only read, no network) is kept noted and
   * is not pulled again meanwhile.
   * @returns how many were put in the trash
   */
  async trashPendingDeletions(run: SyncRun): Promise<number> {
    const pending = await this.db.getPendingDeletions()
    run.pendingDeletedRefs = new Set(pending.map(entry => entry.ref))
    let trashed = 0
    for (const entry of pending) {
      try {
        await run.space.trash(entry.ref)
        await this.db.clearPendingDeletion(entry.ref)
        run.pendingDeletedRefs.delete(entry.ref)
        trashed++
      } catch (error) {
        console.warn(`[DriveSync] Could not put ${entry.ref} in the Drive trash yet:`, error)
      }
    }
    return trashed
  }

  /**
   * A song whose Drive file is gone, with no other file for it, and no change here that Drive
   * lacks, was deleted elsewhere: delete it here too. One that has been changed here is kept, and
   * goes back to Drive with the push.
   * @returns how many were removed
   */
  async removeSongsDeletedInDrive(run: SyncRun): Promise<number> {
    const live = run.liveSongUuids
    if (!run.knowsWhatIsGone || !live) return 0
    let removed = 0
    for (const song of await this.db.getAllSongs()) {
      if (!song.fileRef || run.fileExistsInDrive(song.fileRef)) continue
      if (live.has(songUuidOf(song))) continue
      const chordproFile = await this.db.getChordPro(song.chordproFileId)
      if (!chordproFile || songHasLocalChanges(song, chordproFile)) continue
      await this.db.deleteSong(song.uuid, { remember: false })
      removed++
    }
    return removed
  }

  /** Update and clean up this space's share links (see share-manager.ts); `light`: only update what changed here */
  async syncShares(run: SyncRun, { light = false }: { light?: boolean } = {}): Promise<number> {
    try {
      return await syncShares(
        {
          db: this.db,
          spaceId: this.spaceId,
          space: run.space,
        },
        { light }
      )
    } catch (error) {
      // Shares must never stop setlists and songs syncing
      console.error('[DriveSync] Share sync failed:', error)
      return 0
    }
  }

  /**
   * Build inventory of all file IDs that exist in Drive
   * This is called at the start of sync to detect missing files
   */
  async buildDriveInventory(run: SyncRun): Promise<void> {
    // (an incremental sync does not list the folders: the feed said what is gone)
    if (run.goneRefs) return
    try {
      run.inventory = await run.space.inventory()
    } catch (error) {
      // Without a complete inventory we can't tell which files are missing, so
      // skip the check (fileExistsInDrive assumes they exist). An incomplete set
      // would make every unlisted file look deleted and get re-uploaded.
      console.error('[DriveSync] Failed to build Drive inventory, skipping check:', error)
      run.inventory = null
    }
  }

  /**
   * Fetch and cache the people the space's Drive folder is shared with.
   * Not essential to syncing, so failures are only logged.
   */
  async refreshMembers(): Promise<SpaceMember[] | null> {
    try {
      const members = await this.space.members()
      await this.memberCache.set(members)
      return members
    } catch (error) {
      console.warn('[DriveSync] Could not refresh space members:', error)
      return null
    }
  }

  /**
   * Ask Drive whether the user can add files to the space's folder, and remember it
   * (on the space, so the app can stop offering edits that could never sync). If Drive
   * can't be asked, the user is taken to have write access, as before: nothing changes.
   * @returns whether the user can only read the folder
   */
  async refreshAccess(run: SyncRun): Promise<boolean> {
    let canAdd: boolean | null | undefined
    try {
      canAdd = (await this.storage.inspectRoot(this.folderId))?.canWrite
    } catch (error) {
      console.warn('[DriveSync] Could not check access to the space folder:', error)
    }
    run.readOnly = canAdd === false
    if (canAdd !== undefined && canAdd !== null) {
      this.#access = { readOnly: run.readOnly, at: Date.now() }
      try {
        await this.memberCache.setReadOnly?.(run.readOnly)
      } catch (error) {
        console.warn('[DriveSync] Could not record the access to the space folder:', error)
      }
    }
    return run.readOnly
  }

  /**
   * The same, for a sync from the feed, which has the answer of a few minutes ago if it has one
   * (it is as rarely changed as who the folder is shared with; and a write that is refused asks again)
   */
  async #refreshAccessIfOld(run: SyncRun): Promise<void> {
    const known = this.#access
    if (known && Date.now() - known.at < ACCESS_REFRESH_MS) {
      run.readOnly = known.readOnly
      return
    }
    await this.refreshAccess(run)
  }

  /**
   * After a write failed: ask again whether the user can only read the folder, and say so.
   * A reader whose first check couldn't be made is found out by their refused upload. (Any
   * failure asks, but only an answer from Drive that says read-only counts.)
   */
  async foundToBeReadOnly(run: SyncRun): Promise<boolean> {
    return this.refreshAccess(run)
  }

  /**
   * Throw SpaceFolderMismatchError if local records point to Drive files
   * that exist outside this space's folder. Sync treats records missing
   * from the folder as deleted and re-uploads them; for files that actually live
   * in another folder that would duplicate them, so stop instead. Needs the
   * inventory; skipped if it couldn't be built.
   */
  async assertRecordsInThisFolder(run: SyncRun): Promise<void> {
    if (!run.inventory) return

    const missing = [...(await this.db.getAllSetlists()), ...(await this.db.getAllSongs())].filter(
      record => record.fileRef && !run.fileExistsInDrive(record.fileRef)
    )

    let elsewhere = 0
    for (const record of missing) {
      const file = await run.space.status(record.fileRef as string)
      if (file && !file.trashed) elsewhere++
    }
    if (elsewhere > 0) {
      throw new SpaceFolderMismatchError(elsewhere, this.spaceName)
    }
  }

  /**
   * Remove the setlists whose Drive file is gone and that haven't been edited since they were
   * synced: their content is what Drive had, so Drive's removal wins (as in a reset). One
   * edited here is kept, and the push uploads it again, so no edit is lost. This device's
   * state for a removed setlist is kept, so a file restored from the Drive trash comes back
   * as it was. Needs the inventory; skipped if it couldn't be built.
   * @returns how many setlists were removed
   */
  async removeSetlistsDeletedInDrive(run: SyncRun): Promise<number> {
    if (!run.knowsWhatIsGone) return 0

    let removed = 0
    for (const setlist of await this.db.getAllSetlists()) {
      if (!setlist.fileRef || run.fileExistsInDrive(setlist.fileRef)) continue
      if (run.hasLiveFileOfItsOwn(setlist)) continue
      if (setlistHasLocalChanges(setlist)) continue
      await this.db.deleteSetlist(setlist.id)
      removed++
    }
    return removed
  }

  /**
   * Replace this device's setlists, songs and charts with what's in Drive.
   *
   * Unlike a normal sync, local records whose Drive file is gone are dropped
   * rather than re-uploaded, so files removed from Drive stay removed. To avoid
   * losing work it changes nothing if Drive can't be listed, or if any local
   * record has changes that aren't in Drive (throws UnsyncedChangesError).
   * Per-setlist device preferences (setlist_local) are kept.
   *
   * With `discardLocal` the changes that are not in Drive are thrown away too, as a reset from
   * a folder found by name does (resetFromFolderByName).
   */
  async resetLocalFromDrive(
    progressCallback: ProgressCallback | null = null,
    { discardLocal = false }: { discardLocal?: boolean } = {}
  ): Promise<void> {
    try {
      const run = this.newRun()
      const feedPosition = await this.#feedPosition()
      progressCallback?.({ stage: 'scanning', message: 'Checking Drive files...' })
      await this.buildDriveInventory(run)
      if (!run.inventory) {
        throw new Error("Couldn't list your Drive files, so nothing was changed. Try again.")
      }

      if (!discardLocal) {
        progressCallback?.({ stage: 'scanning', message: 'Checking for unsynced changes...' })
        const unsynced = await this.findUnsyncedChanges()
        if (unsynced.length > 0) {
          throw new UnsyncedChangesError(unsynced)
        }
      }

      progressCallback?.({ stage: 'clearing', message: 'Clearing local copy...' })
      await this.db.clearSyncedData()
      // (from here on the old place in the feed says nothing of what this device has: if the pull
      // below stops short, the next sync must list everything)
      await this.changeToken.clear()

      await this.pullFromDrive(progressCallback, run)
      // (a file the reset could not download is missing here, and the old place would not name it)
      await this.#keepFeedPosition(run.downloadsFailed ? null : feedPosition)
      progressCallback?.({ stage: 'complete', message: 'Reset complete' })
    } finally {
      this.#endRun()
    }
  }

  /**
   * Replace this device's data with the copy in the folder of this space's name that the signed-in
   * Google app can see, and link to that folder. For when the linked folder is gone
   * (DriveFolderGoneError), as after a move to a new Google app that cannot see the old one's
   * folder, and the folder by name was made by this app on another device. Whatever is only on
   * this device is lost, so it is for the person to choose. It looks for the folder first and
   * changes nothing, and makes no folder, if there is none; if the reset fails, the old link
   * is put back.
   */
  async resetFromFolderByName(progressCallback: ProgressCallback | null = null): Promise<void> {
    const folder = await this.storage.findRootByName(this.spaceName)
    if (!folder || folder.trashed) {
      throw new Error(
        `There is no Google Drive folder called "${this.spaceName}" that this app can see, so nothing was changed. Sync it from the device that has the data first.`
      )
    }
    const before = await this.folderLink.get()
    await this.folderLink.set(folder.ref)
    this.rootRef = folder.ref
    try {
      await this.resetLocalFromDrive(progressCallback, { discardLocal: true })
    } catch (error) {
      if (before) await this.folderLink.set(before)
      else await this.folderLink.clear()
      this.rootRef = null
      throw error
    }
  }

  /**
   * Local setlists and songs with changes that aren't in Drive.
   */
  async findUnsyncedChanges(): Promise<UnsyncedChange[]> {
    const unsynced: UnsyncedChange[] = []
    for (const setlist of await this.db.getAllSetlists()) {
      if (setlistHasLocalChanges(setlist)) {
        const label = [setlist.date, setlist.name].filter(Boolean).join(' ')
        unsynced.push({ type: 'setlist', id: setlist.id, label })
      }
    }
    for (const song of await this.db.getAllSongs()) {
      if (!song.chordproFileId) continue
      const chordproFile = await this.db.getChordPro(song.chordproFileId)
      if (chordproFile && songHasLocalChanges(song, chordproFile)) {
        unsynced.push({ type: 'song', id: songUuidOf(song), label: song.title || '' })
      }
    }
    for (const entry of await this.db.getPendingDeletions()) {
      unsynced.push({ type: 'song', id: entry.ref, label: '(deleted, not yet in the Drive trash)' })
    }
    return unsynced
  }

  /**
   * Pull changes from Drive, as part of `run` (a sync's), or on its own
   */
  pullFromDrive(
    progressCallback: ProgressCallback | null = null,
    run?: SyncRun
  ): Promise<SyncReport> {
    return this.#within(run, async run => {
      // Pull people first: a setlist whose leader is not stored shows none
      await pullPeople(run, progressCallback)

      // Pull setlists
      progressCallback?.({
        stage: 'pulling',
        message: 'Checking setlists...',
        current: 0,
        total: 1,
      })
      await pullSetlists(run, progressCallback)

      // Pull songs (chordpro files)
      progressCallback?.({ stage: 'pulling', message: 'Checking songs...', current: 0, total: 1 })
      await pullSongs(run, progressCallback)
      return run.report()
    })
  }

  /**
   * Push local changes to Drive, as part of `run` (a sync's), or on its own
   */
  pushToDrive(
    progressCallback: ProgressCallback | null = null,
    run?: SyncRun
  ): Promise<SyncReport> {
    return this.#within(run, async run => {
      if (run.readOnly ?? (await this.refreshAccess(run))) return run.report()
      const refusals = this.storage.writeRefusals()
      try {
        await this.#pushAll(progressCallback, run)
      } catch (error) {
        if (!(await this.foundToBeReadOnly(run))) throw error
        return run.report()
      }
      // Writes that failed were tried again and left for the next sync: were they refused?
      if (this.storage.writeRefusals() > refusals) await this.foundToBeReadOnly(run)
      return run.report()
    })
  }

  async #pushAll(progressCallback: ProgressCallback | null, run: SyncRun): Promise<void> {
    // Build inventory of existing Drive files (a full sync has its own, made when it began: nothing
    // is added to Drive between, and one listing of the whole space is enough)
    if (!run.inventory) {
      progressCallback?.({ stage: 'scanning', message: 'Checking Drive files...' })
      await this.buildDriveInventory(run)
    }

    // Push people first: the setlists' file names say their leaders
    await pushPeople(run, progressCallback)

    // Push setlists
    progressCallback?.({
      stage: 'pushing',
      message: 'Scanning setlists...',
      current: 0,
      total: 1,
    })
    await pushSetlists(run, progressCallback)

    // Push songs (chordpro files)
    progressCallback?.({
      stage: 'pushing',
      message: 'Scanning songs...',
      current: 0,
      total: 1,
    })
    await pushSongs(run, progressCallback)
  }
}

/**
 * Helper functions
 */

/**
 * Check if sync is available for a space (the one in use if none is given): signed in, and for
 * a team's member that is all it takes, as their files come through the Worker
 */
export async function isSyncAvailable(space?: Pick<Space, 'team'> | null): Promise<boolean> {
  return (space === undefined ? await currentSpaceStorage() : storageFor(space)).available()
}

/** The backend for the current space: Drive, or the Worker for a member of a team space */
async function currentSpaceStorage(): Promise<StorageBackend> {
  return storageFor(await getSpaceById(getCurrentSpace().id))
}

/**
 * Create a sync manager for a space
 */
export async function createSyncManager(
  spaceName: string,
  spaceId: string | null
): Promise<SyncManager> {
  const manager = await createUnlinkedSyncManager(spaceName, spaceId)
  await manager.init()
  return manager
}

/**
 * A manager that has not looked for the space's Drive folder: init() stops if the linked folder
 * is gone, which is when the way on (starting over, resetting from a folder by name) is needed
 */
export async function createUnlinkedSyncManager(
  spaceName: string,
  spaceId: string | null
): Promise<SyncManager> {
  // (no id means the current space, as the manager itself takes it)
  const space = await getSpaceById(spaceId ?? getCurrentSpace().id)
  return SyncManager.open(spaceName, spaceId, { storage: storageFor(space) })
}
