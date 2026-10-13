/**
 * Opening a share link (docs/SHARING.md, "Opening a link"): download the encrypted file from
 * the worker, decrypt it with the key from the link, and keep it on this device, apart from
 * everything else. The copy is a database of its own (chordless-share-<fileId>) holding the
 * setlist and its songs the way an organisation's does, so the setlist page can show it.
 */

import type { ChordProRecord, ReceivedShare, Setlist, SetlistEntry } from './data-types.ts'
import { ChordlessDB, normalizeTitle } from './db.ts'
import { ChordProParser } from './parser.ts'
import { isExpired, type ShareBundle } from './share-bundle.ts'
import { decryptBundle } from './share-crypto.ts'
import { chartFields, hashText } from './song-utils.ts'
import { toLocalDateString } from './utils/date-utils.ts'

export const SHARE_DB_PREFIX = 'chordless-share-'

/** The id of the one setlist in a share's database */
export const SHARED_SETLIST_ID = 'shared'

export type ShareOpening =
  /** `db` holds the setlist to show; `fresh` if this open downloaded it */
  | { state: 'ready'; db: ChordlessDB; setlist: Setlist; fresh: boolean }
  /** Stopped, expired or removed: nothing is kept */
  | { state: 'ended' }
  /** The link has no key, and this device has none for it */
  | { state: 'needs-key' }
  /** The key doesn't open the file: the link was cut short or changed */
  | { state: 'bad-key' }
  /** Couldn't be reached, and there is no copy on this device yet */
  | { state: 'unavailable'; offline: boolean }

export interface OpenShareOptions {
  /** For tests */
  fetchFile?: typeof fetch
  today?: string
}

const databaseName = (fileId: string) => `${SHARE_DB_PREFIX}${fileId}`

function deleteDatabase(name: string): Promise<void> {
  return new Promise(resolve => {
    const request = indexedDB.deleteDatabase(name)
    // Blocked by an open connection: it goes when that closes. Nothing more to do here.
    request.onsuccess = request.onerror = request.onblocked = () => resolve()
  })
}

/** Delete a share's copy from this device */
export async function forgetShare(fileId: string): Promise<void> {
  await deleteDatabase(databaseName(fileId))
}

/** Put a received bundle into the database, replacing whatever was there */
async function store(db: ChordlessDB, bundle: ShareBundle, received: ReceivedShare) {
  const parser = new ChordProParser()
  await db.clearAll()
  const now = new Date().toISOString()
  const entries: SetlistEntry[] = []

  for (const [index, song] of bundle.setlist.songs.entries()) {
    const chordproFileId = `chordpro-${index}`
    const record: ChordProRecord = {
      id: chordproFileId,
      content: song.chordpro,
      contentHash: hashText(song.chordpro),
      createdDate: now,
      modifiedDate: now,
    }
    await db.saveChordPro(record)

    const metadata = parser.parse(song.chordpro).metadata
    const title = metadata.title || song.title
    const songId = `shared-song-${index}`
    await db.saveSong({
      uuid: songId,
      id: songId,
      variantOf: null,
      isDefault: true,
      variantLabel: 'Original',
      chordproFileId,
      ccliNumber: null,
      title,
      titleNormalized: normalizeTitle(title),
      ...chartFields(metadata),
      importDate: now,
      importUser: null,
      importSource: 'share',
      sourceUrl: null,
      modifiedDate: now,
      driveFileId: null,
      driveModifiedTime: null,
      lastSyncedAt: null,
      contentHash: record.contentHash,
    })
    entries.push({
      order: index,
      songId,
      songUuid: songId,
      key: song.key,
      tempo: song.tempo,
      notes: song.notes,
    })
  }

  const setlist: Setlist = {
    id: SHARED_SETLIST_ID,
    date: bundle.setlist.date,
    time: bundle.setlist.time,
    type: bundle.setlist.type,
    name: bundle.setlist.name,
    owner: bundle.setlist.owner,
    songs: entries,
    createdDate: now,
    modifiedDate: now,
    received,
  }
  await db.saveSetlist(setlist)
  return setlist
}

/**
 * Open a share: from this device if it has the copy, checking with the worker whether it
 * changed (an ETag makes that cheap); downloading it if not.
 *
 * @param keyFromLink the link's #fragment, if it has one; otherwise the key kept from before
 */
export async function openShare(
  fileId: string,
  keyFromLink: string,
  { fetchFile = fetch, today = toLocalDateString(new Date()) }: OpenShareOptions = {}
): Promise<ShareOpening> {
  const db = new ChordlessDB(databaseName(fileId))
  await db.init()
  const kept = (await db.getAllSetlists())[0]
  const known = kept?.received

  if (known && isExpired(known.expires, today)) {
    db.db?.close()
    await forgetShare(fileId)
    return { state: 'ended' }
  }

  const key = keyFromLink || known?.key || ''
  if (!key) {
    db.db?.close()
    await forgetShare(fileId)
    return { state: 'needs-key' }
  }

  // Ask for the file again only if the key is the one it was stored with
  const etag = known && known.key === key ? known.etag : ''
  let response: Response
  try {
    response = await fetchFile(`/api/share/${encodeURIComponent(fileId)}`, {
      headers: etag ? { 'If-None-Match': etag } : {},
    })
  } catch {
    // No connection: the copy on this device is what there is
    if (kept) return { state: 'ready', db, setlist: kept, fresh: false }
    db.db?.close()
    await forgetShare(fileId)
    return { state: 'unavailable', offline: true }
  }

  if (response.status === 404) {
    db.db?.close()
    await forgetShare(fileId)
    return { state: 'ended' }
  }
  if (response.status === 304 && kept) return { state: 'ready', db, setlist: kept, fresh: false }
  if (!response.ok) {
    if (kept) return { state: 'ready', db, setlist: kept, fresh: false }
    db.db?.close()
    await forgetShare(fileId)
    return { state: 'unavailable', offline: false }
  }

  // Something other than the file (an error page from a proxy, say) isn't a bad key
  if (!response.headers.get('Content-Type')?.startsWith('application/octet-stream')) {
    if (kept) return { state: 'ready', db, setlist: kept, fresh: false }
    db.db?.close()
    await forgetShare(fileId)
    return { state: 'unavailable', offline: false }
  }

  let bundle: ShareBundle
  try {
    bundle = await decryptBundle(key, new Uint8Array(await response.arrayBuffer()))
  } catch {
    // A wrong key can't have worked before: keep any earlier copy, but this link doesn't open it
    db.db?.close()
    if (!kept) await forgetShare(fileId)
    return { state: 'bad-key' }
  }
  if (isExpired(bundle.expires, today)) {
    db.db?.close()
    await forgetShare(fileId)
    return { state: 'ended' }
  }

  const setlist = await store(db, bundle, {
    fileId,
    key,
    etag: response.headers.get('ETag') ?? '',
    expires: bundle.expires,
  })
  return { state: 'ready', db, setlist, fresh: true }
}

/**
 * Delete the copies of shares that have ended, on this device. Run at start-up, so a share
 * that expired while the app was closed doesn't linger. Returns how many it deleted.
 */
export async function deleteExpiredShares(today = toLocalDateString(new Date())): Promise<number> {
  if (typeof indexedDB.databases !== 'function') return 0
  let deleted = 0
  for (const { name } of await indexedDB.databases()) {
    if (!name?.startsWith(SHARE_DB_PREFIX)) continue
    const db = new ChordlessDB(name)
    try {
      await db.init()
      const received = (await db.getAllSetlists())[0]?.received
      db.db?.close()
      if (!received || isExpired(received.expires, today)) {
        await deleteDatabase(name)
        deleted++
      }
    } catch (error) {
      console.error('[Share] Could not check a stored share:', name, error)
    }
  }
  return deleted
}
