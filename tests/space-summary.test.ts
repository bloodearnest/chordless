import { expect } from '@open-wc/testing'
import { ChordlessDB } from '../src/js/db.ts'
import { addChart } from '../src/js/song-utils.ts'
import { summaryOf } from '../src/js/space-summary.ts'
import { formatBytes } from '../src/js/utils/bytes.ts'
import { makeSetlist } from './builders.ts'
import { deleteDatabase, suppressConsoleLogs } from './test-helpers.ts'

const { describe, it } = window

suppressConsoleLogs()

describe('formatBytes', () => {
  it('reads in the unit that suits the size', () => {
    expect(formatBytes(0)).to.equal('0 B')
    expect(formatBytes(1023)).to.equal('1023 B')
    expect(formatBytes(1024)).to.equal('1 KB')
    expect(formatBytes(1536 * 1024)).to.equal('1.5 MB')
    expect(formatBytes(3 * 1024 ** 3)).to.equal('3.0 GB')
  })
})

describe('summaryOf', () => {
  it('counts a space’s songs and setlists and adds up about how big they are', async () => {
    const id = `space-${crypto.randomUUID()}`
    const db = new ChordlessDB(id)
    await db.init()
    const chart = '{title: Alpha}\n{key: G}\n[G]Alpha line'
    await addChart(db, chart, { variantLabel: 'Test', importSource: 'test', makeDefault: 'first' })
    await db.saveSetlist(makeSetlist({ id: 'one', date: '2026-12-06' }))
    await db.saveSetlist(makeSetlist({ id: 'two', date: '2026-12-13' }))
    db.db?.close()

    const summary = await summaryOf(id)
    expect(summary.songs).to.equal(1)
    expect(summary.setlists).to.equal(2)
    expect(summary.bytes).to.be.greaterThan(new Blob([chart]).size)
    await deleteDatabase(id)
  })

  it('is empty for a space with nothing in it', async () => {
    const id = `space-${crypto.randomUUID()}`
    expect(await summaryOf(id)).to.deep.equal({ songs: 0, setlists: 0, bytes: 0 })
    await deleteDatabase(id)
  })
})
