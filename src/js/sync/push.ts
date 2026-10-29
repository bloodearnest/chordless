/**
 * The push of a Drive sync: what is new or changed on this device goes up to Drive, new files
 * and changed ones each in batches (the storage decides how a batch is sent).
 */
import type { ChordProRecord, Setlist, SongFileProps, SongRecord } from '../data-types.ts'
import {
  fileInput,
  setlistFileMetadata,
  songFileDetails,
  songFileMetadata,
  updateInput,
} from '../drive-metadata.ts'
import type { WriteResult } from '../storage/types.ts'
import { hashText } from '../utils/hash.ts'
import {
  driveMarkers,
  setlistHasLocalChanges,
  setlistKey,
  songHasLocalChanges,
  songUuidOf,
} from './changes.ts'
import { BATCH_SIZE, type ProgressCallback, type SyncRun } from './session.ts'
import { setlistContent, setlistContentHash } from './setlist-hash.ts'
import { metadataOfSong } from './song-metadata.ts'

/** A setlist's file content in Drive */
function setlistJson(setlist: Setlist): string {
  return JSON.stringify(setlistContent(setlist), null, 2)
}

/** Drive file metadata for a setlist (see drive-metadata.ts) */
function setlistMetadata(run: SyncRun, setlist: Setlist) {
  return setlistFileMetadata(setlist, { spaceId: run.spaceId })
}

/** Drive file metadata for a song variant's chart (see drive-metadata.ts) */
function songMetadata(run: SyncRun, song: SongRecord, chordproFile: ChordProRecord) {
  return songFileMetadata(song, chordproFile, { spaceId: run.spaceId })
}

/** What this device records about a song's synced file */
function songDriveProperties(song: SongRecord, chordproFile: ChordProRecord): SongFileProps {
  const { title, ccliNumber, variantLabel } = songFileDetails(song, chordproFile)
  return {
    songId: song.id,
    songUuid: songUuidOf(song),
    contentHash: hashText(chordproFile.content),
    ccliNumber,
    title,
    titleNormalized: song.titleNormalized,
    variantLabel,
  }
}

/** Record on a setlist that Drive now holds this content in this file (if it stored it intact) */
function recordSetlistUpload(setlist: Setlist, { file, intact }: WriteResult) {
  setlist.fileRef = file.ref
  Object.assign(setlist, driveMarkers(file))
  if (intact) {
    setlist.lastSyncedAt = new Date().toISOString()
    setlist.syncedContentHash = setlistContentHash(setlist)
  }
}

/**
 * Record on a song that Drive now holds its chart in this file. What Drive holds is kept only
 * when it is what was sent: with other content in Drive, this song differs from it, and is
 * uploaded again.
 */
function recordSongUpload(
  song: SongRecord,
  chordproFile: ChordProRecord,
  { file, intact }: WriteResult
) {
  song.fileRef = file.ref
  Object.assign(song, driveMarkers(file))
  if (intact) {
    song.fileProps = songDriveProperties(song, chordproFile)
    song.syncedMetadata = metadataOfSong(song)
    song.lastSyncedAt = new Date().toISOString()
    song.syncedContentHash = hashText(chordproFile.content)
    song.contentHash = chordproFile.contentHash
  }
}

/** Smart skip detection: a setlist needs syncing when it has no Drive file, or has changed */
export async function setlistNeedsSync(run: SyncRun, setlist: Setlist): Promise<boolean> {
  if (!setlist.fileRef || !run.fileExistsInDrive(setlist.fileRef)) return true
  return setlistHasLocalChanges(setlist)
}

/** Smart skip detection: a song needs syncing when it has no Drive file, or has changed */
export async function songNeedsSync(
  run: SyncRun,
  song: SongRecord,
  chordproFile: ChordProRecord
): Promise<boolean> {
  if (!song.fileRef || !run.fileExistsInDrive(song.fileRef)) return true
  return songHasLocalChanges(song, chordproFile)
}

/** Another setlist, with a live Drive file, for the same date, time, leader, type and name */
function syncedTwinOf(run: SyncRun, setlist: Setlist, setlists: Setlist[]): Setlist | undefined {
  const key = setlistKey(setlist)
  return setlists.find(
    other =>
      other.id !== setlist.id &&
      setlistKey(other) === key &&
      ((other.fileRef && run.fileExistsInDrive(other.fileRef)) || run.hasLiveFileOfItsOwn(other))
  )
}

/**
 * Upload records in batches, each batch in one call to the storage. A batch that fails is
 * uploaded one record at a time, so one bad record doesn't stop the others.
 * @returns how many were uploaded
 */
async function uploadInBatches<T>(
  items: T[],
  batchSize: number,
  {
    uploadBatch,
    uploadOne,
    describe,
    onProgress,
  }: {
    /** Upload a batch in one request, and record it; how many were recorded */
    uploadBatch: (batch: T[]) => Promise<number>
    uploadOne: (item: T) => Promise<void>
    describe: (item: T) => string
    onProgress: (uploaded: number) => void
  }
): Promise<number> {
  let uploaded = 0
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize)
    try {
      uploaded += await uploadBatch(batch)
    } catch (error) {
      console.error(`[DriveSync] Concurrent upload failed:`, error)
      for (const item of batch) {
        try {
          await uploadOne(item)
          uploaded++
        } catch (err) {
          console.error(`[DriveSync] Failed to upload ${describe(item)}:`, err)
        }
      }
    }
    onProgress(uploaded)
  }
  return uploaded
}

/**
 * The setlists to create files for, out of those that need syncing: not those a Drive file is
 * waiting for, nor those that would store a setlist twice.
 */
function setlistsToCreate(run: SyncRun, created: Setlist[], localSetlists: Setlist[]): Setlist[] {
  // After a pull that could not read every file, this device may not know a twin of a setlist
  // it would create a file for. Create nothing until a pull succeeds; updates go ahead.
  if (run.pullIncomplete && created.length > 0) {
    console.warn(
      `[DriveSync] Not uploading ${created.length} new setlists: the pull could not read every file. They are retried next sync.`
    )
    return []
  }

  // A record with no file of its own that is still there, while Drive has a live file for its
  // id, waits for a pull to adopt that file (see SyncRun.hasLiveFileOfItsOwn)
  const unclaimed = created.filter(setlist => {
    if (!run.hasLiveFileOfItsOwn(setlist)) return true
    console.warn(
      `[DriveSync] Not uploading setlist ${setlist.id}: Drive has a file for it that this sync could not read. It is retried next sync.`
    )
    return false
  })

  // A setlist never uploaded, while another setlist that has been synced is for the same date,
  // time, leader, type and name, is that setlist stored twice, e.g. two devices each made their
  // own record of it. Uploading it would duplicate it, so leave it here. The other is one with
  // a live file (the pull has just made a local record of every file in Drive, so this needs no
  // downloads) or one about to be uploaded again because its file is gone. Two records made
  // here and never uploaded are the user's own doing and are both uploaded.
  const reuploading = new Set(
    unclaimed.filter(setlist => setlist.lastSyncedAt).map(setlist => setlistKey(setlist))
  )
  return unclaimed.filter(setlist => {
    const twin = syncedTwinOf(run, setlist, localSetlists)
    if (!twin && (setlist.lastSyncedAt || !reuploading.has(setlistKey(setlist)))) return true
    console.warn(
      `[DriveSync] Not uploading setlist ${setlist.id}: it is the same setlist as ` +
        `${twin ? `${twin.id}, which Drive has` : 'one being uploaded again'} ` +
        `(${setlist.date} ${setlist.type}). Reset this device from Google Drive to fix it.`
    )
    return false
  })
}

/** Push setlists to Drive (new ones in batches) */
export async function pushSetlists(
  run: SyncRun,
  progressCallback: ProgressCallback | null = null
): Promise<void> {
  const localSetlists = await run.db.getAllSetlists()

  // Only the setlists that need syncing
  const toSync: Setlist[] = []
  for (const setlist of localSetlists) {
    if (await setlistNeedsSync(run, setlist)) toSync.push(setlist)
  }
  const report = (uploaded: number) =>
    progressCallback?.({
      stage: 'pushing',
      message: `Uploaded ${uploaded}/${toSync.length} setlists`,
      current: uploaded,
      total: toSync.length,
    })
  progressCallback?.({
    stage: 'pushing',
    message:
      toSync.length > 0 ? `Uploading ${toSync.length} setlists...` : 'No setlist changes to upload',
    current: 0,
    total: Math.max(1, toSync.length),
  })

  // Those whose file is in Drive are updated; the others are new, or their file is gone
  const updated = toSync.filter(
    setlist => setlist.fileRef && run.fileExistsInDrive(setlist.fileRef)
  )
  const created = toSync.filter(setlist => !updated.includes(setlist))
  for (const setlist of created) {
    if (setlist.fileRef) {
      setlist.fileRef = null
      setlist.fileModified = null
      setlist.fileRev = null
    }
  }
  const newSetlists = setlistsToCreate(run, created, localSetlists)

  const recordBatch = async (
    batch: Setlist[],
    results: (WriteResult | null)[]
  ): Promise<number> => {
    const saved: Setlist[] = []
    batch.forEach((setlist, j) => {
      const result = results[j]
      if (!result) return
      recordSetlistUpload(setlist, result)
      saved.push(setlist)
    })
    if (saved.length > 0) await run.db.saveSetlistsSent(saved)
    return saved.length
  }
  const uploadOne = (setlist: Setlist) => pushSetlist(run, setlist)
  const describe = (setlist: Setlist) => `setlist ${setlist.id}`

  const uploaded = await uploadInBatches(newSetlists, BATCH_SIZE, {
    uploadBatch: async batch =>
      recordBatch(
        batch,
        await run.space.createMany(
          'setlists',
          batch.map(setlist => ({
            input: fileInput(setlistMetadata(run, setlist)),
            body: setlistJson(setlist),
          }))
        )
      ),
    uploadOne,
    describe,
    onProgress: report,
  })
  await uploadInBatches(updated, BATCH_SIZE, {
    // (metadata too, so the file name follows e.g. a changed date or leader)
    uploadBatch: async batch =>
      recordBatch(
        batch,
        await run.space.updateMany(
          batch.map(setlist => ({
            ref: setlist.fileRef as string,
            input: updateInput(setlistMetadata(run, setlist), 'setlist'),
            body: setlistJson(setlist),
          }))
        )
      ),
    uploadOne,
    describe,
    onProgress: count => report(uploaded + count),
  })
}

/** Push a single setlist to Drive: a new file, or an update of its file */
export async function pushSetlist(run: SyncRun, setlist: Setlist): Promise<void> {
  try {
    const content = setlistJson(setlist)
    const metadata = setlistMetadata(run, setlist)
    const result = setlist.fileRef
      ? // (metadata too, so the file name follows e.g. a changed date or leader)
        await run.space.update(setlist.fileRef, updateInput(metadata, 'setlist'), content)
      : await run.space.create('setlists', fileInput(metadata), content)
    recordSetlistUpload(setlist, result)
    await run.db.saveSetlistsSent([setlist])
  } catch (error) {
    console.error(`[DriveSync] Failed to push setlist ${setlist.id}:`, error)
    throw error // Re-throw for Promise.allSettled
  }
}

/** A song and its chart: what is uploaded for it */
interface SongUpload {
  song: SongRecord
  chordproFile: ChordProRecord
}

/** Push songs (flattened variants) to Drive */
export async function pushSongs(
  run: SyncRun,
  progressCallback: ProgressCallback | null = null
): Promise<void> {
  const created: SongUpload[] = []
  const updated: SongUpload[] = []
  // (all the charts in one transaction: a read each, one after another, made every sync of a
  // library of a few hundred songs wait for hundreds of them, on a phone a third of a second)
  const withChart = (await run.db.getAllSongs()).filter(song => song.chordproFileId)
  const charts = await run.db.getChordPros(withChart.map(song => song.chordproFileId))
  for (const [i, song] of withChart.entries()) {
    const chordproFile = charts[i]
    if (!chordproFile) {
      console.warn(`[DriveSync] ChordPro file not found: ${song.chordproFileId}`)
      continue
    }
    if (!(await songNeedsSync(run, song, chordproFile))) continue

    if (song.fileRef && run.fileExistsInDrive(song.fileRef)) {
      updated.push({ song, chordproFile })
    } else {
      if (song.fileRef) {
        song.fileRef = null
        song.fileProps = null
        song.fileRev = null
      }
      created.push({ song, chordproFile })
    }
  }

  const total = created.length + updated.length
  const report = (uploaded: number) =>
    progressCallback?.({
      stage: 'pushing',
      message: `Uploaded ${uploaded}/${total} song variants`,
      current: uploaded,
      total,
    })
  progressCallback?.({
    stage: 'pushing',
    message: total > 0 ? `Uploading ${total} songs...` : 'No song changes to upload',
    current: 0,
    total: Math.max(1, total),
  })

  const recordBatch = async (batch: SongUpload[], results: (WriteResult | null)[]) => {
    const saved: SongRecord[] = []
    batch.forEach(({ song, chordproFile }, j) => {
      const result = results[j]
      if (!result) return
      recordSongUpload(song, chordproFile, result)
      saved.push(song)
    })
    if (saved.length > 0) await run.db.saveSongsSent(saved)
    return saved.length
  }
  const uploadOne = ({ song, chordproFile }: SongUpload) => pushSongVariant(run, song, chordproFile)
  const describe = ({ song }: SongUpload) => `song ${song.id}/${songUuidOf(song)}`

  const uploaded = await uploadInBatches(created, BATCH_SIZE, {
    uploadBatch: async batch =>
      recordBatch(
        batch,
        await run.space.createMany(
          'songs',
          batch.map(({ song, chordproFile }) => ({
            input: fileInput(songMetadata(run, song, chordproFile)),
            body: chordproFile.content,
          }))
        )
      ),
    uploadOne,
    describe,
    onProgress: report,
  })
  await uploadInBatches(updated, BATCH_SIZE, {
    uploadBatch: async batch =>
      recordBatch(
        batch,
        await run.space.updateMany(
          batch.map(({ song, chordproFile }) => ({
            ref: song.fileRef as string,
            input: updateInput(songMetadata(run, song, chordproFile), 'song'),
            body: chordproFile.content,
          }))
        )
      ),
    uploadOne,
    describe,
    onProgress: count => report(uploaded + count),
  })
}

/** Push a specific song variant to Drive: a new file, or an update of its file */
export async function pushSongVariant(
  run: SyncRun,
  song: SongRecord,
  chordproFile: ChordProRecord
): Promise<void> {
  try {
    const metadata = songMetadata(run, song, chordproFile)
    const result = song.fileRef
      ? await run.space.update(song.fileRef, updateInput(metadata, 'song'), chordproFile.content)
      : await run.space.create('songs', fileInput(metadata), chordproFile.content)
    recordSongUpload(song, chordproFile, result)
    await run.db.saveSongsSent([song])
  } catch (error) {
    console.error(`[DriveSync] Failed to push song ${song.id}/${songUuidOf(song)}:`, error)
    throw error
  }
}
