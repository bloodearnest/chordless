/**
 * The storage API (types.ts) on Google Drive: a space is a folder, its collections are the
 * `songs/` and `setlists/` folders in it, a ref is a Drive file id, `props` are the file's
 * appProperties and `rev` is Drive's md5Checksum. Everything Drive-specific stays here and in
 * drive-client.ts: shared-drive flags, finding folders by name, a trashed file kept out of
 * listings, batches of uploads.
 */
import type { DriveFile } from '../data-types.ts'
import type { DriveApi } from '../drive-client.ts'
import { md5Hex } from '../utils/md5.ts'
import {
  type ChangeFeed,
  ChangeTokenLost,
  type Collection,
  type FileBody,
  type FileInput,
  type FileStatus,
  type PadFileEntry,
  type PadSetEntry,
  type PadStorage,
  type RootInfo,
  type SpaceChanges,
  type SpaceStorage,
  type StorageBackend,
  type StoredFile,
  type WriteResult,
} from './types.ts'

/** How many files a many-at-once call has in flight at a time */
const CONCURRENT_LIMIT = 10

/** Do `work` for each item, CONCURRENT_LIMIT at a time; null for one that failed */
async function inGroups<T, R>(items: T[], work: (item: T) => Promise<R>): Promise<(R | null)[]> {
  const results: (R | null)[] = []
  for (let i = 0; i < items.length; i += CONCURRENT_LIMIT) {
    const group = await Promise.allSettled(items.slice(i, i + CONCURRENT_LIMIT).map(work))
    for (const result of group) {
      if (result.status === 'fulfilled') results.push(result.value)
      else {
        console.error('[DriveStorage] A file in a group failed:', result.reason)
        results.push(null)
      }
    }
  }
  return results
}

/** A Drive file as the storage API shows it */
function toStored(file: DriveFile): StoredFile {
  return {
    ref: file.id,
    name: file.name ?? '',
    props: { ...file.appProperties },
    rev: file.md5Checksum ?? null,
    modified: file.modifiedTime ?? null,
    created: file.createdTime ?? null,
  }
}

/** The content type a file is sent with: text says it is UTF-8 */
function contentTypeOf(type: string): string {
  return type.startsWith('text/') && !type.includes('charset') ? `${type}; charset=utf-8` : type
}

/**
 * Whether Drive stored exactly the bytes sent: the md5Checksum it reports for the upload is the
 * MD5 of the content. Drive reports none for some files, which are taken to be intact.
 */
function holds(file: DriveFile, body: FileBody, what: string): boolean {
  if (typeof body !== 'string' || !file.md5Checksum || md5Hex(body) === file.md5Checksum) {
    return true
  }
  console.error(
    `[DriveStorage] Drive stored other content for ${what} than was sent: it is sent again next sync`
  )
  return false
}

/** Where a write goes, from what the engine says it is */
function writeMetadata(input: FileInput) {
  return { name: input.name, appProperties: input.props }
}

/**
 * The folders each space's folder had when its inventory last listed it, by the space's id: the
 * next inventory lists them together with the space's folder, not after it (a folder's folders are
 * only known from its listing, which made every inventory two calls deep). A folder that has gone
 * since is a listing nothing uses; one that is new is listed as before.
 */
const knownFolders = new Map<string, string[]>()

/** Forget them (tests: a new fake Drive reuses the ids of the last one) */
export function forgetKnownFolders(): void {
  knownFolders.clear()
}

class DriveSpace implements SpaceStorage {
  #api: DriveApi
  #rootRef: string
  #folders = new Map<Collection, string>()
  /**
   * What the last `inventory()` listed: the files of each folder of the space, and which folders
   * the space's own folder has (a name's ids). It serves `list()` and the lookup of the collections'
   * folders for the rest of the run, until a write: this object is the run's (the sync manager drops it
   * when the run ends), and a listing made a moment ago is the one a pull would make.
   */
  #listed = new Map<string, DriveFile[]>()
  #rootFolders: Map<string, string[]> | null = null

  constructor(api: DriveApi, rootRef: string) {
    this.#api = api
    this.#rootRef = rootRef
  }

  /** The collection's folder (made if it is not there yet), looked up once */
  async #folder(collection: Collection): Promise<string> {
    let id = this.#folders.get(collection)
    if (id === undefined) {
      id = this.#listedFolder(collection) ?? undefined
    }
    if (id === undefined) {
      id =
        collection === 'songs'
          ? await this.#api.getSongsFolder(this.#rootRef)
          : collection === 'setlists'
            ? await this.#api.getSetlistsFolder(this.#rootRef)
            : collection === 'people'
              ? await this.#api.getPeopleFolder(this.#rootRef)
              : await this.#api.getSharesFolder(this.#rootRef)
      this.#folders.set(collection, id)
    }
    return id
  }

  /** The collection's folder as the last inventory found it, if it found exactly one by that name */
  #listedFolder(collection: Collection): string | null {
    const ids = this.#rootFolders?.get(collection)
    return ids?.length === 1 ? ids[0] : null
  }

  /**
   * A write was made: the files the inventory listed are no longer what Drive has. (Which folders
   * the space has stand: a write makes one that was missing, and `#folders` knows it then.)
   */
  #forgetListings(): void {
    this.#listed.clear()
  }

  members() {
    return this.#api.listFolderPermissions(this.#rootRef)
  }

  readonly changes: ChangeFeed = {
    start: () => this.#api.getStartPageToken(),
    since: async token => {
      let result: Awaited<ReturnType<DriveApi['listChanges']>>
      try {
        result = await this.#api.listChanges(token)
      } catch (error) {
        // (Drive answers a position it does not know with 400, 404 or 410)
        const status = (error as { status?: number }).status
        if ([400, 404, 410].includes(status as number)) throw new ChangeTokenLost()
        throw error
      }
      // The space's folders tell which collection a changed file is in: listed once, and only when
      // there is a change (one that finds none is this call alone). Nothing is made: a collection
      // with no folder has no files
      const folders =
        result.changes.length === 0
          ? []
          : await this.#api.listDriveFiles(
              `'${this.#rootRef}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
            )
      const songs = folders.find(folder => folder.name === 'songs')?.id
      const setlists = folders.find(folder => folder.name === 'setlists')?.id
      const people = folders.find(folder => folder.name === 'people')?.id
      const inFolder = (parents: string[], folder: string | undefined) =>
        folder !== undefined && parents.includes(folder)
      const changed: SpaceChanges['changed'] = []
      const gone: string[] = []
      for (const { fileId, file } of result.changes) {
        const parents = file?.parents ?? []
        if (!file || file.trashed) gone.push(fileId)
        else if (inFolder(parents, songs) && file.mimeType === 'text/plain') {
          changed.push({ collection: 'songs', file: toStored(file) })
        } else if (inFolder(parents, setlists) && file.name?.includes('.json')) {
          changed.push({ collection: 'setlists', file: toStored(file) })
        } else if (inFolder(parents, people) && file.name?.includes('.json')) {
          changed.push({ collection: 'people', file: toStored(file) })
        } else {
          // (not live in a collection of this space: a file of another space, or one moved out)
          gone.push(fileId)
        }
      }
      return { token: result.nextToken, changed, gone }
    },
  }

  async list(collection: Collection): Promise<StoredFile[]> {
    // (a space nothing was ever shared from has no shares folder, and listing does not make one)
    const folder =
      collection === 'shares' ? await this.#sharesFolder() : await this.#folder(collection)
    if (!folder) return []
    // (the inventory has listed it, with the fields a listing has: this is what a listing would say)
    const listed = this.#listed.get(folder)
    if (listed) {
      const files =
        collection === 'shares'
          ? listed
          : collection === 'setlists'
            ? listed
                .filter(file => file.name?.includes('.json'))
                .sort((a, b) => (b.modifiedTime ?? '').localeCompare(a.modifiedTime ?? ''))
            : collection === 'people'
              ? listed.filter(file => file.name?.includes('.json'))
              : listed.filter(file => file.mimeType === 'text/plain')
      return files.map(toStored)
    }
    const live = `'${folder}' in parents and trashed=false`
    const files =
      collection === 'shares'
        ? await this.#api.listDriveFiles(live)
        : collection === 'setlists'
          ? await this.#api.listDriveFiles(`${live} and name contains '.json'`, 'modifiedTime desc')
          : collection === 'people'
            ? await this.#api.listDriveFiles(`${live} and name contains '.json'`)
            : await this.#api.listDriveFiles(`${live} and mimeType='text/plain'`)
    return files.map(toStored)
  }

  /** The shares folder, or null where there is none: from what is known of it, or asked of Drive (which does not make it) */
  async #sharesFolder(): Promise<string | null> {
    const known = this.#folders.get('shares')
    if (known) return known
    const ids = this.#rootFolders?.get('shares') ?? []
    if (this.#rootFolders && ids.length === 0) return null
    if (ids.length === 1) return ids[0]
    return this.#api.findSharesFolder(this.#rootRef)
  }

  async inventory(): Promise<Set<string>> {
    this.#forgetListings()
    this.#rootFolders = null
    const listings = new Map<string, DriveFile[]>()
    const refs = new Set<string>()
    // (the folders of a folder are listed together: the listing of each does not wait for the others)
    const list = (folderId: string) =>
      this.#api.listDriveFiles(`'${folderId}' in parents and trashed=false`)
    // (started now, with the first: one that is not a folder of this one is never read)
    const ahead = new Map<string, Promise<DriveFile[]>>()
    for (const folderId of knownFolders.get(this.#rootRef) ?? []) {
      const listing = list(folderId)
      listing.catch(() => undefined)
      ahead.set(folderId, listing)
    }
    const add = async (folderId: string): Promise<void> => {
      const folders: string[] = []
      const files = await (ahead.get(folderId) ?? list(folderId))
      listings.set(folderId, files)
      for (const file of files) {
        refs.add(file.id)
        if (file.mimeType === 'application/vnd.google-apps.folder') folders.push(file.id)
      }
      await Promise.all(folders.map(add))
    }
    await add(this.#rootRef)
    // (kept only once the whole of it is: a listing that failed leaves nothing half-known)
    this.#listed = listings
    const rootFolders = new Map<string, string[]>()
    for (const file of listings.get(this.#rootRef) ?? []) {
      if (file.mimeType !== 'application/vnd.google-apps.folder' || !file.name) continue
      rootFolders.set(file.name, [...(rootFolders.get(file.name) ?? []), file.id])
    }
    this.#rootFolders = rootFolders
    knownFolders.set(
      this.#rootRef,
      (listings.get(this.#rootRef) ?? [])
        .filter(file => file.mimeType === 'application/vnd.google-apps.folder')
        .map(file => file.id)
    )
    return refs
  }

  async status(ref: string): Promise<FileStatus | null> {
    const file = await this.#api.getFile(
      ref,
      'id,name,trashed,createdTime,modifiedTime,md5Checksum,appProperties'
    )
    return file ? { ...toStored(file), trashed: Boolean(file.trashed) } : null
  }

  readText(ref: string): Promise<string> {
    return this.#api.downloadFile(ref)
  }

  readMany(refs: string[]): Promise<(string | null)[]> {
    return inGroups(refs, ref => this.readText(ref))
  }

  async create(
    collection: Collection,
    input: FileInput,
    body: FileBody,
    options?: { publicLink?: boolean }
  ): Promise<WriteResult> {
    this.#forgetListings()
    const folder = await this.#folder(collection)
    const file = await this.#api.createFile(
      { ...writeMetadata(input), mimeType: input.type, parents: [folder] },
      body,
      contentTypeOf(input.type)
    )
    if (options?.publicLink) await this.#api.publishFile(file.id)
    return { file: toStored(file), intact: holds(file, body, input.name) }
  }

  async createMany(
    collection: Collection,
    items: { input: FileInput; body: string }[]
  ): Promise<(WriteResult | null)[]> {
    if (items.length === 0) return []
    this.#forgetListings()
    const folder = await this.#folder(collection)
    const files = await this.#api.batchUploadFiles(
      items.map(({ input, body }) => ({
        metadata: { ...writeMetadata(input), mimeType: input.type, parents: [folder] },
        content: body,
        contentType: contentTypeOf(input.type),
      }))
    )
    return files.map((file, i) =>
      file?.id
        ? { file: toStored(file), intact: holds(file, items[i].body, items[i].input.name) }
        : null
    )
  }

  async update(ref: string, input: FileInput, body: FileBody): Promise<WriteResult> {
    this.#forgetListings()
    // (the type of a file does not change, so it is not sent in the metadata)
    const file = await this.#api.updateFile(
      ref,
      writeMetadata(input),
      body,
      contentTypeOf(input.type)
    )
    return { file: toStored(file), intact: holds(file, body, input.name) }
  }

  updateMany(
    items: { ref: string; input: FileInput; body: string }[]
  ): Promise<(WriteResult | null)[]> {
    return inGroups(items, ({ ref, input, body }) => this.update(ref, input, body))
  }

  unpublish(ref: string): Promise<void> {
    this.#forgetListings()
    return this.#api.unpublishFile(ref)
  }

  trash(ref: string): Promise<void> {
    this.#forgetListings()
    return this.#api.trashFile(ref)
  }
}

function drivePads(api: DriveApi): PadStorage {
  return {
    async listSets(): Promise<PadSetEntry[]> {
      return (await api.listPadSetFolders()).map(folder => ({
        ref: folder.id,
        name: folder.appProperties?.padSetName || folder.name || folder.id,
        modified: folder.modifiedTime ?? null,
      }))
    },

    async ensureSet(name: string): Promise<string> {
      const ref = await api.ensurePadSetFolder(name)
      await api.updatePadSetFolderMetadata(ref, name)
      return ref
    },

    async listFiles(setRef: string): Promise<PadFileEntry[]> {
      return (await api.listPadSetFiles(setRef)).map(file => ({
        ref: file.id,
        name: file.name ?? '',
        padKey: file.appProperties?.padKey ?? null,
        type: file.mimeType || 'audio/mpeg',
        size: Number(file.size) || 0,
      }))
    },

    async addFile(setRef: string, padKey: string, audio: Blob): Promise<void> {
      await api.uploadPadFile(setRef, padKey, audio)
    },

    trashFiles: setRef => api.trashFilesInFolder(setRef),

    read: fileRef => api.downloadFileBinary(fileRef),
  }
}

/**
 * The storage API on Drive, for whoever the client's access tokens are for: the signed-in user in
 * the browser (browser-drive.ts), or a team space's credential in the Worker (worker/src/team-drive.ts).
 */
export function createDriveStorage(api: DriveApi): StorageBackend {
  return {
    pads: drivePads(api),

    available: () => api.checkDriveAccess(),

    async inspectRoot(ref: string): Promise<RootInfo | null> {
      const folder = await api.getFile(ref, 'id,name,trashed,capabilities')
      if (!folder) return null
      return {
        ref: folder.id,
        name: folder.name ?? '',
        trashed: Boolean(folder.trashed),
        canWrite: folder.capabilities?.canAddChildren ?? null,
      }
    },

    async findRootByName(name: string): Promise<RootInfo | null> {
      const folder = await api.findSpaceFolderByName(name)
      return folder ? { ref: folder.id, name, trashed: false, canWrite: null } : null
    },

    async ensureRoot(name: string, spaceId: string) {
      const { folderId, isNew } = await api.findOrCreateSpaceFolder(name, spaceId)
      return { ref: folderId, isNew }
    },

    async renameRoot(ref: string, name: string): Promise<void> {
      await api.renameFile(ref, name)
    },

    space: rootRef => new DriveSpace(api, rootRef),

    writeRefusals: () => api.countWriteRefusals(),
  }
}
