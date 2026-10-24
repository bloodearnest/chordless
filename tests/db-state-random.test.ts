/**
 * The rule of docs/STATE.md, held against random histories: a record has the content that was
 * last written to it by whoever wrote content (a page, or a pull), and the link to its file that
 * was last written by whoever wrote the link (a sync), and neither writer undoes the other's,
 * whatever order they come in, and whatever stale copy a page was holding.
 *
 * A history is a seeded run of writes to one setlist, checked against a model after each.
 * A failure names its seed: `SEEDS` (or a single number) reproduces the same history.
 */
import { expect } from '@open-wc/testing'
import type { Setlist } from '../src/js/data-types.ts'
import { ChordlessDB } from '../src/js/db.ts'
import { makeEntry, makeSetlist } from './builders.ts'
import { must } from './must.ts'
import { deleteDatabase, suppressConsoleLogs, uniqueName } from './test-helpers.ts'

const { describe, it } = window

suppressConsoleLogs()

const SEEDS = Array.from({ length: 40 }, (_, i) => i + 1)
const STEPS = 30

/** A small seeded random number generator, so a failing history can be replayed */
function random(seed: number) {
  let a = seed
  const next = () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return { int: (n: number) => Math.floor(next() * n) }
}

/** What a page writes and a pull brings: the setlist's own content */
interface Content {
  name: string
  songs: string[]
}

/** What a sync keeps of the setlist's file */
interface Link {
  fileRef: string | null
  fileRev: string | null
  lastSyncedAt: string | null
  syncedContentHash: string | null
}

const NO_LINK: Link = { fileRef: null, fileRev: null, lastSyncedAt: null, syncedContentHash: null }

const contentOf = (setlist: Setlist): Content => ({
  name: setlist.name,
  songs: setlist.songs.map(entry => entry.songId),
})
const linkOf = (setlist: Setlist): Link => ({
  fileRef: setlist.fileRef ?? null,
  fileRev: setlist.fileRev ?? null,
  lastSyncedAt: setlist.lastSyncedAt ?? null,
  syncedContentHash: setlist.syncedContentHash ?? null,
})
const entries = (songs: string[]) =>
  songs.map((songId, order) => makeEntry({ order, songId, songUuid: `uuid-${songId}` }))

describe('what is stored, under any order of writers', () => {
  async function runHistory(seed: number) {
    const rng = random(seed)
    const name = uniqueName()
    const page = new ChordlessDB(name)
    const sync = new ChordlessDB(name, 'sync')
    await page.init()
    await sync.init()
    try {
      let content: Content = { name: 'start', songs: [] }
      let link: Link = { ...NO_LINK }
      await page.saveSetlist(makeSetlist({ id: 'one', name: 'start', songs: [] }))
      // What a page loaded at some earlier time: a copy it may save later
      const snapshots: { content: Content; link: Link }[] = [{ content, link }]
      const trail: string[] = []

      for (let step = 0; step < STEPS; step++) {
        const op = rng.int(6)
        if (op === 0) {
          const next = `name-${step}`
          trail.push(`page renames to ${next}`)
          await page.updateSetlist('one', setlist => {
            setlist.name = next
          })
          content = { ...content, name: next }
        } else if (op === 1) {
          const song = `song-${step}`
          trail.push(`page adds ${song}`)
          await page.updateSetlist('one', setlist => {
            setlist.songs.push(makeEntry({ order: setlist.songs.length, songId: song }))
          })
          content = { ...content, songs: [...content.songs, song] }
        } else if (op === 2) {
          // A sync records that it sent an older read of the setlist: only the link is taken
          const old = snapshots[rng.int(snapshots.length)]
          const sent: Link = {
            fileRef: `file-${seed}`,
            fileRev: `rev-${step}`,
            lastSyncedAt: `2026-10-24T10:${String(step).padStart(2, '0')}:00.000Z`,
            syncedContentHash: `hash-${step}`,
          }
          trail.push(`sync records it sent an old read (${old.content.name}) as ${sent.fileRev}`)
          await sync.saveSetlistsSent([
            makeSetlist({
              id: 'one',
              name: old.content.name,
              songs: entries(old.content.songs),
              ...sent,
            }),
          ])
          link = sent
        } else if (op === 3) {
          // A pull brings content from storage, with the link of the file it came from
          const pulled: Content = { name: `pulled-${step}`, songs: [`pulled-song-${step}`] }
          const pulledLink: Link = {
            fileRef: `file-${seed}`,
            fileRev: `rev-${step}`,
            lastSyncedAt: `2026-10-24T11:${String(step).padStart(2, '0')}:00.000Z`,
            syncedContentHash: `hash-${step}`,
          }
          trail.push(`pull brings ${pulled.name}`)
          await sync.saveSetlistsBatch([
            makeSetlist({
              id: 'one',
              name: pulled.name,
              songs: entries(pulled.songs),
              ...pulledLink,
            }),
          ])
          content = pulled
          link = pulledLink
        } else if (op === 4) {
          // A page saves a whole copy it loaded earlier, which has no link to the file
          const old = snapshots[rng.int(snapshots.length)]
          trail.push(`page saves an old copy (${old.content.name}) with no link`)
          await page.saveSetlist(
            makeSetlist({ id: 'one', name: old.content.name, songs: entries(old.content.songs) })
          )
          content = old.content
          // (the link the stored record has is kept)
        } else {
          snapshots.push({ content, link })
          trail.push('a page loads the setlist')
          continue
        }

        const stored = must(await page.getSetlist('one'))
        expect(
          { content: contentOf(stored), link: linkOf(stored) },
          `seed ${seed}, step ${step}: ${trail.join('; ')}`
        ).to.deep.equal({ content, link })
      }
    } finally {
      page.db?.close()
      sync.db?.close()
      await deleteDatabase(name)
    }
  }

  for (const seed of SEEDS) {
    it(`keeps each writer's part, history ${seed}`, async () => {
      await runHistory(seed)
    })
  }
})
