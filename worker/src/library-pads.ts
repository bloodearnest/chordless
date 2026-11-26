/**
 * A library's pad sets (docs/CENTRAL_STORAGE.md, step 6): a church's or a person's own. The list of sets, with their
 * names, is a JSON column of the library's row in D1 (`libraries.pad_sets`); the audio is private R2, `library/<library>/pads/<set>/<key>.mp3`, streamed to
 * the device and kept nowhere else. The routes and their rules are a team space's (team-pads.ts): any member reads and
 * adds, a set or a key already there is replaced only by an admin, and a person in their own library is its admin. What
 * is new is where the sets are kept: this is the `PadStorage` for R2.
 *
 *   /api/(libraries|teams)/<id>/pads…   as /api/space/<id>/pads…
 */
import { PAD_FILE_KEYS } from '../../src/js/pad-keys.ts'
import type { PadFileEntry, PadSetEntry, PadStorage } from '../../src/js/storage/types.ts'
import type { TeamRole } from '../../src/js/team-roles.ts'
import { ulid } from '../../src/js/ulid.ts'
import type { D1Db } from './d1.ts'
import type { Env, SongBucket } from './env.ts'
import { Refusal, refusing } from './http.ts'
import { authorizeLibrary } from './library-songs.ts'
import { handlePadRequest } from './team-pads.ts'

const PATH = /^\/api\/(libraries|teams)\/([A-Za-z0-9_-]{1,64})\/(?:library\/)?(pads(?:\/.*)?)$/
export const isLibraryPadPath = (path: string) => PATH.test(path)

/** A file's ref is its set and its key: `<set>:<key>` */
const fileRef = (set: string, key: string) => `${set}:${key}`
const SET_ID = /^[A-Za-z0-9_-]{1,64}$/

/** A pad set as the library keeps it (its audio is in R2) */
interface PadSetRecord {
  id: string
  name: string
  modifiedAt: string
}

/** The most pad sets a library keeps: they are a list in one row */
const MAX_SETS = 200

class LibraryPads implements PadStorage {
  #db: D1Db
  #bucket: SongBucket
  #library: string

  constructor(db: D1Db, bucket: SongBucket, library: string) {
    this.#db = db
    this.#bucket = bucket
    this.#library = library
  }

  #prefix(set: string) {
    return `library/${this.#library}/pads/${set}/`
  }

  /** The library's sets, and the version they were read at */
  async #sets(): Promise<{ sets: PadSetRecord[]; version: number }> {
    // (the library is one the person was let into, so it is there)
    const row = (await this.#db
      .prepare('SELECT pad_sets, pad_sets_version FROM libraries WHERE library_id = ?')
      .bind(this.#library)
      .first<{ pad_sets: string; pad_sets_version: number }>()) as {
      pad_sets: string
      pad_sets_version: number
    }
    return { sets: JSON.parse(row.pad_sets), version: row.pad_sets_version }
  }

  /**
   * Change the list of sets from the version it was read at, and again from the new one if another request wrote first
   * (a name is unique in the list: the change is given the list as it is, and says what it makes of it)
   */
  async #change<T>(
    change: (sets: PadSetRecord[]) => { sets: PadSetRecord[]; result: T }
  ): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      const { sets, version } = await this.#sets()
      const next = change(sets)
      if (next.sets === sets) return next.result
      const written = await this.#db
        .prepare(
          'UPDATE libraries SET pad_sets = ?, pad_sets_version = pad_sets_version + 1 WHERE library_id = ? AND pad_sets_version = ?'
        )
        .bind(JSON.stringify(next.sets), this.#library, version)
        .run()
      /* v8 ignore next 4 -- the version moved under it: another request wrote first, and five times in a row is rarer */
      if (written.meta.changes) return next.result
      if (attempt === 5) throw new Refusal(409, 'The pad sets are being changed: try again')
    }
  }

  /** Whether the set is one of this library's */
  async hasSet(set: string): Promise<boolean> {
    if (!SET_ID.test(set)) return false
    return (await this.#sets()).sets.some(each => each.id === set)
  }

  async listSets(): Promise<PadSetEntry[]> {
    return (await this.#sets()).sets
      .map(each => ({ ref: each.id, name: each.name, modified: each.modifiedAt }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  async ensureSet(name: string): Promise<string> {
    return this.#change(sets => {
      const there = sets.find(each => each.name === name)
      if (there) return { sets, result: there.id }
      if (sets.length >= MAX_SETS)
        throw new Refusal(400, 'This library has as many pad sets as it may')
      const id = ulid()
      return {
        sets: [...sets, { id, name, modifiedAt: new Date().toISOString() }],
        result: id,
      }
    })
  }

  async listFiles(set: string): Promise<PadFileEntry[]> {
    // (the routes ask only about a set that is the library's)
    const prefix = this.#prefix(set)
    const { objects } = await this.#bucket.list({ prefix })
    return objects.map(object => {
      const key = object.key.slice(prefix.length, -'.mp3'.length)
      return {
        ref: fileRef(set, key),
        name: `${key}.mp3`,
        padKey: key,
        type: 'audio/mpeg',
        size: object.size,
      }
    })
  }

  async addFile(set: string, padKey: string, audio: Blob): Promise<void> {
    await this.#bucket.put(`${this.#prefix(set)}${padKey}.mp3`, audio, {
      httpMetadata: { contentType: 'audio/mpeg' },
    })
    await this.#touch(set)
  }

  async trashFiles(set: string): Promise<void> {
    // (R2 has no bin: what an admin replaces is gone, and is loaded again)
    const { objects } = await this.#bucket.list({ prefix: this.#prefix(set) })
    if (objects.length) await this.#bucket.delete(objects.map(object => object.key))
    await this.#touch(set)
  }

  async #object(ref: string) {
    const [set, key] = ref.split(':')
    if (!set || !key || !(await this.hasSet(set)) || !PAD_FILE_KEYS.some(each => each === key))
      return null
    return this.#bucket.get(`${this.#prefix(set)}${key}.mp3`)
  }

  /* v8 ignore start -- the routes stream a file; this is the rest of the interface */
  async read(ref: string): Promise<ArrayBuffer> {
    return new Response(await this.readStream(ref)).arrayBuffer()
  }
  /* v8 ignore stop */

  async readStream(ref: string): Promise<ReadableStream<Uint8Array>> {
    const object = await this.#object(ref)
    if (!object) throw new Refusal(404, 'No such file')
    return object.body
  }

  async #touch(set: string) {
    const modifiedAt = new Date().toISOString()
    await this.#change(sets => ({
      sets: sets.map(each => (each.id === set ? { ...each, modifiedAt } : each)),
      result: undefined,
    }))
  }

  /** Whether a ref (a set's or a file's) is this library's */
  owns(ref: string): Promise<boolean> {
    return this.hasSet(ref.split(':')[0])
  }
}

export function handleLibraryPads(request: Request, env: Env): Promise<Response> {
  const answer = refusing(async () => {
    // (the router sends only paths that match)
    const match = PATH.exec(new URL(request.url).pathname) as RegExpExecArray
    const [, scope, scopeId, rest] = match
    const { db, bucket, libraryId, permitted } = await authorizeLibrary(
      request,
      env,
      scope,
      scopeId
    )
    const pads = new LibraryPads(db, bucket, libraryId)
    // (a person in their own library is its admin; in a church's, the role is the person's)
    const role: TeamRole = permitted.account_id !== null ? 'admin' : (permitted.role as TeamRole)
    const response = await handlePadRequest(request, `/${rest}`, {
      pads,
      role,
      owned: ref => pads.owns(ref),
    })
    return response ?? new Response(JSON.stringify({ error: 'Not found' }), { status: 404 })
  })
  // The audio is the person's own and kept by the device, not by anything on the way
  return answer.then(response => {
    const headers = new Headers(response.headers)
    headers.set('Cache-Control', 'private, no-store')
    headers.append('Vary', 'Authorization')
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  })
}
