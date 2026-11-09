/**
 * The push of a Drive sync: what is new or changed on this device goes up to Drive, new files
 * and changed ones each in batches (the storage decides how a batch is sent).
 */
import type {
  ChordProRecord,
  Person,
  ScoreRecord,
  Setlist,
  SongFileProps,
  SongRecord,
} from '../data-types.ts'
import {
  fileInput,
  personFileMetadata,
  scoreFileMetadata,
  setlistFileMetadata,
  songFileDetails,
  songFileMetadata,
  updateInput,
} from '../drive-metadata.ts'
import { leaderName } from '../leaders.ts'
import { writeMxl } from '../mxl.ts'
import type { WriteResult } from '../storage/types.ts'
import { hashText } from '../utils/hash.ts'
import {
  driveMarkers,
  scoreHasLocalChanges,
  setlistHasLocalChanges,
  setlistKey,
  songHasLocalChanges,
  songUuidOf,
} from './changes.ts'
import { personContent, personContentHash, personHasLocalChanges } from './person-hash.ts'
import { BATCH_SIZE, type ProgressCallback, type SyncRun } from './session.ts'
import { setlistContent, setlistContentHash } from './setlist-hash.ts'
import { metadataOfSong } from './song-metadata.ts'

/** A setlist's file content in Drive */
function setlistJson(setlist: Setlist): string {
  return JSON.stringify(setlistContent(setlist), null, 2)
}

/** Drive file metadata for a setlist (see drive-metadata.ts) */
function setlistMetadata(run: SyncRun, setlist: Setlist) {
  return setlistFileMetadata(setlist, {
    spaceId: run.spaceId,
    leader: leaderName(run.people, setlist.leaderId),
  })
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

/** A person's file content in storage */
function personJson(person: Person): string {
  return JSON.stringify(personContent(person), null, 2)
}

/** Record on a person that storage now holds this content in this file (if it stored it intact) */
function recordPersonUpload(person: Person, { file, intact }: WriteResult) {
  person.fileRef = file.ref
  Object.assign(person, driveMarkers(file))
  if (intact) {
    person.lastSyncedAt = new Date().toISOString()
    person.syncedContentHash = personContentHash(person)
  }
}

/** Push people to storage: new ones, and those changed here (in batches, as setlists are) */
export async function pushPeople(
  run: SyncRun,
  progressCallback: ProgressCallback | null = null
): Promise<void> {
  const metadata = (person: Person) =>
    fileInput(personFileMetadata(person, { spaceId: run.spaceId }))
  const toSync = (await run.db.getAllPeople()).filter(
    person =>
      !person.fileRef || !run.fileExistsInDrive(person.fileRef) || personHasLocalChanges(person)
  )
  if (toSync.length === 0) return
  const updated = toSync.filter(person => person.fileRef && run.fileExistsInDrive(person.fileRef))
  let created = toSync.filter(person => !updated.includes(person))
  for (const person of created) {
    person.fileRef = null
    person.fileModified = null
    person.fileRev = null
  }
  // A person with no file of its own while storage has a live file for their id waits for a pull
  // to adopt it, or the person would be stored twice. And after a pull that could not read every
  // file, a person may have a file this device does not know of.
  if (run.peoplePullIncomplete) created = []
  created = created.filter(person => !run.livePeopleIds?.has(person.id))

  const report = (uploaded: number) =>
    progressCallback?.({
      stage: 'pushing',
      message: `Uploaded ${uploaded}/${toSync.length} people`,
      current: uploaded,
      total: toSync.length,
    })
  const recordBatch = async (batch: Person[], results: (WriteResult | null)[]) => {
    const saved: Person[] = []
    batch.forEach((person, j) => {
      const result = results[j]
      if (!result) return
      recordPersonUpload(person, result)
      saved.push(person)
    })
    await run.db.savePeopleSent(saved)
    return saved.length
  }
  const uploadOne = async (person: Person) => {
    const result = person.fileRef
      ? await run.space.update(person.fileRef, metadata(person), personJson(person))
      : await run.space.create('people', metadata(person), personJson(person))
    recordPersonUpload(person, result)
    await run.db.savePeopleSent([person])
  }
  const describe = (person: Person) => `person ${person.id}`

  const uploaded = await uploadInBatches(created, BATCH_SIZE, {
    uploadBatch: async batch =>
      recordBatch(
        batch,
        await run.space.createMany(
          'people',
          batch.map(person => ({ input: metadata(person), body: personJson(person) }))
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
          batch.map(person => ({
            ref: person.fileRef as string,
            input: metadata(person),
            body: personJson(person),
          }))
        )
      ),
    uploadOne,
    describe,
    onProgress: count => report(uploaded + count),
  })
}

/** Push setlists to Drive (new ones in batches) */
export async function pushSetlists(
  run: SyncRun,
  progressCallback: ProgressCallback | null = null
): Promise<void> {
  const localSetlists = await run.db.getAllSetlists()
  run.people = await run.db.getAllPeople()

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
    if (run.people.length === 0) run.people = await run.db.getAllPeople()
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

/** A melody and the song it belongs to: what is uploaded for it */
interface ScoreUpload {
  record: ScoreRecord
  song: SongRecord
  /** What is uploaded: the `.mxl`, or the plain MusicXML where the space holds text only */
  body: Uint8Array | string
}

/** Record on a melody that Drive now holds this MusicXML in this file (if it stored it intact) */
function recordScoreUpload(upload: ScoreUpload, { file, intact }: WriteResult) {
  const { record } = upload
  record.fileRef = file.ref
  Object.assign(record, driveMarkers(file))
  // (what it was written with is the new name and properties)
  delete record.legacyFile
  if (intact) {
    record.lastSyncedAt = new Date().toISOString()
    // (the hash is of the score, not of the file: the same score is the same however it is zipped)
    record.syncedContentHash = record.contentHash
  }
}

/**
 * Push the melodies: a MusicXML file in the songs folder for each melody that is new, or made
 * again here, linked to its song by its properties. A melody whose song is not on this device is
 * left (it was pulled for a song that has not come yet, or the song was deleted).
 */
export async function pushScores(
  run: SyncRun,
  progressCallback: ProgressCallback | null = null
): Promise<void> {
  const created: ScoreUpload[] = []
  const updated: ScoreUpload[] = []
  const songs = new Map((await run.db.getAllSongs()).map(song => [songUuidOf(song), song]))
  for (const record of await run.db.getAllScores()) {
    const song = songs.get(record.uuid)
    if (!song) continue
    const gone = !!record.fileRef && !run.fileExistsInDrive(record.fileRef)
    if (record.fileRef && !gone && !scoreHasLocalChanges(record) && !record.legacyFile) continue
    const upload = {
      record,
      song,
      body: run.space.bytes ? await writeMxl(record.xml) : record.xml,
    }
    if (record.fileRef && !gone) updated.push(upload)
    else {
      // (its file is gone from Drive, or it never had one: a new file)
      record.fileRef = null
      record.fileRev = null
      record.fileModified = null
      created.push(upload)
    }
  }
  const total = created.length + updated.length
  if (total === 0) return
  const report = (uploaded: number) =>
    progressCallback?.({
      stage: 'pushing',
      message: `Uploaded ${uploaded}/${total} melodies`,
      current: uploaded,
      total,
    })
  report(0)

  const metadata = (upload: ScoreUpload) =>
    scoreFileMetadata(upload.record, upload.song, {
      spaceId: run.spaceId,
      bytes: run.space.bytes,
    })
  const recordBatch = async (batch: ScoreUpload[], results: (WriteResult | null)[]) => {
    const saved: ScoreRecord[] = []
    batch.forEach((upload, j) => {
      const result = results[j]
      if (!result) return
      recordScoreUpload(upload, result)
      saved.push(upload.record)
    })
    if (saved.length > 0) await run.db.saveScoresSent(saved)
    return saved.length
  }
  const write = (upload: ScoreUpload) =>
    upload.record.fileRef
      ? run.space.update(upload.record.fileRef, updateInput(metadata(upload), 'score'), upload.body)
      : run.space.create('songs', fileInput(metadata(upload)), upload.body)
  const uploadOne = async (upload: ScoreUpload) => {
    recordScoreUpload(upload, await write(upload))
    await run.db.saveScoresSent([upload.record])
  }
  // (a space that holds bytes has no batch call for them: one request a file, together, and one that
  // failed is null, as in a batch)
  const writeTogether = (batch: ScoreUpload[]) =>
    Promise.all(
      batch.map(upload =>
        write(upload).catch(error => {
          console.error(`[DriveSync] Failed to upload ${describe(upload)}:`, error)
          return null
        })
      )
    )
  const describe = ({ record }: ScoreUpload) => `the melody of song ${record.uuid}`

  const uploaded = await uploadInBatches(created, BATCH_SIZE, {
    uploadBatch: async batch =>
      recordBatch(
        batch,
        run.space.bytes
          ? await writeTogether(batch)
          : await run.space.createMany(
              'songs',
              batch.map(upload => ({
                input: fileInput(metadata(upload)),
                body: upload.body as string,
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
        run.space.bytes
          ? await writeTogether(batch)
          : await run.space.updateMany(
              batch.map(upload => ({
                ref: upload.record.fileRef as string,
                input: updateInput(metadata(upload), 'score'),
                body: upload.body as string,
              }))
            )
      ),
    uploadOne,
    describe,
    onProgress: count => report(uploaded + count),
  })
}
