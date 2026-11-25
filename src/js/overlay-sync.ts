/**
 * What a person keeps for themselves, synced through their account (docs/PERSONAL_LAYER.md, docs/CENTRAL_STORAGE.md
 * step 5): the overlay of each setlist (its state and private annotations, the songs added for oneself), of each
 * song (the capo, sections and pad set chosen for it) and the settings that describe the person, as
 * `personal-layer.ts` lists them for an export. The media player's state is not here, nor is anything of the device.
 *
 * Nothing watches what the page writes. Each sync reads what this device keeps and sets it against what it last
 * sent or took (a hash and a version for each item, kept beside), and sends what changed here and takes what changed
 * elsewhere. An item changed in both places keeps what is here, which is the person's latest act on this device and is
 * sent over the other. An item the server no longer shows (the person left the church) is kept here and left alone.
 * A page that is open reads its state when it loads, so what arrives shows at the next load.
 */
import type { SetlistEntry } from './data-types.ts'
import type { ChordlessDB } from './db.ts'
import { PERSONAL_PREFERENCE_KEYS } from './personal-preference-keys.ts'
import { sha256Hex } from './utils/bytes.ts'
import { callWorker, type WorkerConnection } from './worker-call.ts'

/** What each item is called here: `setlist:<id>`, `song:<uuid>` or `preferences` */
type ItemKey = string

interface Remote {
  version: number
  body: Record<string, unknown>
}

interface Seen {
  version: number
  hash: string
}

type Snapshot = Record<ItemKey, Seen>

interface ServerOverlays {
  preferences: Remote | null
  setlists: (Remote & { setlistId: string })[]
  songs: (Remote & { libraryId: string; songUuid: string })[]
}

type Op = Record<string, unknown>

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
  /** The personal library, which the songs of this space are in */
  libraryId: string
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

/** How the Worker names an item */
const wire = (key: ItemKey, libraryId: string): Op => {
  if (key === 'preferences') return { kind: 'preferences' }
  if (key.startsWith('setlist:'))
    return { kind: 'setlist', setlistId: key.slice('setlist:'.length) }
  return { kind: 'song', libraryId, songUuid: key.slice('song:'.length) }
}

function remoteItems(data: ServerOverlays, libraryId: string): Map<ItemKey, Remote> {
  const items = new Map<ItemKey, Remote>()
  if (data.preferences) items.set('preferences', data.preferences)
  for (const each of data.setlists) items.set(`setlist:${each.setlistId}`, each)
  for (const each of data.songs)
    if (each.libraryId === libraryId) items.set(`song:${each.songUuid}`, each)
  return items
}

/** What a sync did */
export interface OverlaySyncReport {
  sent: number
  taken: number
}

/** Sync what the person keeps for themselves for a moved Personal space (see the top) */
export async function syncOverlays(input: OverlayInput): Promise<OverlaySyncReport> {
  const { db, libraryId, connection, storage = localStorage } = input
  const remote = remoteItems(
    (await (
      await callWorker({ path: '/api/account/overlays' }, connection)
    ).json()) as ServerOverlays,
    libraryId
  )
  const local = await collect(input)
  const seen = loadSnapshot(storage, db.spaceId)
  const report: OverlaySyncReport = { sent: 0, taken: 0 }
  const sends: { key: ItemKey; op: Op; hash: string | null }[] = []

  for (const key of new Set([...remote.keys(), ...local.keys(), ...Object.keys(seen)])) {
    const there = remote.get(key)
    const here = local.get(key)
    const before = seen[key]
    if (here && before?.hash !== here.hash) {
      // changed here (or never sent): it goes over what is there
      sends.push({
        key,
        hash: here.hash,
        op: {
          ...wire(key, libraryId),
          op: 'put',
          baseVersion: there?.version ?? null,
          body: here.body,
        },
      })
    } else if (!here && before && there) {
      // kept here before, and now nothing: removed here
      sends.push({
        key,
        hash: null,
        op: { ...wire(key, libraryId), op: 'delete', baseVersion: there.version },
      })
    } else if (there && before?.version !== there.version) {
      // changed elsewhere, and not here: take it
      if (await take(input, key, there.body)) {
        const taken = (await collect(input)).get(key)
        seen[key] = { version: there.version, hash: taken?.hash ?? '' }
        report.taken++
      }
    } else if (!there && before) {
      delete seen[key]
    }
  }

  for (let from = 0; from < sends.length; from += 100) {
    const batch = sends.slice(from, from + 100)
    const response = await callWorker(
      {
        method: 'POST',
        path: '/api/account/overlays/batch',
        body: { ops: batch.map(each => each.op) },
      },
      connection
    )
    const { results } = (await response.json()) as {
      results: { status: string; version?: number }[]
    }
    batch.forEach((each, index) => {
      const result = results[index]
      if (result?.status !== 'ok') return
      report.sent++
      if (each.hash === null) delete seen[each.key]
      else seen[each.key] = { version: result.version as number, hash: each.hash }
    })
  }
  storage.setItem(snapshotKey(db.spaceId), JSON.stringify(seen))
  return report
}
