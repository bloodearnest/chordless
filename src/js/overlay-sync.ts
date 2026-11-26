/**
 * What a person keeps for themselves, synced through their account (docs/PERSONAL_LAYER.md, docs/CENTRAL_STORAGE.md
 * step 5): the overlay of each setlist (its state and private annotations, the songs added for oneself), of each
 * song (the capo, sections and pad set chosen for it) and the settings that describe the person, as
 * `personal-layer.ts` lists them for an export. The media player's state is not here, nor is anything of the device.
 *
 * Nothing watches what the page writes. Each sync reads what this device keeps and sets it against what it last
 * sent or took (a hash for each item, kept beside), and sends what changed here and takes what changed
 * elsewhere. An item changed in both places keeps what is here, which is the person's latest act on this device and is
 * sent over the other. An item the server no longer shows (the person left the church) is kept here and left alone.
 * A page that is open reads its state when it loads, so what arrives shows at the next load.
 */
import type { SetlistEntry } from './data-types.ts'
import type { ChordlessDB } from './db.ts'
import { PERSONAL_PREFERENCE_KEYS } from './personal-preference-keys.ts'
import { sha256Hex } from './utils/bytes.ts'
import { callWorker, TeamError, type WorkerConnection } from './worker-call.ts'

/** What each item is called here: `setlist:<id>`, `song:<uuid>` or `preferences` */
type ItemKey = string

/** The server's document (worker/src/overlays.ts): the settings, and the overlay of each setlist and song */
interface Document {
  settings: Record<string, string>
  setlists: Record<string, Record<string, unknown>>
  songs: Record<string, Record<string, unknown>>
}

interface Remote {
  version: number
  body: Document
}

/** What each item was when this device last sent or took it (a hash): the way to tell which side changed since */
type Snapshot = Record<ItemKey, string>

/** The parts of the browser's storage this uses (a test gives its own) */
type KeyValues = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

const snapshotKey = (spaceId: string) => `overlay-sync-${spaceId}`
const stateKey = (setlistId: string) => `state-${setlistId}`
const songPrefsKey = (spaceId: string) => `song-prefs-${spaceId}`

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function readJson(storage: KeyValues, key: string): unknown {
  try {
    const text = storage.getItem(key)
    return text === null ? undefined : JSON.parse(text)
  } catch {
    return undefined
  }
}

function loadSnapshot(storage: KeyValues, spaceId: string): Snapshot {
  const value = readJson(storage, snapshotKey(spaceId))
  return isRecord(value) ? (value as Snapshot) : {}
}

interface Local {
  body: Record<string, unknown>
  hash: string
}

export interface OverlayInput {
  db: ChordlessDB
  connection: WorkerConnection
  storage?: KeyValues
}

/** What this device keeps for the space, by item: nothing for an item it keeps nothing of */
async function collect({ db, storage = localStorage }: OverlayInput): Promise<Map<ItemKey, Local>> {
  const items = new Map<ItemKey, Local>()
  const add = async (key: ItemKey, body: Record<string, unknown>) =>
    items.set(key, { body, hash: await sha256Hex(JSON.stringify(body)) })

  for (const setlist of await db.getAllSetlists()) {
    const state = readJson(storage, stateKey(setlist.id))
    const local = setlist.songs.filter(entry => entry.local)
    if (state === undefined && local.length === 0) continue
    await add(`setlist:${setlist.id}`, {
      ...(state === undefined ? {} : { state }),
      ...(local.length > 0 ? { local } : {}),
    })
  }

  const prefs = readJson(storage, songPrefsKey(db.spaceId))
  if (isRecord(prefs)) {
    const uuids = songUuids(await db.getAllSongs())
    for (const [songId, kept] of Object.entries(prefs)) {
      const uuid = uuids.get(songId)
      if (uuid && isRecord(kept) && Object.keys(kept).length > 0) await add(`song:${uuid}`, kept)
    }
  }

  const preferences: Record<string, string> = {}
  for (const key of PERSONAL_PREFERENCE_KEYS) {
    const value = storage.getItem(key)
    if (value !== null) preferences[key] = value
  }
  if (Object.keys(preferences).length > 0) await add('preferences', preferences)
  return items
}

/** The song a song's id names, for the server: the default variant's (the id is shared by its variants) */
function songUuids(songs: { id: string; uuid: string; isDefault: boolean }[]): Map<string, string> {
  const uuids = new Map<string, string>()
  for (const song of songs) if (song.isDefault || !uuids.has(song.id)) uuids.set(song.id, song.uuid)
  return uuids
}

/** Put what the server holds for an item here, in place of what is kept; false if it could not be (yet) */
async function take(
  { db, storage = localStorage }: OverlayInput,
  key: ItemKey,
  body: Record<string, unknown>
): Promise<boolean> {
  const [kind, id] = [key.split(':')[0], key.slice(key.indexOf(':') + 1)]
  if (kind === 'setlist') {
    const setlist = await db.getSetlist(id)
    // (a setlist this device has not received yet: its overlay is taken when it has)
    if (!setlist) return false
    if (body.state === undefined) storage.removeItem(stateKey(id))
    else storage.setItem(stateKey(id), JSON.stringify(body.state))
    const local = Array.isArray(body.local) ? (body.local as SetlistEntry[]) : []
    const kept = setlist.songs.filter(entry => !entry.local)
    const same =
      JSON.stringify(setlist.songs.filter(entry => entry.local)) === JSON.stringify(local)
    if (!same)
      await db.saveSetlist({
        ...setlist,
        songs: [...kept, ...local].map((entry, order) => ({ ...entry, order })),
      })
    return true
  }
  if (kind === 'song') {
    const song = (await db.getAllSongs()).find(each => each.uuid === id)
    if (!song) return false
    const all = readJson(storage, songPrefsKey(db.spaceId))
    const next = { ...(isRecord(all) ? all : {}), [song.id]: body }
    storage.setItem(songPrefsKey(db.spaceId), JSON.stringify(next))
    return true
  }
  for (const preference of PERSONAL_PREFERENCE_KEYS) {
    const value = body[preference]
    if (typeof value === 'string') storage.setItem(preference, value)
  }
  return true
}

/** The document's items by key: `preferences`, `setlist:<id>` and `song:<uuid>` */
function itemsOf(document: Document): Map<ItemKey, Record<string, unknown>> {
  const items = new Map<ItemKey, Record<string, unknown>>()
  if (Object.keys(document.settings).length) items.set('preferences', document.settings)
  for (const [id, body] of Object.entries(document.setlists)) items.set(`setlist:${id}`, body)
  for (const [id, body] of Object.entries(document.songs)) items.set(`song:${id}`, body)
  return items
}

/** Put an item in the document, or take it out (a document of nothing for the settings is no settings) */
function place(document: Document, key: ItemKey, body: Record<string, unknown> | null) {
  if (key === 'preferences') document.settings = (body ?? {}) as Record<string, string>
  else {
    const into = key.startsWith('setlist:') ? document.setlists : document.songs
    const id = key.slice(key.indexOf(':') + 1)
    if (body) into[id] = body
    else delete into[id]
  }
}

const hashOf = (body: Record<string, unknown>) => sha256Hex(JSON.stringify(body))

/** What a sync did */
export interface OverlaySyncReport {
  sent: number
  taken: number
}

/** The most times a sync goes again, when another device wrote first */
const ATTEMPTS = 3

/** Sync what the person keeps for themselves for a moved Personal space (see the top) */
export async function syncOverlays(input: OverlayInput): Promise<OverlaySyncReport> {
  const { db, connection, storage = localStorage } = input
  const seen = loadSnapshot(storage, db.spaceId)
  const report: OverlaySyncReport = { sent: 0, taken: 0 }

  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const remote = (await (
      await callWorker({ path: '/api/account/overlays' }, connection)
    ).json()) as Remote
    const there = itemsOf(remote.body)
    const local = await collect(input)
    const document = structuredClone(remote.body)
    const pushed: [ItemKey, string | null][] = []
    let taken = 0

    for (const key of new Set([...there.keys(), ...local.keys(), ...Object.keys(seen)])) {
      const here = local.get(key)
      const remoteBody = there.get(key)
      const before = seen[key] ?? null
      const remoteHash = remoteBody ? await hashOf(remoteBody) : null
      if ((here?.hash ?? null) !== before) {
        // changed here (or never sent): it goes over what is there, or takes it away
        place(document, key, here?.body ?? null)
        pushed.push([key, here?.hash ?? null])
      } else if (remoteHash !== before) {
        // changed elsewhere, and not here: take it (what the server stopped showing is kept here, and forgotten)
        if (!remoteBody) delete seen[key]
        else if (await take(input, key, remoteBody)) {
          seen[key] = (await collect(input)).get(key)?.hash ?? ''
          taken++
        }
      }
    }

    if (!pushed.length) {
      storage.setItem(snapshotKey(db.spaceId), JSON.stringify(seen))
      return { ...report, taken: report.taken + taken }
    }
    try {
      await callWorker(
        {
          method: 'PUT',
          path: '/api/account/overlays',
          body: { baseVersion: remote.version, body: document },
        },
        connection
      )
    } catch (error) {
      // (another device wrote first: read what is there now, and go again)
      if (error instanceof TeamError && error.status === 409) continue
      throw error
    }
    for (const [key, hash] of pushed) {
      if (hash === null) delete seen[key]
      else seen[key] = hash
    }
    storage.setItem(snapshotKey(db.spaceId), JSON.stringify(seen))
    return { sent: pushed.length, taken: report.taken + taken }
  }
  throw new Error('The overlays keep changing on another device')
}
