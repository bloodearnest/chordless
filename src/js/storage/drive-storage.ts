/**
 * The storage API (types.ts) on Google Drive: a space is a folder, its collections are the
 * `songs/` and `setlists/` folders in it, a ref is a Drive file id, `props` are the file's
 * appProperties and `rev` is Drive's md5Checksum. Everything Drive-specific stays here and in
 * drive-api.ts: shared-drive flags, finding folders by name, a trashed file kept out of
 * listings, batches of uploads.
 */
import type { DriveFile } from '../data-types.ts'
import * as DriveAPI from '../drive-api.ts'
import { md5Hex } from '../utils/md5.ts'
import type {
  Collection,
  FileBody,
  FileInput,
  FileStatus,
  RootInfo,
  SpaceStorage,
  StorageBackend,
  StoredFile,
  WriteResult,
} from './types.ts'

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
  #rootRef: string
  #folders = new Map<Collection, string>()

  constructor(rootRef: string) {
    this.#rootRef = rootRef
  }

  /** The collection's folder (made if it is not there yet), looked up once */
  async #folder(collection: Collection): Promise<string> {
    let id = this.#folders.get(collection)
    if (id === undefined) {
      id =
        collection === 'songs'
          ? await DriveAPI.getSongsFolder(this.#rootRef)
          : await DriveAPI.getSetlistsFolder(this.#rootRef)
      this.#folders.set(collection, id)
    }
    return id
  }

  members() {
    return DriveAPI.listFolderPermissions(this.#rootRef)
  }

  async list(collection: Collection): Promise<StoredFile[]> {
    const folder = await this.#folder(collection)
    const live = `'${folder}' in parents and trashed=false`
    const files =
      collection === 'setlists'
        ? await DriveAPI.listDriveFiles(`${live} and name contains '.json'`, 'modifiedTime desc')
        : await DriveAPI.listDriveFiles(`${live} and mimeType='text/plain'`)
    return files.map(toStored)
  }

  async inventory(): Promise<Set<string>> {
    const refs = new Set<string>()
    const add = async (folderId: string): Promise<void> => {
      for (const file of await DriveAPI.listDriveFiles(
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
    const file = await DriveAPI.getFile(
      ref,
      'id,name,trashed,createdTime,modifiedTime,md5Checksum,appProperties'
    )
    return file ? { ...toStored(file), trashed: Boolean(file.trashed) } : null
  }

  readText(ref: string): Promise<string> {
    return DriveAPI.downloadFile(ref)
  }

  async create(collection: Collection, input: FileInput, body: FileBody): Promise<WriteResult> {
    const folder = await this.#folder(collection)
    const file = await DriveAPI.createFile(
      { ...writeMetadata(input), mimeType: input.type, parents: [folder] },
      body,
      contentTypeOf(input.type)
    )
    return { file: toStored(file), intact: holds(file, body, input.name) }
  }

  async createMany(
    collection: Collection,
    items: { input: FileInput; body: string }[]
  ): Promise<(WriteResult | null)[]> {
    if (items.length === 0) return []
    const folder = await this.#folder(collection)
    const files = await DriveAPI.batchUploadFiles(
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
    const file = await DriveAPI.updateFile(
      ref,
      writeMetadata(input),
      body,
      contentTypeOf(input.type)
    )
    return { file: toStored(file), intact: holds(file, body, input.name) }
  }
}

export const driveStorage: StorageBackend = {
  available: () => DriveAPI.checkDriveAccess(),

  async inspectRoot(ref: string): Promise<RootInfo | null> {
    const folder = await DriveAPI.getFile(ref, 'id,name,trashed,capabilities')
    if (!folder) return null
    return {
      ref: folder.id,
      name: folder.name ?? '',
      trashed: Boolean(folder.trashed),
      canWrite: folder.capabilities?.canAddChildren ?? null,
    }
  },

  async findRootByName(name: string): Promise<RootInfo | null> {
    const folder = await DriveAPI.findSpaceFolderByName(name)
    return folder
      ? { ref: folder.id, name: folder.name ?? name, trashed: false, canWrite: null }
      : null
  },

  async ensureRoot(name: string, spaceId: string) {
    const { folderId, isNew } = await DriveAPI.findOrCreateSpaceFolder(name, spaceId)
    return { ref: folderId, isNew }
  },

  async renameRoot(ref: string, name: string): Promise<void> {
    await DriveAPI.renameFile(ref, name)
  },

  space: rootRef => new DriveSpace(rootRef),

  writeRefusals: () => DriveAPI.countWriteRefusals(),
}
