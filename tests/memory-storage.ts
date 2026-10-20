/**
 * An in-memory storage backend (src/js/storage/types.ts), for tests of the sync engine.
 *
 * Devices that share a space share one MemoryStorage, as they share one Drive. It models what
 * the engine relies on of any backend: refs are opaque and last a file's life, `rev` changes
 * with the content and only then, `modified` comes from the backend's clock, a trashed file is
 * not listed but still exists, and a write by someone who can only read is refused.
 *
 * Tests reach in with the helpers below (`edit` for a change made elsewhere, `trash`, `remove`,
 * `rekey`, `fail`, `readOnly`, `corruptWrites`). The Drive adapter is tested separately, against
 * FakeDrive, with the same conformance suite (tests/storage-conformance.ts).
 */
import type { SpaceMember } from '../src/js/data-types.ts'
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
} from '../src/js/storage/types.ts'
import { md5Hex } from '../src/js/utils/md5.ts'

/** What a file is, as the fake keeps it */
export interface MemoryFile {
  ref: string
  root: string
  collection: Collection
  name: string
  props: Record<string, string>
  type: string
  /** The text, or for a file that was not text (an encrypted share) one character per byte */
  content: string
  binary: boolean
  /** Readable by anyone with the ref (a share link) */
  public: boolean
  rev: string
  created: string | null
  modified: string | null
  trashed: boolean
}

interface MemoryRoot {
  ref: string
  name: string
  spaceId: string
  trashed: boolean
  members: SpaceMember[]
}

/** An error with the HTTP-like status a backend gives */
export class StorageError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'StorageError'
    this.status = status
  }
}

export type StorageOp =
  | 'available'
  | 'inspectRoot'
  | 'findRootByName'
  | 'ensureRoot'
  | 'renameRoot'
  | 'members'
  | 'list'
  | 'inventory'
  | 'status'
  | 'readText'
  | 'readMany'
  | 'create'
  | 'createMany'
  | 'update'
  | 'updateMany'
  | 'unpublish'
  | 'trash'
  | 'listPadSets'
  | 'ensurePadSet'
  | 'listPadFiles'
  | 'addPadFile'
  | 'trashPadFiles'
  | 'readPadFile'

interface Failure {
  op: StorageOp
  /** Only calls about this ref (a file or a collection name) */
  on?: string
  status: number
  network: boolean
  times: number
  skip: number
}

const WRITES: StorageOp[] = [
  'renameRoot',
  'create',
  'createMany',
  'update',
  'updateMany',
  'unpublish',
  'trash',
  'ensurePadSet',
  'addPadFile',
  'trashPadFiles',
]

/** A file of a pad set, as the memory backend keeps it */
export interface MemoryPadFile {
  ref: string
  set: string
  name: string
  padKey: string | null
  type: string
  bytes: Uint8Array
  trashed: boolean
}

/** A pad set, as the memory backend keeps it */
export interface MemoryPadSet {
  ref: string
  name: string
  modified: string
}

export class MemoryStorage implements StorageBackend {
  padSets = new Map<string, MemoryPadSet>()
  padFiles = new Map<string, MemoryPadFile>()
  pads: PadStorage = new MemoryPads(this)

  roots = new Map<string, MemoryRoot>()
  files = new Map<string, MemoryFile>()
  /** Every call made, for assertions: `op` and the ref or collection it was about */
  calls: { op: StorageOp; on?: string }[] = []
  /** Server clock skew relative to the test's clock, in ms */
  clockOffsetMs = 0
  /** The person can only read: every write is refused (403), and the root says so */
  readOnly = false
  /** The root does not say whether the person may write */
  omitCapabilities = false
  /** The next n writes report another content than was sent, as if the backend stored other bytes */
  corruptWrites = 0
  #failures: Failure[] = []
  #refused = 0
  #nextId = 1

  // ---------- test helpers ----------

  now(): string {
    return new Date(Date.now() + this.clockOffsetMs).toISOString()
  }

  /**
   * Make matching calls fail. `network` fails like a dropped connection (no status).
   * `skip` lets that many matching calls succeed first.
   */
  fail(
    op: StorageOp,
    { on, status = 500, network = false, times = 1, skip = 0 }: Partial<Failure> = {}
  ): void {
    this.#failures.push({ op, on, status, network, times, skip })
  }

  /** Stop injecting failures: the ones not yet used are dropped */
  clearFailures(): void {
    this.#failures = []
  }

  /** The calls that change something (a test of "nothing is uploaded" looks at these) */
  writes(): { op: StorageOp; on?: string }[] {
    return this.calls.filter(call => WRITES.includes(call.op))
  }

  /** Forget the calls made so far, to look at those of the next sync */
  clearCalls(): void {
    this.calls = []
  }

  /** The live files, optionally those a predicate picks (folders are not files here) */
  list(predicate: (file: MemoryFile) => boolean = () => true): MemoryFile[] {
    return [...this.files.values()].filter(f => !f.trashed && predicate(f))
  }

  /** Every file, trashed ones too */
  everything(predicate: (file: MemoryFile) => boolean = () => true): MemoryFile[] {
    return [...this.files.values()].filter(predicate)
  }

  /** The one file of a ref; fails the test run loudly if there is none */
  file(ref: string): MemoryFile {
    const file = this.files.get(ref)
    if (!file) throw new Error(`MemoryStorage has no file ${ref}`)
    return file
  }

  /** A root's id by the name it has now */
  rootNamed(name: string): MemoryRoot | undefined {
    return [...this.roots.values()].find(root => root.name === name && !root.trashed)
  }

  /** Share a space with someone */
  addMember(rootRef: string, member: SpaceMember): void {
    this.root(rootRef).members.push(member)
  }

  /** What the worker's /api/share/<ref> gives a recipient: the file's bytes if it is public */
  publicDownload(ref: string): { status: number; bytes?: Uint8Array } {
    const file = this.files.get(ref)
    if (!file?.public) return { status: 404 }
    return {
      status: 200,
      bytes: file.binary
        ? Uint8Array.from(file.content, c => c.charCodeAt(0))
        : new TextEncoder().encode(file.content),
    }
  }

  /**
   * Another file like `ref`, with these fields changed: what another client or a person in the
   * Drive UI leaves beside it (a copy, an older file, a file with no properties)
   */
  copyFile(ref: string, changes: Partial<MemoryFile> & { ref: string }): MemoryFile {
    const original = this.file(ref)
    const copy: MemoryFile = { ...original, props: { ...original.props }, ...changes }
    if ('content' in changes && !('rev' in changes)) copy.rev = md5Hex(copy.content)
    this.files.set(copy.ref, copy)
    return copy
  }

  /** A change made elsewhere (another device, or by hand): new content, so a new rev */
  edit(ref: string, content: string): void {
    this.#setContent(this.file(ref), content)
  }

  /** Put a file or a root in the bin */
  trash(ref: string): void {
    const file = this.files.get(ref)
    if (file) file.trashed = true
    else this.root(ref).trashed = true
  }

  /** Take a file or a root out of the bin */
  restore(ref: string): void {
    const file = this.files.get(ref)
    if (file) file.trashed = false
    else this.root(ref).trashed = false
  }

  /** Delete a root and everything in it, for good: what another app sees of this one's folder */
  removeRoot(ref: string): void {
    this.roots.delete(ref)
    for (const file of this.everything(f => f.root === ref)) this.files.delete(file.ref)
  }

  /** Delete a file for good */
  remove(ref: string): void {
    this.files.delete(ref)
  }

  /** The file `ref` is replaced by a copy with another ref, as when duplicates are cleaned up */
  rekey(ref: string, newRef: string): void {
    const file = this.file(ref)
    this.files.delete(ref)
    file.ref = newRef
    this.files.set(newRef, file)
  }

  // ---------- the backend ----------

  async available(): Promise<boolean> {
    this.enter('available')
    return true
  }

  async inspectRoot(ref: string): Promise<RootInfo | null> {
    this.enter('inspectRoot', ref)
    const root = this.roots.get(ref)
    return root ? this.#info(root) : null
  }

  async findRootByName(name: string): Promise<RootInfo | null> {
    this.enter('findRootByName', name)
    const root = this.rootNamed(name)
    return root ? this.#info(root) : null
  }

  async ensureRoot(name: string, spaceId: string): Promise<{ ref: string; isNew: boolean }> {
    this.enter('ensureRoot', name)
    const existing = this.rootNamed(name)
    if (existing) return { ref: existing.ref, isNew: false }
    this.refuseWrites()
    const root: MemoryRoot = {
      ref: `root-${this.#nextId++}`,
      name,
      spaceId,
      trashed: false,
      members: [],
    }
    this.roots.set(root.ref, root)
    return { ref: root.ref, isNew: true }
  }

  async renameRoot(ref: string, name: string): Promise<void> {
    this.enter('renameRoot', ref)
    this.refuseWrites()
    this.root(ref).name = name
  }

  space(rootRef: string): SpaceStorage {
    return new MemorySpace(this, rootRef)
  }

  writeRefusals(): number {
    return this.#refused
  }

  // ---------- for MemorySpace ----------

  write(
    rootRef: string,
    collection: Collection,
    input: FileInput,
    body: Content,
    ref?: string,
    publicLink = false
  ): WriteResult {
    this.refuseWrites()
    let file: MemoryFile
    if (ref === undefined) {
      const now = this.now()
      file = {
        ref: `file-${this.#nextId++}`,
        root: rootRef,
        collection,
        name: input.name,
        props: {},
        type: input.type,
        content: '',
        binary: false,
        public: false,
        rev: '',
        created: now,
        modified: now,
        trashed: false,
      }
      this.files.set(file.ref, file)
    } else {
      const existing = this.files.get(ref)
      if (!existing) throw new StorageError(`File not found: ${ref}`, 404)
      file = existing
      file.name = input.name
      file.type = input.type
    }
    for (const [key, value] of Object.entries(input.props)) {
      if (value === null) delete file.props[key]
      else file.props[key] = value
    }
    const intact = this.corruptWrites <= 0
    file.binary = body.binary
    this.#setContent(file, body.content)
    if (publicLink) file.public = true
    if (!intact) {
      this.corruptWrites--
      file.rev = md5Hex(`${body} (corrupted)`)
    }
    return { file: toStored(file), intact }
  }

  #setContent(file: MemoryFile, content: string): void {
    file.content = content
    file.rev = md5Hex(content)
    file.modified = this.now()
  }

  #info(root: MemoryRoot): RootInfo {
    return {
      ref: root.ref,
      name: root.name,
      trashed: root.trashed,
      canWrite: this.omitCapabilities ? null : !this.readOnly,
    }
  }

  root(ref: string): MemoryRoot {
    const root = this.roots.get(ref)
    if (!root) throw new StorageError(`Folder not found: ${ref}`, 404)
    return root
  }

  /** Count a call, and fail it if a test said to */
  enter(op: StorageOp, on?: string): void {
    this.calls.push({ op, on })
    for (const failure of this.#failures) {
      if (failure.times <= 0 || failure.op !== op) continue
      if (failure.on !== undefined && failure.on !== on) continue
      if (failure.skip > 0) {
        failure.skip--
        continue
      }
      failure.times--
      if (failure.network) throw new TypeError('Failed to fetch (fake network failure)')
      if (failure.status === 403 && WRITES.includes(op)) this.#refused++
      throw new StorageError(`Injected ${failure.status}`, failure.status)
    }
  }

  refuseWrites(): void {
    if (!this.readOnly) return
    this.#refused++
    throw new StorageError('The user does not have write access', 403)
  }
}

class MemoryPads implements PadStorage {
  #storage: MemoryStorage

  constructor(storage: MemoryStorage) {
    this.#storage = storage
  }

  async listSets(): Promise<PadSetEntry[]> {
    this.#storage.enter('listPadSets')
    return [...this.#storage.padSets.values()].map(set => ({
      ref: set.ref,
      name: set.name,
      modified: set.modified,
    }))
  }

  async ensureSet(name: string): Promise<string> {
    this.#storage.enter('ensurePadSet', name)
    this.#storage.refuseWrites()
    let set = [...this.#storage.padSets.values()].find(each => each.name === name)
    if (!set) {
      set = { ref: `padset-${crypto.randomUUID()}`, name, modified: '' }
      this.#storage.padSets.set(set.ref, set)
    }
    set.modified = this.#storage.now()
    return set.ref
  }

  async listFiles(setRef: string): Promise<PadFileEntry[]> {
    this.#storage.enter('listPadFiles', setRef)
    return [...this.#storage.padFiles.values()]
      .filter(file => file.set === setRef && !file.trashed)
      .map(file => ({
        ref: file.ref,
        name: file.name,
        padKey: file.padKey,
        type: file.type,
        size: file.bytes.length,
      }))
  }

  async addFile(setRef: string, padKey: string, audio: Blob): Promise<void> {
    this.#storage.enter('addPadFile', setRef)
    this.#storage.refuseWrites()
    const file: MemoryPadFile = {
      ref: `padfile-${crypto.randomUUID()}`,
      set: setRef,
      name: `${padKey}.mp3`,
      padKey,
      type: audio.type || 'audio/mpeg',
      bytes: new Uint8Array(await audio.arrayBuffer()),
      trashed: false,
    }
    this.#storage.padFiles.set(file.ref, file)
    const set = this.#storage.padSets.get(setRef)
    if (set) set.modified = this.#storage.now()
  }

  async trashFiles(setRef: string): Promise<void> {
    this.#storage.enter('trashPadFiles', setRef)
    this.#storage.refuseWrites()
    for (const file of this.#storage.padFiles.values()) if (file.set === setRef) file.trashed = true
  }

  async read(fileRef: string): Promise<ArrayBuffer> {
    this.#storage.enter('readPadFile', fileRef)
    const file = this.#storage.padFiles.get(fileRef)
    if (!file || file.trashed) throw new StorageError(`File not found: ${fileRef}`, 404)
    return file.bytes.slice().buffer
  }
}

export function toStored(file: MemoryFile): StoredFile {
  return {
    ref: file.ref,
    name: file.name,
    props: { ...file.props },
    rev: file.rev,
    modified: file.modified,
    created: file.created,
  }
}

/** What a write holds: text as it is, anything else one character per byte, as FakeDrive does */
interface Content {
  content: string
  binary: boolean
}

async function contentOf(body: FileBody): Promise<Content> {
  if (typeof body === 'string') return { content: body, binary: false }
  const bytes =
    body instanceof Blob
      ? new Uint8Array(await body.arrayBuffer())
      : body instanceof Uint8Array
        ? body
        : new Uint8Array(body)
  let content = ''
  for (let i = 0; i < bytes.length; i += 8192) {
    content += String.fromCharCode(...bytes.subarray(i, i + 8192))
  }
  return { content, binary: true }
}

class MemorySpace implements SpaceStorage {
  #storage: MemoryStorage
  #root: string

  constructor(storage: MemoryStorage, root: string) {
    this.#storage = storage
    this.#root = root
  }

  async members(): Promise<SpaceMember[]> {
    this.#storage.enter('members', this.#root)
    return this.#storage.root(this.#root).members.map(member => ({ ...member }))
  }

  async list(collection: Collection): Promise<StoredFile[]> {
    this.#storage.enter('list', collection)
    return this.#storage
      .list(f => f.root === this.#root && f.collection === collection)
      .map(toStored)
  }

  async inventory(): Promise<Set<string>> {
    this.#storage.enter('inventory')
    return new Set(this.#storage.list(f => f.root === this.#root).map(f => f.ref))
  }

  async status(ref: string): Promise<FileStatus | null> {
    this.#storage.enter('status', ref)
    const file = this.#storage.files.get(ref)
    return file ? { ...toStored(file), trashed: file.trashed } : null
  }

  async readText(ref: string): Promise<string> {
    this.#storage.enter('readText', ref)
    const file = this.#storage.files.get(ref)
    if (!file || file.trashed) throw new StorageError(`File not found: ${ref}`, 404)
    return file.content
  }

  async readMany(refs: string[]): Promise<(string | null)[]> {
    this.#storage.enter('readMany')
    const texts: (string | null)[] = []
    for (const ref of refs) {
      try {
        texts.push(await this.readText(ref))
      } catch (error) {
        console.error('[MemoryStorage] Failed to read a file:', error)
        texts.push(null)
      }
    }
    return texts
  }

  async create(
    collection: Collection,
    input: FileInput,
    body: FileBody,
    options?: { publicLink?: boolean }
  ): Promise<WriteResult> {
    this.#storage.enter('create', collection)
    return this.#storage.write(
      this.#root,
      collection,
      input,
      await contentOf(body),
      undefined,
      options?.publicLink
    )
  }

  async createMany(
    collection: Collection,
    items: { input: FileInput; body: string }[]
  ): Promise<(WriteResult | null)[]> {
    this.#storage.enter('createMany', collection)
    const results: (WriteResult | null)[] = []
    for (const { input, body } of items) {
      try {
        this.#storage.enter('create', collection)
        results.push(this.#storage.write(this.#root, collection, input, await contentOf(body)))
      } catch (error) {
        console.error('[MemoryStorage] Failed to create a file:', error)
        results.push(null)
      }
    }
    return results
  }

  async unpublish(ref: string): Promise<void> {
    this.#storage.enter('unpublish', ref)
    const file = this.#storage.files.get(ref)
    if (file) file.public = false
  }

  async trash(ref: string): Promise<void> {
    this.#storage.enter('trash', ref)
    const file = this.#storage.files.get(ref)
    if (file) file.trashed = true
  }

  async update(ref: string, input: FileInput, body: FileBody): Promise<WriteResult> {
    this.#storage.enter('update', ref)
    const file = this.#storage.files.get(ref)
    return this.#storage.write(
      this.#root,
      file?.collection ?? 'setlists',
      input,
      await contentOf(body),
      ref
    )
  }

  async updateMany(
    items: { ref: string; input: FileInput; body: string }[]
  ): Promise<(WriteResult | null)[]> {
    this.#storage.enter('updateMany')
    const results: (WriteResult | null)[] = []
    for (const { ref, input, body } of items) {
      try {
        results.push(await this.update(ref, input, body))
      } catch (error) {
        console.error('[MemoryStorage] Failed to update a file:', error)
        results.push(null)
      }
    }
    return results
  }
}
