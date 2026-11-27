/**
 * What `just backup` does with R2 (docs/BACKUP.md), apart from talking to Cloudflare, so that it is tested: the mirror of the
 * bucket on this computer, kept by key, that never loses an object. An object already there with the same etag and size is
 * left alone; one that changed is kept beside as `<key>.replaced-<old etag>`, and the new one saved; nothing is deleted
 * because the bucket no longer lists it (it may have been deleted by mistake: that is what this is for).
 */
import { mkdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'

export interface Listed {
  key: string
  etag: string
  size: number
}

export interface BackupDeps {
  /** One page of the bucket's objects, from a cursor (null for the first); `next` is null at the end */
  page(cursor: string | null): Promise<{ objects: Listed[]; next: string | null }>
  /** An object's bytes */
  fetch(key: string): Promise<Uint8Array>
  /** What the mirror holds already for a key: its etag and size, or null */
  held(key: string): { etag: string; size: number } | null
}

/** Every object in the bucket, following the cursor */
export async function listEverything(deps: Pick<BackupDeps, 'page'>): Promise<Listed[]> {
  const all: Listed[] = []
  let cursor: string | null = null
  do {
    const { objects, next }: { objects: Listed[]; next: string | null } = await deps.page(cursor)
    all.push(...objects)
    cursor = next
  } while (cursor)
  return all
}

/** Where a key is kept under the mirror: never outside it, whatever the key says */
export function mirrorPath(root: string, key: string): string {
  const base = resolve(root)
  const path = resolve(base, key)
  if (!path.startsWith(base + sep)) throw new Error(`Not a key to keep: ${key}`)
  return path
}

export interface MirrorReport {
  listed: number
  saved: number
  unchanged: number
  replaced: number
  bytes: number
  /** Objects whose bytes were not the size the bucket said, or that could not be fetched */
  failed: { key: string; reason: string }[]
}

/** Bring the mirror up to what the bucket lists, a few at a time */
export async function mirror(
  root: string,
  listed: Listed[],
  deps: Pick<BackupDeps, 'fetch' | 'held'>,
  parallel = 4
): Promise<MirrorReport> {
  const report: MirrorReport = {
    listed: listed.length,
    saved: 0,
    unchanged: 0,
    replaced: 0,
    bytes: 0,
    failed: [],
  }
  let next = 0
  const worker = async () => {
    while (next < listed.length) {
      const object = listed[next++]
      const have = deps.held(object.key)
      if (have && have.etag === object.etag && have.size === object.size) {
        report.unchanged++
        continue
      }
      try {
        const bytes = await deps.fetch(object.key)
        if (bytes.byteLength !== object.size)
          throw new Error(`${bytes.byteLength} bytes, not the ${object.size} listed`)
        const path = mirrorPath(root, object.key)
        mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
        if (have) {
          renameSync(path, `${path}.replaced-${have.etag}`)
          report.replaced++
        }
        writeFileSync(path, bytes, { mode: 0o600 })
        report.saved++
        report.bytes += bytes.byteLength
      } catch (error) {
        report.failed.push({
          key: object.key,
          reason: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(parallel, listed.length) }, worker))
  return report
}

/** What the mirror holds under a key, read from disk, for `held` (the etag is kept in a file beside it) */
export function heldOnDisk(root: string, etags: Map<string, string>) {
  return (key: string): { etag: string; size: number } | null => {
    const etag = etags.get(key)
    if (!etag) return null
    try {
      return { etag, size: statSync(mirrorPath(root, key)).size }
    } catch {
      return null
    }
  }
}

/** The keys the database refers to that the bucket does not list: a backup with any of these is not whole */
export function missingReferences(listed: Listed[], referenced: string[]): string[] {
  const keys = new Set(listed.map(object => object.key))
  return referenced.filter(key => !keys.has(key))
}

/** What the objects are, by where they are kept (library/<id>/songs/…/pdf/…, …/pads/…, a song bundle), for the summary */
export function kindOf(key: string): 'pdf' | 'pad' | 'song' | 'other' {
  if (/^library\/[^/]+\/songs\/[^/]+\/pdf\//.test(key)) return 'pdf'
  if (/^library\/[^/]+\/pads\//.test(key)) return 'pad'
  if (/^library\/[^/]+\/songs\/[^/]+\/[^/]+\.json$/.test(key)) return 'song'
  return 'other'
}

/** The write of a file that holds a person's data: readable by its owner alone */
export function writePrivate(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  writeFileSync(path, text, { mode: 0o600 })
}
