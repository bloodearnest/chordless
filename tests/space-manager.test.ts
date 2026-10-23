/**
 * One space's data (space-manager.ts): what it shows for a Personal space and for a Team, and
 * deleting from this device. The sign-in is the fake service worker's and Drive a
 * fake Drive.
 */
import { expect, fixture, html } from '@open-wc/testing'
import type { AppModal } from '../src/components/app-modal.ts'
import { SpaceImportedEvent } from '../src/components/space-export-panel.ts'
import { SpaceGoneEvent, type SpaceManager } from '../src/components/space-manager.ts'
import '../src/components/space-manager.ts'
import type { Space } from '../src/js/data-types.ts'
import { ChordlessDB } from '../src/js/db.ts'
import { forgetSync } from '../src/js/last-sync.ts'
import { addChart } from '../src/js/song-utils.ts'
import {
  createSpace,
  deleteSpace,
  getCurrentSpace,
  getSpaceById,
  setCurrentSpace,
  updateSpace,
} from '../src/js/space.ts'
import { SpaceDB } from '../src/js/space-db.ts'
import { makeSetlist } from './builders.ts'
import { installFakeAuthWorker } from './fake-auth-worker.ts'
import { installFakeDrive } from './fake-drive.ts'
import { must } from './must.ts'
import { suppressConsoleLogs, wait } from './test-helpers.ts'

const { describe, it, beforeEach, afterEach } = window

suppressConsoleLogs()

describe('space-manager', () => {
  let drive: ReturnType<typeof installFakeDrive>
  let uninstallWorker: () => void
  let before: { id: string | null; name: string }
  let gone: number
  const made: string[] = []

  beforeEach(() => {
    drive = installFakeDrive()
    ;({ uninstall: uninstallWorker } = installFakeAuthWorker())
    before = getCurrentSpace()
    gone = 0
  })

  afterEach(async () => {
    drive.uninstall()
    uninstallWorker()
    for (const id of made.splice(0)) {
      forgetSync(id)
      await deleteSpace(id).catch(() => {})
    }
    if (before.id) await setCurrentSpace(before.id, before.name)
  })

  async function space(name: string, updates: Partial<Space> = {}): Promise<Space> {
    const created = await createSpace(`${name} ${crypto.randomUUID().slice(0, 8)}`)
    made.push(created.id)
    const db = new ChordlessDB(created.id)
    await db.init()
    await addChart(db, '{title: Alpha}\n{key: G}\n[G]Alpha line', {
      variantLabel: 'Original',
      importSource: 'test',
      makeDefault: 'first',
    })
    db.db?.close()
    return Object.keys(updates).length ? updateSpace(created.id, updates) : created
  }

  async function page(spaceId: string) {
    const el = await fixture<SpaceManager>(
      html`<space-manager .spaceId=${spaceId}></space-manager>`
    )
    el.addEventListener(SpaceGoneEvent.type, () => gone++)
    for (let i = 0; i < 100 && !el._summary && !el._missing; i++) await wait(20)
    await el.updateComplete
    return el
  }
  const labels = (el: SpaceManager) =>
    Array.from(el.shadowRoot?.querySelectorAll('.chip') ?? []).map(chip => chip.textContent?.trim())
  const text = (el: SpaceManager) => (el.shadowRoot?.textContent ?? '').replace(/\s+/g, ' ')
  const has = (el: SpaceManager, selector: string) =>
    el.shadowRoot?.querySelector(selector) !== null

  async function answer(el: SpaceManager, heading: string, confirm: boolean) {
    const modal = must(el.shadowRoot?.querySelector<AppModal>(`app-modal[heading="${heading}"]`))
    for (let i = 0; i < 50 && !modal.open; i++) await wait(20)
    await modal.updateComplete
    must(
      modal.shadowRoot?.querySelector<HTMLElement>(
        confirm ? '.modal-btn-confirm' : '.modal-btn-cancel'
      )
    ).click()
    return modal
  }

  it('says there is no such space for an id this device does not have', async () => {
    const el = await page('no-such-space')
    expect(text(el)).to.contain('no such Personal space or Team')
  })

  it('shows a Personal space: what it holds, sync, export and import, and delete; no people', async () => {
    const mine = await space('Mine')
    const other = await space('Other')
    await setCurrentSpace(other.id, other.name)
    const el = await page(mine.id)
    expect(labels(el)).to.deep.equal(['Personal'])
    expect(text(el)).to.match(/1 song · 0 setlists · about \d+ B/)
    expect(has(el, 'drive-sync-panel')).to.equal(true)
    expect(has(el, 'space-export-panel')).to.equal(true)
    expect(has(el, 'team-share-panel')).to.equal(false)
    expect(text(el)).to.contain('Delete from this device')
    expect(has(el, '#switch')).to.equal(false)
  })

  it('labels nothing for a personal space that is still called Personal', async () => {
    const created = await createSpace('Personal')
    made.push(created.id)
    const el = await page(created.id)
    expect(labels(el)).to.deep.equal([])
  })

  it('says what the person is in a Team, and leaves the people to their own modal', async () => {
    const team = await space('Team', { team: { id: 'space-gggg7777', role: 'owner' } })
    const el = await page(team.id)
    expect(labels(el)).to.deep.equal(['Team', 'Owner'])
    expect(has(el, 'team-share-panel')).to.equal(false)
  })

  it('has no sync button of its own: that is on the card', async () => {
    const mine = await space('Mine')
    const el = await page(mine.id)
    expect(text(el)).to.not.contain('Sync with Drive')
  })

  it('offers a Team member the Team copy, which needs no Drive', async () => {
    const team = await space('Team', { team: { id: 'space-hhhh8888', role: 'reader' } })
    const el = await page(team.id)
    expect(text(el)).to.contain('Team copy')
  })

  it('lets a Team member sync with a sign-in that has no Drive', async () => {
    const team = await space('Team', { team: { id: 'space-jjjj1010', role: 'reader' } })
    const el = await page(team.id)
    el._signIn = 'no-drive'
    await el.updateComplete
    expect(
      must(el.shadowRoot?.querySelector('drive-sync-panel')).hasAttribute('disabled')
    ).to.equal(false)
    expect(text(el)).to.not.contain('Sign in on the Account and Teams page')
    const mine = await space('Mine')
    const own = await page(mine.id)
    own._signIn = 'no-drive'
    await own.updateComplete
    expect(
      must(own.shadowRoot?.querySelector('drive-sync-panel')).hasAttribute('disabled')
    ).to.equal(true)
    expect(text(own)).to.contain('Google Drive is not connected')
    expect(text(own)).to.not.contain('Sign in on the Account and Teams page to sync')
    own._signIn = 'signed-in'
    await own.updateComplete
    expect(
      must(own.shadowRoot?.querySelector('drive-sync-panel')).hasAttribute('disabled')
    ).to.equal(false)
  })

  it('says one song and one setlist in the singular', async () => {
    const mine = await space('Mine')
    const db = new ChordlessDB(mine.id)
    await db.init()
    await db.saveSetlist(makeSetlist({ id: 'only', date: '2026-12-06' }))
    db.db?.close()
    const el = await page(mine.id)
    expect(text(el)).to.match(/1 song · 1 setlist · about \d+ B/)
  })

  it('says to sign in to sync when no one is signed in', async () => {
    const mine = await space('Mine')
    const el = await page(mine.id)
    expect(text(el)).to.contain('Sign in on the Account and Teams page to sync')
    expect(
      must(el.shadowRoot?.querySelector('drive-sync-panel')).hasAttribute('disabled')
    ).to.equal(true)
  })

  it('does not offer pad sets in the export while the media player is off', async () => {
    localStorage.setItem('media-settings', JSON.stringify({ mediaPlayerEnabled: false }))
    try {
      const mine = await space('Mine')
      const el = await page(mine.id)
      expect(
        must(el.shadowRoot?.querySelector('space-export-panel')).hasAttribute('show-pads')
      ).to.equal(false)
    } finally {
      localStorage.removeItem('media-settings')
    }
  })

  describe('the space in use', () => {
    it('is marked as current, and cannot be deleted', async () => {
      const mine = await space('Mine')
      await setCurrentSpace(mine.id, mine.name)
      const el = await page(mine.id)
      expect(text(el)).to.contain('Current')
      expect(must(el.shadowRoot?.querySelector<HTMLButtonElement>('#delete')).disabled).to.equal(
        true
      )
      expect(text(el)).to.contain('switch to another first')
    })
  })

  describe('deleting from this device', () => {
    it('asks first, saying Drive is not touched, then deletes only that one and says it is gone', async () => {
      const mine = await space('Mine')
      const other = await space('Other')
      await setCurrentSpace(other.id, other.name)
      const el = await page(mine.id)
      must(el.shadowRoot?.querySelector<HTMLButtonElement>('#delete')).click()
      const modal = await answer(el, 'Delete from this device?', true)
      expect(modal.message).to.contain(`Delete "${mine.name}" from this device?`)
      expect(modal.message).to.contain('folder in Google Drive is not touched')
      expect(modal.message).to.not.contain('You stay in the Team')
      for (let i = 0; i < 50 && gone === 0; i++) await wait(20)
      expect(gone).to.equal(1)
      expect(await getSpaceById(mine.id)).to.equal(undefined)
      expect(await getSpaceById(other.id)).to.not.equal(undefined)
    })

    it('tells a Team’s member that they stay in the Team', async () => {
      const team = await space('Team', { team: { id: 'space-iiii9999', role: 'writer' } })
      const el = await page(team.id)
      must(el.shadowRoot?.querySelector<HTMLButtonElement>('#delete')).click()
      const modal = await answer(el, 'Delete from this device?', false)
      expect(modal.message).to.contain('You stay in the Team')
    })

    it('does nothing when told no', async () => {
      const mine = await space('Mine')
      const el = await page(mine.id)
      must(el.shadowRoot?.querySelector<HTMLButtonElement>('#delete')).click()
      await answer(el, 'Delete from this device?', false)
      await wait(50)
      expect(gone).to.equal(0)
      expect(await getSpaceById(mine.id)).to.not.equal(undefined)
    })

    it('says so when it cannot', async () => {
      const mine = await space('Mine')
      const el = await page(mine.id)
      const proto = SpaceDB.prototype
      const real = proto.deleteSpace
      proto.deleteSpace = () => Promise.reject(new Error('disk full'))
      try {
        must(el.shadowRoot?.querySelector<HTMLButtonElement>('#delete')).click()
        await answer(el, 'Delete from this device?', true)
        for (let i = 0; i < 50 && !text(el).includes('disk full'); i++) await wait(20)
        expect(text(el)).to.contain('Failed to delete it: disk full')
        expect(gone).to.equal(0)
      } finally {
        proto.deleteSpace = real
      }
    })
  })

  it('looks again at the space when it is told it changed (an import, or sharing ended)', async () => {
    const mine = await space('Mine')
    const el = await page(mine.id)
    const db = new ChordlessDB(mine.id)
    await db.init()
    await addChart(db, '{title: Beta}\n{key: D}\n[D]Beta line', {
      variantLabel: 'Original',
      importSource: 'test',
      makeDefault: 'first',
    })
    db.db?.close()
    el.shadowRoot?.querySelector('space-export-panel')?.dispatchEvent(new SpaceImportedEvent())
    for (let i = 0; i < 50 && !text(el).includes('2 songs'); i++) await wait(20)
    expect(text(el)).to.contain('2 songs')
  })

  it('shows a different space when it is given another id', async () => {
    const one = await space('One')
    const two = await space('Two')
    const el = await page(one.id)
    expect(el._space?.name).to.equal(one.name)
    el.spaceId = two.id
    for (let i = 0; i < 50 && el._space?.name !== two.name; i++) await wait(20)
    expect(el._space?.name).to.equal(two.name)
  })
})
