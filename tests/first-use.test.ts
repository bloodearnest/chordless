import { expect } from '@open-wc/testing'
import { getCurrentDB } from '../src/js/db.ts'
import { maybeShowFirstUseSetup } from '../src/js/first-use.ts'
import { createSong } from '../src/js/song-utils.ts'
import {
  createSpace,
  deleteSpace,
  getCurrentSpace,
  listSpaces,
  setCurrentSpace,
} from '../src/js/space.ts'
import { suppressConsoleLogs } from './test-helpers.ts'

const { describe, it, beforeEach, afterEach } = window

suppressConsoleLogs()

const KEYS = ['setup-done', 'musician_type']

describe('maybeShowFirstUseSetup', () => {
  let before: { id: string | null; name: string }
  let spaceId: string

  beforeEach(async () => {
    for (const key of KEYS) localStorage.removeItem(key)
    before = getCurrentSpace()
    const space = await createSpace(`First use ${crypto.randomUUID().slice(0, 8)}`)
    spaceId = space.id
    await setCurrentSpace(space.id, space.name)
  })

  afterEach(async () => {
    document.querySelector('first-use-setup')?.remove()
    for (const key of KEYS) localStorage.removeItem(key)
    await deleteSpace(spaceId)
    if (before.id) await setCurrentSpace(before.id, before.name)
  })

  const shown = () => document.querySelector('first-use-setup') !== null

  it('does not ask again once the setup is done', async () => {
    localStorage.setItem('setup-done', '1')
    await maybeShowFirstUseSetup()
    expect(shown()).to.equal(false)
  })

  it('does not ask someone who has chosen a musician type, and remembers that', async () => {
    localStorage.setItem('musician_type', 'singer')
    await maybeShowFirstUseSetup()
    expect(shown()).to.equal(false)
    expect(localStorage.getItem('setup-done')).to.equal('1')
  })

  it('does not ask someone who has songs, and remembers that', async () => {
    await createSong('{title: First Use Song}\n[C]La la', {})
    await maybeShowFirstUseSetup()
    expect(shown()).to.equal(false)
    expect(localStorage.getItem('setup-done')).to.equal('1')
  })

  it('leaves someone who opens an invite with no space alone: no Personal space is made for them', async () => {
    const spacesBefore = (await listSpaces()).length
    localStorage.removeItem('current-space-id')
    window.history.replaceState(null, '', '/join#space-aaaa1111.abcdefghijklmnopqrstuv')
    try {
      await maybeShowFirstUseSetup()
    } finally {
      window.history.replaceState(null, '', '/')
      await setCurrentSpace(spaceId)
    }
    expect(shown()).to.equal(false)
    expect(localStorage.getItem('setup-done')).to.equal(null)
    expect((await listSpaces()).length).to.equal(spacesBefore)
  })

  it('asks a new user', async () => {
    const db = await getCurrentDB()
    expect(await db.getAllSongs()).to.have.length(0)
    await maybeShowFirstUseSetup()
    expect(shown()).to.equal(true)
  })

  describe('where storage is blocked', () => {
    const realGet = Storage.prototype.getItem
    const realSet = Storage.prototype.setItem
    afterEach(() => {
      Storage.prototype.getItem = realGet
      Storage.prototype.setItem = realSet
    })

    it('does not ask, as it cannot remember the answer', async () => {
      Storage.prototype.getItem = () => {
        throw new Error('blocked')
      }
      await maybeShowFirstUseSetup()
      expect(shown()).to.equal(false)
    })

    it('copes with not being able to save that the setup is done', async () => {
      Storage.prototype.setItem = () => {
        throw new Error('blocked')
      }
      localStorage.removeItem('setup-done')
      await createSong('{title: Blocked Song}\n[C]La', {})
      await maybeShowFirstUseSetup()
      expect(shown()).to.equal(false)
    })
  })
})
