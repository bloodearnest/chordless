/**
 * Making, updating and ending a setlist's share link (docs/SHARING.md), against the
 * space's database and files. The bundle and encryption are in share-bundle.ts
 * and share-crypto.ts; the files are written through the storage API (storage/types.ts).
 */

import type { Setlist, SetlistShare } from './data-types.ts'
import type { ChordlessDB } from './db.ts'
import { fileInput, shareFileMetadata, updateInput } from './drive-metadata.ts'
import {
  buildShareBundle,
  bundleHash,
  isExpired,
  type ShareSource,
  shareExpiry,
} from './share-bundle.ts'
import { encryptBundle, generateShareKey } from './share-crypto.ts'
import { getSongById } from './song-utils.ts'
import type { SpaceStorage } from './storage/types.ts'
import { toLocalDateString } from './utils/date-utils.ts'

/** An orphaned share file (no setlist points at it) is left alone this long, so a share another device is still recording is not ended under it */
const ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000

export interface ShareContext {
  db: ChordlessDB
  spaceId: string | null
  /** The space's files */
  space: SpaceStorage
  /** For tests: today's YYYY-MM-DD, and the current time */
  today?: string
  now?: Date
}

const todayOf = ({ today, now }: ShareContext) => today ?? toLocalDateString(now ?? new Date())

/** Each of a setlist's songs with its chart, as the bundle needs them. A song missing from the library is left out. */
async function loadShareSources(setlist: Setlist, db: ChordlessDB): Promise<ShareSource[]> {
  const sources: ShareSource[] = []
  for (const entry of setlist.songs) {
    try {
      const song = await getSongById(entry.songId, db)
      sources.push({
        entry,
        title: song.title,
        songKey: song.key ?? null,
        songTempo: song.tempo ?? null,
        chordpro: song.chordpro,
      })
    } catch (error) {
      if (entry.chordproEdits) {
        sources.push({
          entry,
          title: entry.songId,
          songKey: null,
          chordpro: entry.chordproEdits,
        })
      } else {
        console.warn('[Share] Song not in the library, left out:', entry.songId, error)
      }
    }
  }
  return sources
}

/** The bundle for a setlist as it is now, its hash, and the file to upload for a key */
async function prepare(setlist: Setlist, key: string, expires: string, ctx: ShareContext) {
  const bundle = buildShareBundle(setlist, await loadShareSources(setlist, ctx.db), {
    expires,
    setlistId: setlist.id,
  })
  return { bundle, hash: await bundleHash(bundle), file: () => encryptBundle(key, bundle) }
}

/**
 * Share a setlist: upload its bundle as a public encrypted file and return the share to record
 * on it. Needs to be online. The caller saves the setlist with it.
 */
export async function createShare(setlist: Setlist, ctx: ShareContext): Promise<SetlistShare> {
  const created = todayOf(ctx)
  const expires = shareExpiry(setlist.date, created)
  const key = generateShareKey()
  const { hash, file } = await prepare(setlist, key, expires, ctx)

  const metadata = shareFileMetadata(setlist, { spaceId: ctx.spaceId, expires })
  const { file: stored } = await ctx.space.create('shares', fileInput(metadata), await file(), {
    publicLink: true,
  })
  return { fileId: stored.ref, key, created, expires, bundleHash: hash }
}

/**
 * Bring a share up to date with its setlist: nothing if the bundle is unchanged, otherwise the
 * same file with new content (the link doesn't change). Returns the share to record, or the
 * same object if nothing changed.
 */
export async function refreshShare(
  setlist: Setlist & { share: SetlistShare },
  ctx: ShareContext
): Promise<SetlistShare> {
  const { share } = setlist
  const expires = shareExpiry(setlist.date, share.created)
  const { hash, file } = await prepare(setlist, share.key, expires, ctx)
  if (hash === share.bundleHash && expires === share.expires) return share

  const metadata = shareFileMetadata(setlist, { spaceId: ctx.spaceId, expires })
  await ctx.space.update(share.fileId, updateInput(metadata, 'share'), await file())
  return { ...share, expires, bundleHash: hash }
}

/** Stop sharing: end access, then trash the file. The caller clears the setlist's share. */
export async function stopShare(
  share: Pick<SetlistShare, 'fileId'>,
  space: SpaceStorage
): Promise<void> {
  // The public link goes first: a file in the bin can still be read by anyone who has the link
  await space.unpublish(share.fileId)
  await space.trash(share.fileId)
}

/**
 * What a sync does about shares, before it pushes setlists (so the changes it makes to setlists
 * go up in the same sync):
 * 1. Update each live share whose setlist changed.
 * 2. End shares that have expired and clear them from their setlists.
 * 3. End share files nothing points at any more (a stopped or deleted setlist), once old enough.
 * A share that fails is left for the next sync: the others carry on. Returns how many setlists
 * it changed.
 */
export async function syncShares(ctx: ShareContext): Promise<number> {
  const today = todayOf(ctx)
  const now = ctx.now ?? new Date()
  const setlists = await ctx.db.getAllSetlists()
  let changed = 0

  for (const setlist of setlists) {
    const { share } = setlist
    if (!share || setlist.deletedAt) continue
    try {
      if (isExpired(share.expires, today)) {
        await stopShare(share, ctx.space)
        // (the setlist as it is stored now: ending the share took a while)
        await ctx.db.updateSetlist(setlist.id, stored => {
          stored.share = null
        })
        changed++
      } else {
        const refreshed = await refreshShare({ ...setlist, share }, ctx)
        if (refreshed !== share) {
          await ctx.db.updateSetlist(setlist.id, stored => {
            stored.share = refreshed
          })
          changed++
        }
      }
    } catch (error) {
      console.error(`[Share] Could not sync the share of setlist ${setlist.id}:`, error)
    }
  }

  try {
    const live = new Map(
      (await ctx.db.getAllSetlists()).flatMap(s =>
        s.share && !s.deletedAt ? [[s.share.fileId, s] as const] : []
      )
    )
    for (const file of await ctx.space.list('shares')) {
      const expires = file.props.expires
      const pointedAt = live.has(file.ref)
      const old = Date.parse(file.modified as string) < now.getTime() - ORPHAN_GRACE_MS
      const expired = expires !== undefined && isExpired(expires, today)
      if (expired || (!pointedAt && old)) {
        try {
          await stopShare({ fileId: file.ref }, ctx.space)
        } catch (error) {
          console.error(`[Share] Could not end share file ${file.ref}:`, error)
        }
      }
    }
  } catch (error) {
    console.error('[Share] Could not clean up share files:', error)
  }
  return changed
}
