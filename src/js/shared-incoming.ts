/**
 * What was shared to Chordless from another app (the manifest's share_target).
 *
 * The share arrives as a POST the page never sees: the service worker takes it (service-worker.ts),
 * keeps the files and text here, in a cache of its own, and redirects to /import-song, whose page
 * then takes what was kept. So this works in both: only the Cache API and Fetch types, nothing of
 * the page or the worker's globals.
 */

export const SHARED_CACHE_NAME = 'shared-incoming-v1'

const FILE_PATH = '/shared/file/'
const TEXT_PATH = '/shared/text'
const TITLE_PATH = '/shared/title'
const URL_PATH = '/shared/url'

/** What was shared: files (ChordPro, PDFs), and/or text. Some apps put the text in `title` or `url` */
export interface Shared {
  files: File[]
  text: string
  title?: string
  url?: string
}

/** A cache key for a path (a cache is keyed by requests) */
const keyFor = (path: string) => new Request(new URL(path, globalThis.location.href))

/** Keep what a share's form held: its files, and the text of its `text` field */
export async function storeShared(
  form: FormData,
  cacheStorage: CacheStorage = caches
): Promise<void> {
  await cacheStorage.delete(SHARED_CACHE_NAME)
  const cache = await cacheStorage.open(SHARED_CACHE_NAME)
  let index = 0
  for (const value of form.getAll('files')) {
    if (typeof value === 'string') continue
    await cache.put(
      keyFor(`${FILE_PATH}${index++}`),
      new Response(value, {
        headers: {
          'Content-Type': value.type || 'application/octet-stream',
          'X-File-Name': encodeURIComponent(value.name),
        },
      })
    )
  }
  for (const [field, path] of [
    ['text', TEXT_PATH],
    ['title', TITLE_PATH],
    ['url', URL_PATH],
  ] as const) {
    const value = form.get(field)
    if (typeof value === 'string' && value.trim()) {
      await cache.put(
        keyFor(path),
        new Response(value, { headers: { 'Content-Type': 'text/plain' } })
      )
    }
  }
}

/** Take what was shared, if anything was: it is not kept once taken */
export async function takeShared(cacheStorage: CacheStorage = caches): Promise<Shared | null> {
  if (!(await cacheStorage.has(SHARED_CACHE_NAME))) return null
  const cache = await cacheStorage.open(SHARED_CACHE_NAME)
  const files: File[] = []
  let text = ''
  let title = ''
  let url = ''
  for (const request of await cache.keys()) {
    const path = new URL(request.url).pathname
    const response = await cache.match(request)
    if (!response) continue
    if (path === TEXT_PATH) {
      text = await response.text()
    } else if (path === TITLE_PATH) {
      title = await response.text()
    } else if (path === URL_PATH) {
      url = await response.text()
    } else if (path.startsWith(FILE_PATH)) {
      const name = decodeURIComponent(response.headers.get('X-File-Name') ?? 'shared')
      const type = response.headers.get('Content-Type') ?? ''
      files.push(new File([await response.blob()], name, { type }))
    }
  }
  await cacheStorage.delete(SHARED_CACHE_NAME)
  return files.length || text || title || url ? { files, text, title, url } : null
}
