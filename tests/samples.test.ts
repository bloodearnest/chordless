import { expect } from '@open-wc/testing'
import { getCurrentDB } from '../src/js/db.ts'
import {
  createOrganisation,
  deleteOrganisation,
  getCurrentOrganisation,
  setCurrentOrganisation,
} from '../src/js/organisation.ts'
import { addSampleSetlist, SAMPLE_SOURCE } from '../src/js/samples.ts'
import { suppressConsoleLogs } from './test-helpers.ts'

const { describe, it, beforeEach, afterEach } = window

suppressConsoleLogs()

const INDEX = JSON.stringify({
  setlistName: 'Try it',
  songs: ['one.chordpro', 'two.chordpro', 'untitled.chordpro'],
})

const FILES: Record<string, string> = {
  '/samples/index.json': INDEX,
  '/samples/one.chordpro': '{title: Sample One}\n{key: G}\n{tempo: 90}\n[G]Hello',
  '/samples/two.chordpro': '{title: Sample Two}\n[C]World',
  '/samples/untitled.chordpro': '[D]No title here',
}

describe('addSampleSetlist', () => {
  const realFetch = window.fetch
  let before: { id: string | null; name: string }
  let organisationId: string

  beforeEach(async () => {
    window.fetch = (async (input: RequestInfo | URL) => {
      const body = FILES[String(input)]
      return body === undefined ? new Response('', { status: 404 }) : new Response(body)
    }) as typeof fetch
    before = getCurrentOrganisation()
    const organisation = await createOrganisation(`Samples ${crypto.randomUUID().slice(0, 8)}`)
    organisationId = organisation.id
    await setCurrentOrganisation(organisation.id, organisation.name)
  })

  afterEach(async () => {
    window.fetch = realFetch
    FILES['/samples/index.json'] = INDEX
    await deleteOrganisation(organisationId)
    if (before.id) await setCurrentOrganisation(before.id, before.name)
  })

  it('adds the songs and a setlist of them, reusing a song the library has', async () => {
    const id = await addSampleSetlist()
    const db = await getCurrentDB()
    const setlist = await db.getSetlist(id)
    expect(setlist?.name).to.equal('Try it')
    expect(setlist?.songs.map(entry => entry.order)).to.deep.equal([0, 1, 2])
    expect(setlist?.songs[0].key).to.equal('G')
    expect(setlist?.songs[0].tempo).to.equal(90)
    expect(setlist?.songs[1].tempo).to.equal(null)
    const songs = await db.getAllSongs()
    expect(songs).to.have.length(3)
    expect(songs.every(song => song.importSource === SAMPLE_SOURCE)).to.equal(true)
  })

  it('reuses a song the library has already', async () => {
    FILES['/samples/index.json'] = JSON.stringify({
      setlistName: 'Try it',
      songs: ['one.chordpro', 'two.chordpro'],
    })
    await addSampleSetlist()
    await addSampleSetlist()
    const db = await getCurrentDB()
    expect(await db.getAllSongs()).to.have.length(2)
  })

  it('fails when a file cannot be fetched', async () => {
    delete FILES['/samples/two.chordpro']
    try {
      await addSampleSetlist()
      expect.fail('should have thrown')
    } catch (error) {
      expect((error as Error).message).to.contain('/samples/two.chordpro (404)')
    } finally {
      FILES['/samples/two.chordpro'] = '{title: Sample Two}\n[C]World'
    }
  })
})
