/**
 * The pull of a Drive sync: what Drive holds that this device doesn't, or holds newer, comes
 * down to the local database. Drive wins a conflict. A user who can only read never uploads, so
 * the leader's version replaces a setlist they changed here (`resetSetlists` says which, for the
 * app to tell them), while a chart they changed is left as it is (`heldBack` counts it): see
 * docs/SPACES.md, "Read-only: local edits are never blocked".
 */

import type { Setlist, SongInput, SongRecord } from '../data-types.ts'
import { withNumericTempos } from '../db.ts'
import { songSource } from '../song-source.ts'
import { chartFields, chartIdentity } from '../song-utils.ts'
import type { StoredFile } from '../storage/types.ts'
import { hashText } from '../utils/hash.ts'
import {
  driveMarkers,
  setlistHasLocalChanges,
  setlistIdOf,
  songHasLocalChanges,
} from './changes.ts'
import { inBatches, type ProgressCallback, type SyncSession } from './session.ts'
import { setlistContent, setlistContentHash } from './setlist-hash.ts'
import { metadataOfProps, remoteMetadataChanges } from './song-metadata.ts'

/** A chord chart in Drive that a pull has decided to download */
interface SongDownload {
  songUuid: string
  file: StoredFile
  props: Record<string, string>
  localSong: SongRecord | undefined
}

/** A setlist in Drive that a pull has decided to download */
interface SetlistDownload {
  driveFile: StoredFile
  setlistId: string
  localSetlist?: Setlist
  /** The local record's own Drive file is gone: this live file is taking its place */
  adopt?: boolean
}

/** The setlist record to keep for a downloaded file, with its local record (if any) in mind */
async function downloadSetlist(
  { driveFile, setlistId, localSetlist, adopt }: SetlistDownload,
  text: string
): Promise<Setlist> {
  // Older setlists in Drive may hold a chart's text as a tempo. Saving
  // converts it too, but convert first: the hash recorded as synced must
  // be of what's stored, or the setlist would look edited here
  const remote = withNumericTempos(JSON.parse(text))
  const remoteHash = setlistContentHash(remote)

  if (adopt && localSetlist) {
    const localHash = setlistContentHash(localSetlist)
    const syncedHash = localSetlist.syncedContentHash
    if (localHash === remoteHash) {
      // The same content: only the file it points at changes
      return {
        ...localSetlist,
        fileRef: driveFile.ref,
        fileModified: driveFile.modified,
        fileRev: driveFile.rev,
        lastSyncedAt: new Date().toISOString(),
        syncedContentHash: remoteHash,
      }
    }
    if (!syncedHash || localHash !== syncedHash) {
      // Edited here (or never synced): keep it, and the next push updates the live file
      console.warn(`[DriveSync] Setlist ${setlistId} has local changes: keeping them`)
      return {
        ...localSetlist,
        fileRef: driveFile.ref,
        fileModified: driveFile.modified,
        fileRev: driveFile.rev,
      }
    }
    // Unchanged here since it was synced, and Drive's copy differs: Drive's is newer
  }

  if (localSetlist?.syncedContentHash === remoteHash) {
    // Same content as we last synced, e.g. a record from before checksums
    // were recorded. Not a remote change: keep local edits, record checksum.
    return {
      ...localSetlist,
      fileModified: driveFile.modified,
      fileRev: driveFile.rev,
    }
  }
  if (localSetlist && setlistHasLocalChanges(localSetlist)) {
    // Changed both here and in Drive. For now Drive wins.
    // TODO: Implement proper conflict resolution
    console.warn(`[DriveSync] ⚠️ Conflict for setlist ${setlistId}, keeping Drive version`)
  }

  return {
    ...setlistContent(remote),
    id: remote.id || setlistId,
    fileRef: driveFile.ref,
    fileModified: driveFile.modified,
    fileRev: driveFile.rev,
    lastSyncedAt: new Date().toISOString(),
    syncedContentHash: remoteHash,
  }
}

/**
 * Pull setlists from Drive (with batch database operations)
 */
export async function pullSetlists(
  session: SyncSession,
  progressCallback: ProgressCallback | null = null
): Promise<void> {
  // Get all setlists from Drive
  const driveSetlists = await session.space.list('setlists')
  session.liveSetlistFiles = driveSetlists
  session.pullIncomplete = false

  const downloadQueue: SetlistDownload[] = []
  const adopted = new Set<string>()
  const resetting = new Map<string, Setlist>()

  for (const driveFile of driveSetlists) {
    try {
      const setlistId = setlistIdOf(driveFile)

      // Check if we have this setlist locally
      const localSetlist = await session.db.getSetlist(setlistId)

      if (!localSetlist) {
        // New setlist, download it
        downloadQueue.push({ driveFile, setlistId })
      } else if (localSetlist.fileRef === driveFile.ref) {
        // Drive's content changed since our last sync if its md5Checksum (computed
        // by Drive) differs from the one we recorded. No clocks involved.
        if (driveFile.rev !== localSetlist.fileRev) {
          if (session.readOnly && setlistHasLocalChanges(localSetlist)) {
            resetting.set(setlistId, localSetlist)
          }
          downloadQueue.push({ driveFile, setlistId, localSetlist })
        }
      } else if (!adopted.has(setlistId) && session.isOrphaned(localSetlist)) {
        // The Drive file this device knew is gone (e.g. duplicates were cleaned up), yet
        // another live file holds this setlist: take that one over rather than uploading
        // a copy of it
        adopted.add(setlistId)
        downloadQueue.push({ driveFile, setlistId, localSetlist, adopt: true })
      }
    } catch (error) {
      session.pullIncomplete = true
      console.error(`[DriveSync] Failed to pull setlist ${driveFile.name}:`, error)
    }
  }

  if (downloadQueue.length === 0) {
    progressCallback?.({
      stage: 'pulling',
      message: 'Setlists already up to date',
      current: 1,
      total: 1,
    })
    return
  }

  progressCallback?.({
    stage: 'pulling',
    message: `Downloading ${downloadQueue.length} setlists...`,
    current: 0,
    total: downloadQueue.length,
  })

  const setlistsToSave: Setlist[] = []
  let completed = 0
  await inBatches(
    session.space,
    downloadQueue,
    item => item.driveFile.ref,
    (item, text) => downloadSetlist(item, text),
    results => {
      for (const result of results) {
        if (result.status === 'fulfilled') {
          setlistsToSave.push(result.value)
          completed++
          progressCallback?.({
            stage: 'pulling',
            message: `Downloaded ${completed}/${downloadQueue.length} setlists`,
            current: completed,
            total: downloadQueue.length,
          })
        } else {
          session.pullIncomplete = true
          console.error('[DriveSync] Failed to download setlist:', result.reason)
        }
      }
    }
  )

  if (setlistsToSave.length > 0) {
    await session.db.saveSetlistsBatch(setlistsToSave)
    for (const after of setlistsToSave) {
      const before = resetting.get(after.id)
      if (before) session.resetSetlists.push({ before, after })
    }
  }
}

/**
 * Pull songs from Drive
 *
 * Validation: Handle user-copied files
 * When users copy files in Drive, appProperties are also copied, which can create
 * duplicate versionId values (multiple files with same versionId but different fileRef)
 *
 * Detection and auto-fix strategy:
 * 1. List all chordpro files in songs/ folder with appProperties
 * 2. Group by songId
 * 3. For each song, detect duplicate versionId values:
 *    - If multiple files have same versionId but different fileRef
 *    - Generate new unique versionId for the duplicate
 *    - Update Drive file's appProperties with corrected versionId and versionLabel
 * 4. Download/update local database with corrected metadata
 * 5. Parse chordpro content and create/update song records
 */
export async function pullSongs(
  session: SyncSession,
  progressCallback: ProgressCallback | null = null
): Promise<void> {
  const driveFiles = await session.space.list('songs')

  const latestByUuid = new Map<
    string,
    { file: StoredFile; props: Record<string, string>; songUuid: string; driveModified: Date }
  >()
  for (const file of driveFiles) {
    const props = file.props
    if (props.type && props.type !== 'chordpro') continue
    // A song deleted here, whose file could not be put in the trash yet, is not to come back
    if (session.pendingDeletedRefs.has(file.ref)) continue
    const songUuid = driveSongUuid(props, file.ref)
    const driveModified = new Date(file.modified || file.created || 0)
    const existing = latestByUuid.get(songUuid)
    if (existing && driveModified <= existing.driveModified) {
      if (driveModified.getTime() !== existing.driveModified.getTime()) {
        console.warn(`[DriveSync] Duplicate chord chart for ${songUuid}, keeping newer file`)
      }
      continue
    }
    if (existing) {
      console.warn(`[DriveSync] Duplicate chord chart for ${songUuid}, replacing with newer file`)
    }
    latestByUuid.set(songUuid, { file, props, songUuid, driveModified })
  }

  session.liveSongUuids = new Set(latestByUuid.keys())

  if (latestByUuid.size === 0) {
    progressCallback?.({
      stage: 'pulling',
      message: 'No songs found in Drive',
      current: 1,
      total: 1,
    })
    return
  }

  const downloads: SongDownload[] = []
  // Songs whose file is the same but whose properties another device changed (which variant is
  // the default, what a variant is called, who imported it): there is nothing to download
  const metadataOnly: { localSong: SongRecord; file: StoredFile; changes: Partial<SongRecord> }[] =
    []
  for (const entry of latestByUuid.values()) {
    const { songUuid, file, props } = entry
    const localSong = await session.db.getSong(songUuid)
    const chordproRecord = localSong?.chordproFileId
      ? await session.db.getChordPro(localSong.chordproFileId)
      : null

    let needsDownload = false
    if (!localSong) {
      needsDownload = true
    } else if (!localSong.fileRef || localSong.fileRef !== file.ref) {
      needsDownload = true
    } else if (file.rev !== localSong.fileRev) {
      // Drive's content changed since our last sync: its md5Checksum (computed
      // by Drive) differs from the one we recorded
      if (session.readOnly && chordproRecord && songHasLocalChanges(localSong, chordproRecord)) {
        session.heldBack++
      } else {
        needsDownload = true
      }
    } else if (!chordproRecord) {
      needsDownload = true
    } else {
      const changes = remoteMetadataChanges(localSong, props)
      if (changes) metadataOnly.push({ localSong, file, changes })
    }

    if (needsDownload) {
      downloads.push({ songUuid, file, props, localSong })
    }
  }

  for (const { localSong, file, changes } of metadataOnly) {
    await session.db.saveSong({ ...localSong, ...changes, ...driveMarkers(file) })
  }

  if (downloads.length === 0) {
    progressCallback?.({
      stage: 'pulling',
      message: 'Songs already up to date',
      current: 1,
      total: 1,
    })
    return
  }

  let downloaded = 0

  progressCallback?.({
    stage: 'pulling',
    message: `Downloading ${downloads.length} songs...`,
    current: 0,
    total: downloads.length,
  })

  await inBatches(
    session.space,
    downloads,
    item => item.file.ref,
    (item, text) => downloadSong(session, item, text),
    results => {
      const succeeded = results.filter(result => result.status === 'fulfilled').length
      downloaded += succeeded
      if (succeeded > 0) {
        progressCallback?.({
          stage: 'pulling',
          message: `Downloaded ${downloaded}/${downloads.length} songs`,
          current: downloaded,
          total: downloads.length,
        })
      }
      for (const result of results) {
        if (result.status === 'rejected') {
          console.error('[DriveSync] Failed to download song:', result.reason)
        }
      }
    }
  )
}

export function driveSongUuid(props: Record<string, string>, fallbackId: string): string {
  return props.songUuid || props.versionId || props.songId || fallbackId
}

export function titleFromFilename(filename: string | undefined): string {
  if (!filename) return 'Untitled'
  return filename.replace(/\.[^/.]+$/, '')
}

async function downloadSong(
  session: SyncSession,
  { songUuid, file, props, localSong }: SongDownload,
  chordproContent: string
): Promise<void> {
  const remoteHash = hashText(chordproContent)
  const localChart = localSong?.chordproFileId
    ? await session.db.getChordPro(localSong.chordproFileId)
    : undefined

  // (with the chart gone from this device, it is restored from Drive's, whatever the hash)
  if (localChart && localSong?.fileRef === file.ref && localSong.syncedContentHash === remoteHash) {
    // Same chart as we last synced, e.g. a record from before checksums were
    // recorded. Not a remote change: keep local edits, record the checksum.
    await session.db.saveSong({
      ...localSong,
      ...driveMarkers(file),
    })
    return
  }
  if (localSong && localChart && songHasLocalChanges(localSong, localChart)) {
    // Changed both here and in Drive. For now Drive wins.
    console.warn(`[DriveSync] ⚠️ Conflict for song ${songUuid}, keeping Drive version`)
  }

  const chordproFileId = localSong?.chordproFileId || `chordpro-${crypto.randomUUID()}`

  const parsed = session.parser.parse(chordproContent)
  const { metadata } = parsed
  // What Drive's file properties and this device's copy know of the song fill in what the
  // chart lacks
  const { ccliNumber, title, titleNormalized, id } = chartIdentity(metadata, {
    ccliNumber: props.ccliNumber || localSong?.ccliNumber,
    title: props.title || localSong?.title || titleFromFilename(file.name),
    id: props.songId || localSong?.id,
  })
  const variantLabel = props.variantLabel || localSong?.variantLabel || 'Original'
  const contentHash = remoteHash

  const now = new Date().toISOString()
  await session.db.saveChordPro({
    id: chordproFileId,
    content: chordproContent,
    contentHash,
    createdDate: localChart?.createdDate ?? file.created ?? now,
    modifiedDate: file.modified ?? now,
  })

  // The chart's fields, as for an imported song, falling back to this device's copy for
  // any the chart lacks
  const chart = chartFields(metadata)
  const songRecord: SongInput = {
    uuid: songUuid,
    id,
    variantOf: props.variantOf || localSong?.variantOf || null,
    isDefault: props.isDefault === 'true' || localSong?.isDefault || !props.variantOf,
    variantLabel,
    chordproFileId,
    ccliNumber,
    title,
    titleNormalized,
    author: chart.author ?? localSong?.author ?? null,
    copyright: chart.copyright ?? localSong?.copyright ?? null,
    key: chart.key ?? localSong?.key ?? null,
    originalKey: chart.originalKey ?? localSong?.originalKey ?? null,
    tempo: chart.tempo ?? localSong?.tempo ?? null,
    originalTempo: chart.originalTempo ?? localSong?.originalTempo ?? null,
    time: chart.time ?? localSong?.time ?? null,
    importDate:
      localSong?.importDate || props.importDate || file.created || new Date().toISOString(),
    importUser: localSong?.importUser || props.importUser || null,
    // (where it came from, whichever device made it: never that Drive carried it here)
    importSource: songSource(localSong?.importSource) || songSource(props.importSource),
    sourceUrl: localSong?.sourceUrl || null,
    modifiedDate: new Date(file.modified || file.created || Date.now()).toISOString(),
    fileRef: file.ref,
    ...driveMarkers(file),
    lastSyncedAt: new Date().toISOString(),
    syncedContentHash: remoteHash,
    syncedMetadata: metadataOfProps(props),
    fileProps: {
      songId: id,
      songUuid,
      contentHash,
      ccliNumber: ccliNumber || '',
      title,
      titleNormalized,
      variantLabel,
      appVersion: props.appVersion || '1.0.0',
    },
    contentHash,
  }

  await session.db.saveSong(songRecord)
}
