import { expect } from '@open-wc/testing'
import { getCurrentDB } from '../src/js/db.ts'
import { maybeShowFirstUseSetup } from '../src/js/first-use.ts'
import {
  createOrganisation,
  deleteOrganisation,
  getCurrentOrganisation,
  setCurrentOrganisation,
} from '../src/js/organisation.ts'
import { createSong } from '../src/js/song-utils.ts'
import { suppressConsoleLogs } from './test-helpers.ts'

const { describe, it, beforeEach, afterEach } = window

suppressConsoleLogs()

const KEYS = ['setup-done', 'musician_type']

describe('maybeShowFirstUseSetup', () => {
  let before: { id: string | null; name: string }
  let organisationId: string

  beforeEach(async () => {
    for (const key of KEYS) localStorage.removeItem(key)
    before = getCurrentOrganisation()
    const organisation = await createOrganisation(`First use ${crypto.randomUUID().slice(0, 8)}`)
    organisationId = organisation.id
    await setCurrentOrganisation(organisation.id, organisation.name)
  })

  afterEach(async () => {
    document.querySelector('first-use-setup')?.remove()
    for (const key of KEYS) localStorage.removeItem(key)
    await deleteOrganisation(organisationId)
    if (before.id) await setCurrentOrganisation(before.id, before.name)
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
