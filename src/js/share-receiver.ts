/**
 * Opening a share link (docs/SHARING.md, "Opening a link"): download the encrypted file from
 * the worker, decrypt it with the key from the link, and keep it on this device. Received
 * setlists go in one database of their own, "Shared with me" (a local-only space: it
 * is never synced), with their songs the way a space's are, so the setlist page can
 * show them.
 *
 * A setlist is kept only while its share lasts: it goes when the share ends or expires, or
 * when the user joins the space it came from. Its songs stay: everything a user has
 * seen is theirs to keep.
 */

import type { ReceivedShare, Setlist, SetlistEntry } from './data-types.ts'
import { ChordlessDB } from './db.ts'
import { isExpired, type ShareBundle } from './share-bundle.ts'
import { decryptBundle, matchesSetlistCode } from './share-crypto.ts'
import { addChart } from './song-utils.ts'
import { getCurrentSpace, listSpaces } from './space.ts'
import { toLocalDateString } from './utils/date-utils.ts'

/** The database of received setlists and their songs (one for all shares) */
export const SHARED_DB_ID = 'shared-with-me'

/** Before there was one database for all shares, each had its own, with this prefix */
export const LEGACY_SHARE_DB_PREFIX = 'chordless-share-'

/** The id of a share's setlist in the shared database */
export const shareSetlistId = (fileId: string) => `share-${fileId}`

export type ShareOpening =
  /** `db` holds the setlist to show; `fresh` if this open downloaded it */
  | { state: 'ready'; db: ChordlessDB; setlist: Setlist; fresh: boolean }
  /** Stopped, expired or removed: the setlist is gone from this device (its songs stay) */
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

function deleteDatabase(name: string): Promise<void> {
  return new Promise(resolve => {
    const request = indexedDB.deleteDatabase(name)
    // Blocked by an open connection: it goes when that closes. Nothing more to do here.
    request.onsuccess = request.onerror = request.onblocked = () => resolve()
  })
}

/** Whether a database exists, so that looking doesn't make it (true if the browser can't say) */
export async function databaseExists(name: string): Promise<boolean> {
  if (typeof indexedDB.databases !== 'function') return true
  return (await indexedDB.databases()).some(database => database.name === name)
}

/** Remove a received setlist from this device, with its state here; its songs stay */
async function forgetSetlist(db: ChordlessDB, fileId: string): Promise<void> {
  await db.deleteSetlist(shareSetlistId(fileId))
  await db.deleteLocalState(shareSetlistId(fileId))
}

/**
 * Delete a share's setlist from this device (its songs stay)
 * @param db the shared database, if the caller has it open
 */
export async function forgetShare(fileId: string, db?: ChordlessDB): Promise<void> {
  if (db) return forgetSetlist(db, fileId)
  if (!(await databaseExists(SHARED_DB_ID))) return
  const own = new ChordlessDB(SHARED_DB_ID)
  await own.init()
  try {
    await forgetSetlist(own, fileId)
  } finally {
    own.db?.close()
  }
}

/**
 * Put a received bundle into the database: its setlist, replacing the earlier copy of this
 * share's, and its songs. A song this device already has the chart of is reused; one that is
 * new is added, as the default of its song if the song is already here in another form.
 */
async function store(db: ChordlessDB, bundle: ShareBundle, received: ReceivedShare) {
  const now = new Date().toISOString()
  const entries: SetlistEntry[] = []

  for (const [index, song] of bundle.setlist.songs.entries()) {
    // Newest chart is the default for its song; the ones before stay as variants
    const record = await addChart(db, song.chordpro, {
      variantLabel: 'Shared',
      importSource: 'share',
      makeDefault: 'newest',
      title: song.title,
    })
    entries.push({
      order: index,
      songId: record.id,
      songUuid: record.uuid,
      key: song.key,
      tempo: song.tempo,
      notes: song.notes,
    })
  }

  const setlist: Setlist = {
    id: shareSetlistId(received.fileId),
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
  const db = new ChordlessDB(SHARED_DB_ID)
  await db.init()
  const kept = await db.getSetlist(shareSetlistId(fileId))
  const known = kept?.received

  /** Nothing of this share stays (its songs do), and the database is let go */
  const ended = async (): Promise<ShareOpening> => {
    if (kept) await forgetSetlist(db, fileId)
    db.db?.close()
    return { state: 'ended' }
  }
  /** The setlist isn't going to be shown, and wasn't kept before either */
  const empty = (state: ShareOpening): ShareOpening => {
    db.db?.close()
    return state
  }

  if (known && isExpired(known.expires, today)) return ended()

  const key = keyFromLink || known?.key || ''
  if (!key) return empty({ state: 'needs-key' })

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
    return empty({ state: 'unavailable', offline: true })
  }

  if (response.status === 404) return ended()
  if (response.status === 304 && kept) return { state: 'ready', db, setlist: kept, fresh: false }
  if (!response.ok) {
    if (kept) return { state: 'ready', db, setlist: kept, fresh: false }
    return empty({ state: 'unavailable', offline: false })
  }

  // Something other than the file (an error page from a proxy, say) isn't a bad key
  if (!response.headers.get('Content-Type')?.startsWith('application/octet-stream')) {
    if (kept) return { state: 'ready', db, setlist: kept, fresh: false }
    return empty({ state: 'unavailable', offline: false })
  }

  let bundle: ShareBundle
  try {
    bundle = await decryptBundle(key, new Uint8Array(await response.arrayBuffer()))
  } catch {
    // A wrong key can't have worked before: this link doesn't open it
    return empty({ state: 'bad-key' })
  }
  if (isExpired(bundle.expires, today)) return ended()

  const setlist = await store(db, bundle, {
    fileId,
    key,
    etag: response.headers.get('ETag') ?? '',
    expires: bundle.expires,
    ...(bundle.setlistId && { setlistId: bundle.setlistId }),
  })
  return { state: 'ready', db, setlist, fresh: true }
}

/**
 * The id of the current space's setlist that a link's setlist code is of, if it has one:
 * a member of the space has the real setlist, so the link has no need to be opened.
 * (Not made to look for it: with no space yet, there is none.)
 */
export async function ownSetlistFor(code: string): Promise<string | null> {
  const { id } = getCurrentSpace()
  if (!id || !(await databaseExists(id))) return null
  const db = new ChordlessDB(id)
  try {
    await db.init()
    const setlists = await db.getAllSetlists()
    return setlists.find(setlist => matchesSetlistCode(code, setlist.id))?.id ?? null
  } catch (error) {
    console.error('[Share] Could not look for the setlist in the space:', error)
    return null
  } finally {
    db.db?.close()
  }
}

/** What tidySharedWithMe did */
export interface Tidied {
  /** Setlists removed because their share had expired */
  expired: number
  /** Setlists removed because the user's space has them now */
  joined: number
}

/**
 * Tidy what has been received, at start-up and when the list is shown:
 * - delete the per-share databases from before there was one (their setlists were only ever
 *   copies of shares: opening the link again brings them back)
 * - delete received setlists whose share has expired
 * - delete received setlists the user now has in a space (they joined it, and sync
 *   gave them the setlist for good): the share's setlistId matches one of the space's setlists
 *
 * Songs are never deleted.
 *
 * @param spaceIds the spaces to look for setlists in (default: all this device has)
 */
export async function tidySharedWithMe({
  today = toLocalDateString(new Date()),
  spaceIds,
}: {
  today?: string
  spaceIds?: string[]
} = {}): Promise<Tidied> {
  const tidied: Tidied = { expired: 0, joined: 0 }
  if (typeof indexedDB.databases === 'function') {
    for (const { name } of await indexedDB.databases()) {
      if (name?.startsWith(LEGACY_SHARE_DB_PREFIX)) await deleteDatabase(name)
    }
  }
  if (!(await databaseExists(SHARED_DB_ID))) return tidied

  const db = new ChordlessDB(SHARED_DB_ID)
  await db.init()
  try {
    const received = (await db.getAllSetlists()).filter(setlist => setlist.received)
    if (received.length === 0) return tidied

    const ids = spaceIds ?? (await listSpaces()).map(space => space.id)
    const have = new Set<string>()
    for (const id of ids) {
      if (!(await databaseExists(id))) continue
      const spaceDb = new ChordlessDB(id)
      try {
        await spaceDb.init()
        for (const setlist of await spaceDb.getAllSetlists()) {
          have.add(setlist.id)
        }
      } catch (error) {
        console.error('[Share] Could not look in a space for a received setlist:', error)
      } finally {
        spaceDb.db?.close()
      }
    }

    for (const setlist of received) {
      const share = setlist.received as ReceivedShare
      if (isExpired(share.expires, today)) {
        await forgetSetlist(db, share.fileId)
        tidied.expired++
      } else if (share.setlistId && have.has(share.setlistId)) {
        await forgetSetlist(db, share.fileId)
        tidied.joined++
      }
    }
  } catch (error) {
    console.error('[Share] Could not tidy the received setlists:', error)
  } finally {
    db.db?.close()
  }
  return tidied
}

/** The setlists received and still current, newest first, for the home page (tidies first) */
export async function listSharedWithMe(): Promise<Setlist[]> {
  await tidySharedWithMe()
  if (!(await databaseExists(SHARED_DB_ID))) return []
  const db = new ChordlessDB(SHARED_DB_ID)
  await db.init()
  try {
    return (await db.getAllSetlists())
      .filter(setlist => setlist.received)
      .sort((a, b) => b.date.localeCompare(a.date))
  } finally {
    db.db?.close()
  }
}
