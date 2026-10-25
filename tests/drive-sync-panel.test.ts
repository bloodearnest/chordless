import { expect, fixture, html, waitUntil } from '@open-wc/testing'
import type { AppModal } from '../src/components/app-modal.ts'
import { DriveSyncPanel } from '../src/components/drive-sync-panel.ts'
import { ChordlessDB } from '../src/js/db.ts'
import { ROOT_FOLDER_NAME } from '../src/js/drive-client.ts'
import {
  createSpace,
  deleteSpace,
  getCurrentSpace,
  getSpaceById,
  setCurrentSpace,
  setSpaceReadOnly,
  updateSpace,
} from '../src/js/space.ts'
import { createSyncOrchestrator } from '../src/js/sync-orchestrator.ts'
import { makeSetlist } from './builders.ts'
import { installFakeDrive } from './fake-drive.ts'
import { must } from './must.ts'
import { suppressConsoleLogs, wait } from './test-helpers.ts'

const { describe, it, beforeEach, afterEach } = window

suppressConsoleLogs()

describe('drive-sync-panel', () => {
  let drive: ReturnType<typeof installFakeDrive> | undefined
  let before: { id: string | null; name: string }
  let spaceId: string

  // What it shows when done, and the reload after it, last 50ms rather than seconds
  const real = { doneMs: DriveSyncPanel.doneMs, reloadMs: DriveSyncPanel.reloadMs }

  beforeEach(async () => {
    DriveSyncPanel.doneMs = 50
    DriveSyncPanel.reloadMs = 50
    localStorage.removeItem('last-sync-time')
    before = getCurrentSpace()
    const space = await createSpace(`Panel ${crypto.randomUUID().slice(0, 8)}`)
    spaceId = space.id
    await setCurrentSpace(space.id, space.name)
  })

  afterEach(async () => {
    Object.assign(DriveSyncPanel, real)
    drive?.uninstall()
    drive = undefined
    localStorage.removeItem('last-sync-time')
    localStorage.removeItem(`last-sync-time:${spaceId}`)
    await setSpaceReadOnly(spaceId, false)
    await deleteSpace(spaceId)
    if (before.id) await setCurrentSpace(before.id, before.name)
  })

  async function show(connected = true, id = spaceId) {
    if (connected) drive = installFakeDrive()
    const space = must(await getSpaceById(id))
    const el = await fixture<DriveSyncPanel>(
      html`<drive-sync-panel .space=${space}></drive-sync-panel>`
    )
    await wait(80)
    await el.updateComplete
    return el
  }
  const text = (el: DriveSyncPanel) => el.shadowRoot?.textContent?.replace(/\s+/g, ' ') ?? ''
  const button = (el: DriveSyncPanel, label: RegExp) =>
    [...(el.shadowRoot?.querySelectorAll('button') ?? [])].find(b =>
      label.test(b.textContent ?? '')
    )

  it('says to connect to Google Drive when there is no connection, or while disabled', async () => {
    const el = await show(false)
    expect(text(el)).to.contain('Drive Sync Unavailable')
    drive = installFakeDrive()
    el.disabled = true
    await el.updateComplete
    expect(text(el)).to.contain('Drive Sync Unavailable')
  })

  it('is ready to sync when it is connected, and checks again when it stops being disabled', async () => {
    const el = await show()
    expect(text(el)).to.contain('Ready')
    expect(text(el)).to.not.contain('Last synced')
    el.disabled = true
    await el.updateComplete
    el.disabled = false
    await waitUntil(() => text(el).includes('Ready'), 'it is ready again')
  })

  it('says when it last synced', async () => {
    localStorage.setItem('last-sync-time', new Date().toISOString())
    const el = await show()
    expect(text(el)).to.contain('Last synced: Just now')
  })

  it('tells how long ago, in the unit that fits', async () => {
    const el = await show()
    const ago = (ms: number) => el._formatSyncTime(new Date(Date.now() - ms).toISOString())
    expect(ago(30_000)).to.equal('Just now')
    expect(ago(60_000)).to.equal('1 minute ago')
    expect(ago(5 * 60_000)).to.equal('5 minutes ago')
    expect(ago(3_600_000)).to.equal('1 hour ago')
    expect(ago(3 * 3_600_000)).to.equal('3 hours ago')
    expect(ago(86_400_000)).to.equal('1 day ago')
    expect(ago(3 * 86_400_000)).to.equal('3 days ago')
    expect(ago(30 * 86_400_000)).to.equal(
      new Date(Date.now() - 30 * 86_400_000).toLocaleDateString()
    )
  })

  describe('the progress it shows', () => {
    it('is a bar that fills as the sync goes, or half when it does not know how far', async () => {
      const el = await show()
      el.syncProgress = { stage: 'pulling', message: 'Pulling', current: 1, total: 4 }
      await el.updateComplete
      expect(el.shadowRoot?.querySelector<HTMLElement>('.progress-fill')?.style.width).to.equal(
        '25%'
      )
      el.syncProgress = { stage: 'pulling', message: 'Pulling', current: 9, total: 4 }
      await el.updateComplete
      expect(el.shadowRoot?.querySelector<HTMLElement>('.progress-fill')?.style.width).to.equal(
        '100%'
      )
      el.syncProgress = { stage: 'pulling', message: 'Pulling' }
      await el.updateComplete
      expect(el.shadowRoot?.querySelector<HTMLElement>('.progress-fill')?.style.width).to.equal(
        '50%'
      )
      el.syncProgress = { stage: 'pulling', message: 'Pulling', current: 0, total: 0 }
      await el.updateComplete
      expect(el.shadowRoot?.querySelector<HTMLElement>('.progress-fill')?.style.width).to.equal(
        '50%'
      )
    })

    it('is marked done or failed, with no bar', async () => {
      const el = await show()
      el.syncProgress = { stage: 'complete', message: 'Done' }
      await el.updateComplete
      expect(el.shadowRoot?.querySelector('.sync-status.success')).to.not.equal(null)
      expect(el.shadowRoot?.querySelector('.progress-bar')).to.equal(null)
      el.syncProgress = { stage: 'error', message: 'Broke' }
      await el.updateComplete
      expect(el.shadowRoot?.querySelector('.sync-status.error')).to.not.equal(null)
    })

    it('shows an error with its message', async () => {
      const el = await show()
      el.syncError = 'It broke'
      await el.updateComplete
      expect(text(el)).to.contain('Failed')
      expect(text(el)).to.contain('It broke')
    })
  })

  describe('doing nothing', () => {
    it('does nothing while it is working, or cannot', async () => {
      const el = await show()
      el.syncing = true
      await el._handleReset()
      expect(el.syncProgress).to.equal(null)
      el.syncing = false
      el.syncAvailable = false
      await el._handleReset()
      expect(el.syncProgress).to.equal(null)
    })
  })

  describe('a space that is not the one in use', () => {
    let otherId: string
    let otherName: string

    beforeEach(async () => {
      otherName = `Other ${crypto.randomUUID().slice(0, 8)}`
      otherId = (await createSpace(otherName)).id
      const db = new ChordlessDB(otherId)
      await db.init()
      await db.saveSetlist(makeSetlist({ id: 'other-list', date: '2026-12-20' }))
      db.db?.close()
    })

    afterEach(async () => {
      localStorage.removeItem(`last-sync-time:${otherId}`)
      await deleteSpace(otherId)
    })

    it('resets that space without starting the app afresh, as nothing is showing it', async function () {
      this.timeout(8000)
      const el = await show(true, otherId)
      // (a reset refuses while the space has changes Drive does not: sync them first)
      await (await createSyncOrchestrator(otherName, otherId)).sync()
      let reloads = 0
      el.reload = () => {
        reloads++
      }
      must(el._resetModal.value as AppModal).ask = async () => true
      button(el, /Reset from Google Drive/)?.click()
      await waitUntil(() => text(el).includes('Reset complete'), 'it says it is done', {
        timeout: 4000,
      })
      await waitUntil(() => !el.syncing, 'it is done', { timeout: 4000 })
      await wait(DriveSyncPanel.reloadMs * 2)
      expect(reloads).to.equal(0)
    })
  })

  describe('resetting from Drive', () => {
    it('asks first, and does nothing when told not to', async () => {
      const el = await show()
      must(el._resetModal.value as AppModal).ask = async () => false
      button(el, /Reset from Google Drive/)?.click()
      await wait(100)
      expect(el.syncProgress).to.equal(null)
    })

    it('replaces the local data, and reloads', async function () {
      this.timeout(8000)
      const el = await show()
      let reloads = 0
      el.reload = () => {
        reloads++
      }
      must(el._resetModal.value as AppModal).ask = async () => true
      button(el, /Reset from Google Drive/)?.click()
      await waitUntil(() => text(el).includes('Reset complete'), 'it says it is done', {
        timeout: 4000,
      })
      expect(localStorage.getItem(`last-sync-time:${spaceId}`)).to.be.a('string')
      await waitUntil(() => reloads === 1, 'it reloads', { timeout: 3000 })
    })

    it('says what went wrong', async () => {
      const el = await show()
      must(el._resetModal.value as AppModal).ask = async () => true
      must(drive).failRequests({ status: 500, times: 100 })
      button(el, /Reset from Google Drive/)?.click()
      await waitUntil(() => text(el).includes('Failed'), 'it says so', { timeout: 4000 })
      expect(el.syncing).to.equal(false)
    })
  })

  describe('when the space’s Drive folder is gone', () => {
    /** The space has synced once; then its folder disappears (another Google app cannot see it) */
    async function afterFolderGone() {
      drive = installFakeDrive()
      const { name, id } = getCurrentSpace()
      await (await createSyncOrchestrator(name, id)).sync()
      drive.files.delete(drive.findByPath([ROOT_FOLDER_NAME, name]).id)
    }

    it('says so as soon as it is shown, with the way on', async () => {
      await afterFolderGone()
      const el = await show()
      expect(text(el)).to.contain('Drive folder not found')
      expect(text(el)).to.contain('safe on this device')
      expect(button(el, /Start over in Drive/)).to.not.equal(undefined)
    })

    it('asks first, and does nothing when told not to', async () => {
      await afterFolderGone()
      const el = await show()
      must(el._startOverModal.value as AppModal).ask = async () => false
      button(el, /Start over in Drive/)?.click()
      await wait(100)
      expect(el.syncProgress).to.equal(null)
      expect(text(el)).to.contain('Drive folder not found')
    })

    it('starts over in a new folder, and is ready to sync again', async function () {
      this.timeout(8000)
      await afterFolderGone()
      const el = await show()
      must(el._startOverModal.value as AppModal).ask = async () => true
      button(el, /Start over in Drive/)?.click()
      await waitUntil(() => text(el).includes('Started over in Drive'), 'it says it is done', {
        timeout: 4000,
      })
      expect(text(el)).to.not.contain('Drive folder not found')
      expect(must(drive).findByPath([ROOT_FOLDER_NAME, getCurrentSpace().name])).to.not.equal(
        undefined
      )
      await waitUntil(() => !el.syncing, 'it is done', { timeout: 4000 })
      expect(text(el)).to.contain('Ready')
    })

    it('says what went wrong when starting over fails', async function () {
      this.timeout(8000)
      await afterFolderGone()
      const el = await show()
      must(el._startOverModal.value as AppModal).ask = async () => true
      must(drive).failRequests({ status: 500, times: 100 })
      button(el, /Start over in Drive/)?.click()
      await waitUntil(() => text(el).includes('Failed'), 'it says so', { timeout: 4000 })
      expect(el.syncing).to.equal(false)
    })

    it('offers to replace this device’s copy with the folder of its name that can be seen', async function () {
      this.timeout(8000)
      // (another device made the folder by name; this device's link is to one this app cannot see)
      drive = installFakeDrive()
      const { name, id } = getCurrentSpace()
      await (await createSyncOrchestrator(name, id)).sync()
      await updateSpace(must(id), { rootRef: 'a-folder-this-app-cannot-see' })
      const db = new ChordlessDB(must(id))
      await db.init()
      await db.saveSetlist(makeSetlist({ id: 'only-here', name: 'Only on this device' }))
      const el = await show(false) // (keeping the Drive that has the folder)
      expect(text(el)).to.contain('Drive folder not found')

      must(el._replaceModal.value as AppModal).ask = async () => true
      let reloads = 0
      el.reload = () => {
        reloads++
      }
      button(el, /Replace with the copy in Drive/)?.click()
      await waitUntil(() => reloads === 1, 'it reloads', { timeout: 4000 })

      expect(await db.getSetlist('only-here')).to.equal(undefined)
      expect(text(el)).to.not.contain('Drive folder not found')
    })

    it('asks first, and changes nothing when told not to', async () => {
      await afterFolderGone()
      const el = await show()
      must(el._replaceModal.value as AppModal).ask = async () => false
      button(el, /Replace with the copy in Drive/)?.click()
      await wait(100)
      expect(el.syncProgress).to.equal(null)
      expect(text(el)).to.contain('Drive folder not found')
    })

    it('says so, and changes nothing, when there is no folder of its name to take it from', async function () {
      this.timeout(8000)
      await afterFolderGone()
      const el = await show()
      must(el._replaceModal.value as AppModal).ask = async () => true
      button(el, /Replace with the copy in Drive/)?.click()
      await waitUntil(() => text(el).includes('nothing was changed'), 'it says so', {
        timeout: 4000,
      })
      expect(el.syncing).to.equal(false)
    })

    it('does nothing while it is syncing, when replacing', async () => {
      await afterFolderGone()
      const el = await show()
      el.syncing = true
      await el._handleReplaceFromFolder()
      expect(el.syncProgress).to.equal(null)
    })

    it('does nothing while it is syncing', async () => {
      await afterFolderGone()
      const el = await show()
      el.syncing = true
      await el._handleStartOver()
      expect(el.syncProgress).to.equal(null)
    })
  })
})
