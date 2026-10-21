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
import type {
  Collection,
  FileBody,
  FileInput,
  FileStatus,
  PadFileEntry,
  PadSetEntry,
  PadStorage,
  RootInfo,
  SpaceStorage,
  StorageBackend,
  StoredFile,
  WriteResult,
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

class DriveSpace implements SpaceStorage {
  #api: DriveApi
  #rootRef: string
  #folders = new Map<Collection, string>()

  constructor(api: DriveApi, rootRef: string) {
    this.#api = api
    this.#rootRef = rootRef
  }

  /** The collection's folder (made if it is not there yet), looked up once */
  async #folder(collection: Collection): Promise<string> {
    let id = this.#folders.get(collection)
    if (id === undefined) {
      id =
        collection === 'songs'
          ? await this.#api.getSongsFolder(this.#rootRef)
          : collection === 'setlists'
            ? await this.#api.getSetlistsFolder(this.#rootRef)
            : await this.#api.getSharesFolder(this.#rootRef)
      this.#folders.set(collection, id)
    }
    return id
  }

  members() {
    return this.#api.listFolderPermissions(this.#rootRef)
  }

  async list(collection: Collection): Promise<StoredFile[]> {
    // (a space nothing was ever shared from has no shares folder, and listing does not make one)
    const folder =
      collection === 'shares'
        ? await this.#api.findSharesFolder(this.#rootRef)
        : await this.#folder(collection)
    if (!folder) return []
    const live = `'${folder}' in parents and trashed=false`
    const files =
      collection === 'shares'
        ? await this.#api.listDriveFiles(live)
        : collection === 'setlists'
          ? await this.#api.listDriveFiles(`${live} and name contains '.json'`, 'modifiedTime desc')
          : await this.#api.listDriveFiles(`${live} and mimeType='text/plain'`)
    return files.map(toStored)
  }

  async inventory(): Promise<Set<string>> {
    const refs = new Set<string>()
    const add = async (folderId: string): Promise<void> => {
      for (const file of await this.#api.listDriveFiles(
        `'${folderId}' in parents and trashed=false`
      )) {
        refs.add(file.id)
        if (file.mimeType === 'application/vnd.google-apps.folder') await add(file.id)
      }
    }
    await add(this.#rootRef)
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
    return this.#api.unpublishFile(ref)
  }

  trash(ref: string): Promise<void> {
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
