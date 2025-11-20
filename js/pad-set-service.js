import {
  deleteFilesInFolder,
  downloadFileBinary,
  ensurePadSetFolder,
  listPadSetFiles,
  listPadSetFolders,
  updatePadSetFolderMetadata,
  uploadPadFile,
} from './drive-api.js'
import { extractPadKeyFromFilename, normalizePadKey, PAD_FILE_KEYS } from './pad-keys.js'

const BUILT_IN_PAD_SET = Object.freeze({
  id: 'builtin',
  name: 'Built-in Pads',
  type: 'builtin',
  modifiedTime: null,
})

const PAD_SET_SELECTION_KEY = 'setalight-padset-selection'
const PAD_SET_CACHE_STATE_KEY = 'setalight-padset-cache-state'
const PAD_CACHE_NAME = 'padsets-cache-v1'

const PAD_SET_METADATA_CACHE = new Map()
const INFLIGHT_PAD_DOWNLOADS = new Map()
const PAD_PRELOAD_DELAY_MS = 50

let padSetListCache = null
let padSetListPromise = null

export function getActivePadSet() {
  const stored = readLocalStorage(PAD_SET_SELECTION_KEY)
  if (stored) {
    try {
      const parsed = JSON.parse(stored)
      return parsed
    } catch (err) {
      console.warn('[PadSetService] Failed to parse active pad set from localStorage:', err)
    }
  }
  return BUILT_IN_PAD_SET
}

export async function listPadSets(force = false) {
  if (!force && padSetListCache) {
    return padSetListCache
  }

  if (!force && padSetListPromise) {
    return padSetListPromise
  }

  padSetListPromise = (async () => {
    const sets = [BUILT_IN_PAD_SET]
    try {
      const folders = await listPadSetFolders()
      for (const folder of folders) {
        const padSet = {
          id: folder.id,
          name: folder.appProperties?.padSetName || folder.name,
          type: 'drive',
          modifiedTime: folder.modifiedTime,
        }
        sets.push(padSet)
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

export async function uploadPadSet(zipFile, padSetName) {
  if (!zipFile) {
    throw new Error('Please select a pad set ZIP file.')
  }

  const normalizedName = (padSetName || derivePadSetName(zipFile.name)).trim()
  if (!normalizedName) {
    throw new Error('Please provide a pad set name.')
  }

  const zipEntries = await readZipEntries(zipFile)
  const padFiles = await extractPadFiles(zipEntries)

  // Validate key coverage
  const missingKeys = PAD_FILE_KEYS.filter(key => !padFiles.has(key))
  if (missingKeys.length > 0) {
    throw new Error(`Missing keys in pad set: ${missingKeys.join(', ')}`)
  }

  // Ensure folder exists
  const folderId = await ensurePadSetFolder(normalizedName)
  await updatePadSetFolderMetadata(folderId, normalizedName)

  // Clear old contents and cached media
  await deleteFilesInFolder(folderId)
  await invalidatePadSetCache(folderId)

  // Upload each file
  for (const key of PAD_FILE_KEYS) {
    const data = padFiles.get(key)
    const blob = new Blob([data], { type: 'audio/mpeg' })
    await uploadPadFile(folderId, key, blob)
  }

  padSetListCache = null
  window.dispatchEvent(new CustomEvent('pad-set-list-updated'))

  return {
    id: folderId,
    name: normalizedName,
    type: 'drive',
  }
}

export async function selectPadSet(padSetId) {
  const padSets = await listPadSets()
  const padSet = padSets.find(set => set.id === padSetId) || BUILT_IN_PAD_SET

  if (padSet.type === 'drive') {
    await ensurePadSetMetadata(padSet)
  }

  writeLocalStorage(PAD_SET_SELECTION_KEY, JSON.stringify(padSet))
  window.dispatchEvent(new CustomEvent('pad-set-changed', { detail: { padSet } }))
  return padSet
}

export async function ensurePadKeyCached(padSet, key) {
  if (padSet.type !== 'drive' || !key) return
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
    console.log(
      `[PadSetService] Pad key ${normalizedKey} already cached for set ${padSet.name || padSet.id}`
    )
    return
  }

  const inflightKey = `${padSet.id}:${normalizedKey}`
  if (INFLIGHT_PAD_DOWNLOADS.has(inflightKey)) {
    console.log(
      `[PadSetService] Pad key ${normalizedKey} download already in progress for set ${padSet.name || padSet.id}`
    )
    return INFLIGHT_PAD_DOWNLOADS.get(inflightKey)
  }

  const downloadPromise = (async () => {
    console.log(
      `[PadSetService] Caching pad key ${normalizedKey} for set ${padSet.name || padSet.id}`
    )
    const metadata = await ensurePadSetMetadata(padSet)
    const entry = metadata[normalizedKey]
    if (!entry) {
      throw new Error(`Pad set "${padSet.name}" is missing key: ${normalizedKey}`)
    }

    const buffer = await downloadFileBinary(entry.fileId)
    const blob = new Blob([buffer], { type: entry.mimeType || 'audio/mpeg' })
    await cache.put(
      request,
      new Response(blob, {
        headers: {
          'Content-Type': entry.mimeType || 'audio/mpeg',
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

export function getPadCacheUrl(padSetId, key) {
  return `/pad-sets/${encodeURIComponent(padSetId)}/${encodeURIComponent(key)}.mp3`
}

export async function isPadKeyCached(padSet, key) {
  if (!padSet || padSet.type !== 'drive' || !key) return false
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

function uniqueNormalizedPadKeys(keys = []) {
  const normalized = keys.map(key => normalizePadKey(key)).filter(Boolean)
  return Array.from(new Set(normalized))
}

export function preloadPadKeys(keys = [], padSet = getActivePadSet()) {
  if (!padSet || padSet.type !== 'drive') return
  const normalizedKeys = uniqueNormalizedPadKeys(keys)
  if (normalizedKeys.length === 0) return

  normalizedKeys.forEach((key, index) => {
    setTimeout(() => {
      ensurePadKeyCached(padSet, key).catch(error => {
        console.warn(`[PadSetService] Failed to preload pad key ${key}:`, error)
      })
    }, index * PAD_PRELOAD_DELAY_MS)
  })
}

export function preloadPadKey(key, padSet = getActivePadSet()) {
  if (!key) return
  preloadPadKeys([key], padSet)
}

export function preloadPadKeysForSongs(songs = [], padSet = getActivePadSet()) {
  if (!songs || songs.length === 0) return
  const keys = songs
    .map(song => song?.currentKey || song?.metadata?.key || song?.originalKey)
    .filter(Boolean)
  preloadPadKeys(keys, padSet)
}

export function derivePadSetName(filename = '') {
  const base = filename.replace(/\.[^.]+$/, '')
  const sanitized = base.replace(/[^a-zA-Z0-9\s-]+/g, '')
  const spaced = sanitized.replace(/[-_]+/g, ' ').trim()
  return spaced || 'New Pad Set'
}

function getCacheState() {
  if (typeof localStorage === 'undefined') {
    return {}
  }
  try {
    return JSON.parse(localStorage.getItem(PAD_SET_CACHE_STATE_KEY)) || {}
  } catch {
    return {}
  }
}

function saveCacheState(state) {
  writeLocalStorage(PAD_SET_CACHE_STATE_KEY, JSON.stringify(state))
}

async function clearPadSetCache(cache, padSetId) {
  const keys = await cache.keys()
  const prefix = `/pad-sets/${encodeURIComponent(padSetId)}/`
  const removals = keys
    .filter(request => request.url.includes(prefix))
    .map(request => cache.delete(request))
  await Promise.all(removals)
}

async function ensurePadSetMetadata(padSet) {
  if (padSet.type !== 'drive') {
    return null
  }

  const cacheEntry = PAD_SET_METADATA_CACHE.get(padSet.id)
  if (cacheEntry && metadataMatches(cacheEntry, padSet)) {
    return cacheEntry.files
  }

  const cacheState = getCacheState()
  const storedEntry = cacheState[padSet.id]
  if (storedEntry && storedEntry.files && metadataMatches(storedEntry, padSet)) {
    PAD_SET_METADATA_CACHE.set(padSet.id, storedEntry)
    return storedEntry.files
  }

  const files = await listPadSetFiles(padSet.id)
  const fileMap = {}

  for (const file of files) {
    const keyFromProps = normalizePadKey(file.appProperties?.padKey)
    const key = keyFromProps || normalizePadKey(extractPadKeyFromFilename(file.name))
    if (key) {
      fileMap[key] = {
        fileId: file.id,
        mimeType: file.mimeType || 'audio/mpeg',
      }
    }
  }

  const missingKeys = PAD_FILE_KEYS.filter(key => !fileMap[key])
  if (missingKeys.length > 0) {
    throw new Error(`Pad set "${padSet.name}" is missing files for: ${missingKeys.join(', ')}`)
  }

  const entry = {
    modifiedTime: padSet.modifiedTime || new Date().toISOString(),
    cachedAt: new Date().toISOString(),
    files: fileMap,
  }

  cacheState[padSet.id] = entry
  saveCacheState(cacheState)
  PAD_SET_METADATA_CACHE.set(padSet.id, entry)
  return fileMap
}

function metadataMatches(entry, padSet) {
  if (!entry || !entry.files) return false
  if (!padSet?.modifiedTime) return true
  return entry.modifiedTime === padSet.modifiedTime
}

async function invalidatePadSetCache(padSetId) {
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

async function readZipEntries(file) {
  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  const view = new DataView(buffer)

  const eocdOffset = findEndOfCentralDirectory(bytes)
  if (eocdOffset < 0) {
    throw new Error('Invalid ZIP file (EOCD not found)')
  }

  const centralDirOffset = view.getUint32(eocdOffset + 16, true)
  const totalEntries = view.getUint16(eocdOffset + 10, true)

  const entries = []
  let cursor = centralDirOffset

  for (let i = 0; i < totalEntries; i++) {
    const signature = view.getUint32(cursor, true)
    if (signature !== 0x02014b50) {
      break
    }

    const flags = view.getUint16(cursor + 8, true)
    const compression = view.getUint16(cursor + 10, true)
    const compressedSize = view.getUint32(cursor + 20, true)
    const uncompressedSize = view.getUint32(cursor + 24, true)
    const fileNameLength = view.getUint16(cursor + 28, true)
    const extraLength = view.getUint16(cursor + 30, true)
    const commentLength = view.getUint16(cursor + 32, true)
    const localHeaderOffset = view.getUint32(cursor + 42, true)

    const fileNameBytes = bytes.slice(cursor + 46, cursor + 46 + fileNameLength)
    const fileName = new TextDecoder().decode(fileNameBytes)

    entries.push({
      fileName,
      flags,
      compression,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    })

    cursor += 46 + fileNameLength + extraLength + commentLength
  }

  return { bytes, view, entries }
}

async function extractPadFiles(zipContext) {
  const padFiles = new Map()

  for (const entry of zipContext.entries) {
    if (!entry.fileName || entry.fileName.endsWith('/')) continue
    if (!entry.fileName.toLowerCase().endsWith('.mp3')) continue
    if (entry.flags & 0x01) {
      throw new Error('Encrypted ZIP archives are not supported.')
    }

    const key = normalizePadKey(extractPadKeyFromFilename(entry.fileName))
    if (!key) continue

    const data = await extractEntryData(zipContext, entry)
    const existing = padFiles.get(key)
    if (!existing || entry.fileName.length < existing.pathLength) {
      padFiles.set(key, { data, pathLength: entry.fileName.length })
    }
  }

  const normalized = new Map()
  for (const [key, value] of padFiles.entries()) {
    normalized.set(key, value.data)
  }
  return normalized
}

async function extractEntryData(zipContext, entry) {
  const { bytes, view } = zipContext
  const { localHeaderOffset } = entry

  const signature = view.getUint32(localHeaderOffset, true)
  if (signature !== 0x04034b50) {
    throw new Error('Invalid ZIP local header')
  }

  const fileNameLength = view.getUint16(localHeaderOffset + 26, true)
  const extraLength = view.getUint16(localHeaderOffset + 28, true)
  const dataStart = localHeaderOffset + 30 + fileNameLength + extraLength
  const dataEnd = dataStart + entry.compressedSize
  const compressedData = bytes.slice(dataStart, dataEnd)

  if (entry.compression === 0) {
    return compressedData
  }

  if (entry.compression === 8) {
    return await inflateRaw(compressedData)
  }

  throw new Error(`Unsupported ZIP compression method: ${entry.compression}`)
}

async function inflateRaw(data) {
  const blob = new Blob([data])
  const streams = ['deflate-raw', 'deflate']

  for (const algo of streams) {
    try {
      const decompressedStream = blob.stream().pipeThrough(new DecompressionStream(algo))
      const arrayBuffer = await new Response(decompressedStream).arrayBuffer()
      return new Uint8Array(arrayBuffer)
    } catch {
      // Try next algorithm
    }
  }

  throw new Error('Browser does not support deflate decompression for ZIP uploads')
}

function findEndOfCentralDirectory(bytes) {
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (
      bytes[i] === 0x50 &&
      bytes[i + 1] === 0x4b &&
      bytes[i + 2] === 0x05 &&
      bytes[i + 3] === 0x06
    ) {
      return i
    }
  }
  return -1
}

function readLocalStorage(key) {
  if (typeof localStorage === 'undefined') {
    return null
  }
  return localStorage.getItem(key)
}

function writeLocalStorage(key, value) {
  if (typeof localStorage === 'undefined') {
    return
  }
  localStorage.setItem(key, value)
}
