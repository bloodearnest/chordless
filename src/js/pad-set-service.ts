import { wantsPads } from './media-player-loader.ts'
import { extractPadKeyFromFilename, normalizePadKey, PAD_FILE_KEYS } from './pad-keys.ts'
import { driveStorage } from './storage/browser-drive.ts'
import type { PadStorage } from './storage/types.ts'
import { readZip, type ZipArchive } from './utils/zip.ts'

/** A set of pads: a folder of them in the storage (the app ships none: the pads are the user's own) */
export interface PadSet {
  id: string
  name: string
  modifiedTime?: string | null
}

/** Where a pad's audio is in the storage (`fileId` is its ref; the name is what devices have kept) */
interface PadFile {
  fileId: string
  mimeType: string
}

/** What is remembered about a Drive pad set's files */
interface PadSetMetadata {
  modifiedTime: string
  cachedAt: string
  files: Record<string, PadFile>
}

/** A different pad set was chosen (sent on window) */
export class PadSetChangedEvent extends Event {
  static readonly type = 'pad-sets:changed'
  /** The pad set now chosen, or null if the choice was cleared */
  readonly padSet: PadSet | null
  constructor(padSet: PadSet | null) {
    super(PadSetChangedEvent.type)
    this.padSet = padSet
  }
}

/** The list of pad sets changed (sent on window) */
export class PadSetListUpdatedEvent extends Event {
  static readonly type = 'pad-sets:list-updated'
  constructor() {
    super(PadSetListUpdatedEvent.type)
  }
}

const PAD_SET_SELECTION_KEY = 'padset-selection'
const PAD_SET_CACHE_STATE_KEY = 'padset-cache-state'
const PAD_CACHE_NAME = 'padsets-cache-v1'

// Where the pad sets are kept: Google Drive, unless a test says otherwise
let padStorage: PadStorage = driveStorage.pads

export function setPadStorage(storage?: PadStorage | null) {
  padStorage = storage ?? driveStorage.pads
}

const PAD_SET_METADATA_CACHE = new Map<string, PadSetMetadata>()
const INFLIGHT_PAD_DOWNLOADS = new Map<string, Promise<void>>()
const PAD_PRELOAD_DELAY_MS = 50

let padSetListCache: PadSet[] | null = null
let padSetListPromise: Promise<PadSet[]> | null = null

/** The pad set chosen on this device, or null: there is none until one has been uploaded */
export function getActivePadSet(): PadSet | null {
  const stored = readLocalStorage(PAD_SET_SELECTION_KEY)
  if (stored) {
    try {
      const parsed = JSON.parse(stored)
      return parsed
    } catch (err) {
      console.warn('[PadSetService] Failed to parse active pad set from localStorage:', err)
    }
  }
  return null
}

export async function listPadSets(force = false): Promise<PadSet[]> {
  if (!force && padSetListCache) {
    return padSetListCache
  }

  if (!force && padSetListPromise) {
    return padSetListPromise
  }

  padSetListPromise = (async () => {
    const sets: PadSet[] = []
    try {
      for (const set of await padStorage.listSets()) {
        sets.push({ id: set.ref, name: set.name, modifiedTime: set.modified })
      }
    } catch (error) {
      console.warn('[PadSetService] Failed to list pad sets from Drive:', error)
    }

    padSetListCache = sets
    padSetListPromise = null
    return sets
  })()

  return padSetListPromise
}

export async function uploadPadSet(
  zipFile: File | null | undefined,
  padSetName?: string,
  onProgress?: (uploaded: number, total: number) => void
): Promise<PadSet> {
  if (!zipFile) {
    throw new Error('Please select a pad set ZIP file.')
  }

  const normalizedName = (padSetName || derivePadSetName(zipFile.name)).trim()
  if (!normalizedName) {
    throw new Error('Please provide a pad set name.')
  }

  const padFiles = await extractPadFiles(await readZip(zipFile))

  // Validate key coverage
  const missingKeys = PAD_FILE_KEYS.filter(key => !padFiles.has(key))
  if (missingKeys.length > 0) {
    throw new Error(`Missing keys in pad set: ${missingKeys.join(', ')}`)
  }

  // Ensure folder exists
  const folderId = await padStorage.ensureSet(normalizedName)

  // Clear old contents and cached media
  await padStorage.trashFiles(folderId)
  await invalidatePadSetCache(folderId)

  // Upload each file
  onProgress?.(0, PAD_FILE_KEYS.length)
  for (const [index, key] of PAD_FILE_KEYS.entries()) {
    // (every key is there: checked above)
    const data = padFiles.get(key) as Uint8Array<ArrayBuffer>
    const blob = new Blob([data], { type: 'audio/mpeg' })
    await padStorage.addFile(folderId, key, blob)
    onProgress?.(index + 1, PAD_FILE_KEYS.length)
  }

  padSetListCache = null
  window.dispatchEvent(new PadSetListUpdatedEvent())

  const padSet: PadSet = { id: folderId, name: normalizedName }
  // The first set uploaded is the one to use: there is no default to fall back on
  if (!getActivePadSet()) await selectPadSet(folderId)
  return padSet
}

/** How many bytes of audio a pad set holds in Drive (for an export to say how big it would be) */
export async function padSetSize(padSet: PadSet): Promise<number> {
  const files = await padStorage.listFiles(padSet.id)
  return files.reduce((total, file) => total + file.size, 0)
}

/** A pad set's audio, by key, read from Drive (or what was kept of it) */
export async function readPadSetAudio(padSet: PadSet): Promise<Map<string, ArrayBuffer>> {
  const files = await ensurePadSetMetadata(padSet)
  const audio = new Map<string, ArrayBuffer>()
  for (const key of PAD_FILE_KEYS) {
    audio.set(key, await padStorage.read((files[key] as PadFile).fileId))
  }
  return audio
}

export async function selectPadSet(padSetId: string): Promise<PadSet> {
  const padSets = await listPadSets()
  const padSet = padSets.find(set => set.id === padSetId)
  if (!padSet) throw new Error('That pad set is no longer in Google Drive.')

  await ensurePadSetMetadata(padSet)

  writeLocalStorage(PAD_SET_SELECTION_KEY, JSON.stringify(padSet))
  window.dispatchEvent(new PadSetChangedEvent(padSet))
  return padSet
}

export async function ensurePadKeyCached(padSet: PadSet, key: string): Promise<void> {
  if (!key) return
  if (typeof caches === 'undefined') {
    console.warn('[PadSetService] Cache Storage is unavailable in this environment.')
    return
  }

  const normalizedKey = normalizePadKey(key)
  if (!normalizedKey) {
    throw new Error(`Invalid pad key "${key}"`)
  }

  const cache = await caches.open(PAD_CACHE_NAME)
  const request = new Request(getPadCacheUrl(padSet.id, normalizedKey))
  const cached = await cache.match(request)
  if (cached) {
    return
  }

  const inflightKey = `${padSet.id}:${normalizedKey}`
  if (INFLIGHT_PAD_DOWNLOADS.has(inflightKey)) {
    return INFLIGHT_PAD_DOWNLOADS.get(inflightKey)
  }

  const downloadPromise = (async () => {
    const metadata = await ensurePadSetMetadata(padSet)
    const entry: PadFile | undefined = metadata[normalizedKey]
    if (!entry) {
      throw new Error(`Pad set "${padSet.name}" is missing key: ${normalizedKey}`)
    }

    const buffer = await padStorage.read(entry.fileId)
    const blob = new Blob([buffer], { type: entry.mimeType })
    await cache.put(
      request,
      new Response(blob, {
        headers: {
          'Content-Type': entry.mimeType,
          'Cache-Control': 'public, max-age=31536000',
        },
      })
    )
  })().finally(() => {
    INFLIGHT_PAD_DOWNLOADS.delete(inflightKey)
  })

  INFLIGHT_PAD_DOWNLOADS.set(inflightKey, downloadPromise)
  return downloadPromise
}

export function getPadCacheUrl(padSetId: string, key: string): string {
  return `/pad-sets/${encodeURIComponent(padSetId)}/${encodeURIComponent(key)}.mp3`
}

export async function isPadKeyCached(
  padSet: PadSet | null | undefined,
  key: string | null | undefined
): Promise<boolean> {
  if (!padSet || !key) return false
  if (typeof caches === 'undefined') {
    return false
  }

  const normalizedKey = normalizePadKey(key)
  if (!normalizedKey) {
    return false
  }

  const cache = await caches.open(PAD_CACHE_NAME)
  const request = new Request(getPadCacheUrl(padSet.id, normalizedKey))
  const cached = await cache.match(request)
  return !!cached
}

function uniqueNormalizedPadKeys(keys: string[] = []): string[] {
  const normalized = keys.map(key => normalizePadKey(key)).filter((key): key is string => !!key)
  return Array.from(new Set(normalized))
}

/**
 * Fetch pads for these keys in the background, so they are there to play. Only if there is a
 * pad set, and the player and its pads are on and the device can play them.
 * @returns how many keys it set about fetching
 */
export function preloadPadKeys(
  keys: string[] = [],
  padSet: PadSet | null = getActivePadSet()
): number {
  if (!padSet || !wantsPads()) return 0
  const normalizedKeys = uniqueNormalizedPadKeys(keys)
  if (normalizedKeys.length === 0) return 0

  normalizedKeys.forEach((key, index) => {
    setTimeout(() => {
      ensurePadKeyCached(padSet, key).catch(error => {
        console.warn(`[PadSetService] Failed to preload pad key ${key}:`, error)
      })
    }, index * PAD_PRELOAD_DELAY_MS)
  })
  return normalizedKeys.length
}

export function preloadPadKey(key: string, padSet: PadSet | null = getActivePadSet()): void {
  preloadPadKeys([key], padSet)
}

export function preloadPadKeysForSongs(
  songs: { currentKey?: string; metadata?: { key?: string }; originalKey?: string | null }[] = [],
  padSet: PadSet | null = getActivePadSet()
): void {
  const keys = songs
    .map(song => song?.currentKey || song?.metadata?.key || song?.originalKey)
    .filter((key): key is string => !!key)
  preloadPadKeys(keys, padSet)
}

export function derivePadSetName(filename = ''): string {
  const base = filename.replace(/\.[^.]+$/, '')
  const sanitized = base.replace(/[^a-zA-Z0-9\s_-]+/g, '')
  const spaced = sanitized.replace(/[-_]+/g, ' ').trim()
  return spaced || 'New Pad Set'
}

function getCacheState(): Record<string, PadSetMetadata> {
  try {
    return JSON.parse(localStorage.getItem(PAD_SET_CACHE_STATE_KEY) ?? 'null') || {}
  } catch {
    return {}
  }
}

function saveCacheState(state: Record<string, PadSetMetadata>): void {
  writeLocalStorage(PAD_SET_CACHE_STATE_KEY, JSON.stringify(state))
}

async function clearPadSetCache(cache: Cache, padSetId: string): Promise<void> {
  const keys = await cache.keys()
  const prefix = `/pad-sets/${encodeURIComponent(padSetId)}/`
  const removals = keys
    .filter(request => request.url.includes(prefix))
    .map(request => cache.delete(request))
  await Promise.all(removals)
}

/** The files of a pad set, by key (listed from Drive, and then kept) */
async function ensurePadSetMetadata(padSet: PadSet): Promise<Record<string, PadFile>> {
  const cacheEntry = PAD_SET_METADATA_CACHE.get(padSet.id)
  if (cacheEntry && metadataMatches(cacheEntry, padSet)) {
    return cacheEntry.files
  }

  const cacheState = getCacheState()
  const storedEntry = cacheState[padSet.id]
  if (storedEntry?.files && metadataMatches(storedEntry, padSet)) {
    PAD_SET_METADATA_CACHE.set(padSet.id, storedEntry)
    return storedEntry.files
  }

  const files = await padStorage.listFiles(padSet.id)
  const fileMap: Record<string, PadFile> = {}

  for (const file of files) {
    const key =
      normalizePadKey(file.padKey) || normalizePadKey(extractPadKeyFromFilename(file.name))
    if (key) fileMap[key] = { fileId: file.ref, mimeType: file.type }
  }

  const missingKeys = PAD_FILE_KEYS.filter(key => !fileMap[key])
  if (missingKeys.length > 0) {
    throw new Error(`Pad set "${padSet.name}" is missing files for: ${missingKeys.join(', ')}`)
  }

  const entry: PadSetMetadata = {
    modifiedTime: padSet.modifiedTime || new Date().toISOString(),
    cachedAt: new Date().toISOString(),
    files: fileMap,
  }

  cacheState[padSet.id] = entry
  saveCacheState(cacheState)
  PAD_SET_METADATA_CACHE.set(padSet.id, entry)
  return fileMap
}

/** Whether what was kept of a set is of the version of it Drive has (any, if Drive said none) */
function metadataMatches(entry: PadSetMetadata, padSet: PadSet): boolean {
  return !padSet.modifiedTime || entry.modifiedTime === padSet.modifiedTime
}

async function invalidatePadSetCache(padSetId: string): Promise<void> {
  PAD_SET_METADATA_CACHE.delete(padSetId)
  const cacheState = getCacheState()
  if (cacheState[padSetId]) {
    delete cacheState[padSetId]
    saveCacheState(cacheState)
  }

  if (typeof caches !== 'undefined') {
    const cache = await caches.open(PAD_CACHE_NAME)
    await clearPadSetCache(cache, padSetId)
  }
}

async function extractPadFiles(zip: ZipArchive): Promise<Map<string, Uint8Array<ArrayBuffer>>> {
  const padFiles = new Map<string, { data: Uint8Array<ArrayBuffer>; pathLength: number }>()

  for (const entry of zip.entries) {
    if (!entry.fileName || entry.fileName.endsWith('/')) continue
    if (!entry.fileName.toLowerCase().endsWith('.mp3')) continue
    if (entry.flags & 0x01) {
      throw new Error('Encrypted ZIP archives are not supported.')
    }

    const key = normalizePadKey(extractPadKeyFromFilename(entry.fileName))
    if (!key) continue

    const data = await zip.read(entry)
    const existing = padFiles.get(key)
    if (!existing || entry.fileName.length < existing.pathLength) {
      padFiles.set(key, { data, pathLength: entry.fileName.length })
    }
  }

  const normalized = new Map<string, Uint8Array<ArrayBuffer>>()
  for (const [key, value] of padFiles.entries()) {
    normalized.set(key, value.data)
  }
  return normalized
}

function readLocalStorage(key: string): string | null {
  return localStorage.getItem(key)
}

function writeLocalStorage(key: string, value: string): void {
  localStorage.setItem(key, value)
}

declare global {
  interface GlobalEventHandlersEventMap {
    [PadSetChangedEvent.type]: PadSetChangedEvent
    [PadSetListUpdatedEvent.type]: PadSetListUpdatedEvent
  }
}
