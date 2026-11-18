import { expect } from '@open-wc/testing'
import { ChordlessDB } from '../src/js/db.ts'
import { seedFromPreview, seedIfEmpty } from '../src/js/preview-seed.ts'
import { addChart } from '../src/js/song-utils.ts'
import { createExport, readExport } from '../src/js/space-export.ts'
import { deleteDatabase, suppressConsoleLogs } from './test-helpers.ts'

const { describe, it, beforeEach, afterEach } = window

suppressConsoleLogs()

const ADD = { variantLabel: 'Original', importSource: 'test', makeDefault: 'first' } as const

describe('Starting a branch preview from an export', () => {
  const sourceId = `space-${crypto.randomUUID()}`
  const destinationId = `space-${crypto.randomUUID()}`
  let source: ChordlessDB
  let destination: ChordlessDB

  beforeEach(async () => {
    source = new ChordlessDB(sourceId)
    await source.init()
    destination = new ChordlessDB(destinationId)
    await destination.init()
    await addChart(source, '{title: Alpha}\n{key: G}\n[G]Alpha line', ADD)
  })

  afterEach(async () => {
    source.db?.close()
    destination.db?.close()
    await deleteDatabase(sourceId)
    await deleteDatabase(destinationId)
  })

  async function exported() {
    return readExport(await createExport(source, 'Source'))
  }

  it('fills a space with no songs', async () => {
    const result = await seedIfEmpty(destination, await exported())
    expect(result?.songs).to.equal(1)
    expect(await destination.getAllSongs()).to.have.length(1)
  })

  it('leaves a space that has songs alone, so what a tester did is not undone', async () => {
    await addChart(destination, '{title: Mine}\n{key: D}\n[D]Mine', ADD)
    expect(await seedIfEmpty(destination, await exported())).to.equal(null)
    expect((await destination.getAllSongs()).map(song => song.title)).to.deep.equal(['Mine'])
  })

  it('imports what the server sends into the Personal space', async () => {
    const blob = await createExport(source, 'Source')
    const seed = () =>
      Promise.resolve(new Response(blob, { headers: { 'Content-Type': 'application/zip' } }))
    const result = await seedFromPreview(seed, () => Promise.resolve(destinationId))
    expect(result?.songs).to.equal(1)
    destination.db?.close()
    destination = new ChordlessDB(destinationId)
    await destination.init()
    expect(await destination.getAllSongs()).to.have.length(1)
    // (and a second visit finds songs there, and adds none)
    expect(await seedFromPreview(seed, () => Promise.resolve(destinationId))).to.equal(null)
  })

  it('does nothing where the server has no seed', async () => {
    const missing = () => Promise.resolve(new Response('', { status: 404 }))
    expect(await seedFromPreview(missing)).to.equal(null)
    // (a dev server answers an unknown path with its start page)
    const page = () =>
      Promise.resolve(new Response('<html>', { headers: { 'Content-Type': 'text/html' } }))
    expect(await seedFromPreview(page)).to.equal(null)
    // (and the real request, to a server that is not a preview's)
    expect(await seedFromPreview()).to.equal(null)
    const failing = () => Promise.reject(new Error('offline'))
    expect(await seedFromPreview(failing)).to.equal(null)
  })
})
