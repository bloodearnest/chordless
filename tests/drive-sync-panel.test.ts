import { expect, fixture, html, waitUntil } from '@open-wc/testing'
import type { AppModal } from '../src/components/app-modal.ts'
import type { DriveSyncPanel } from '../src/components/drive-sync-panel.ts'
import {
  createOrganisation,
  deleteOrganisation,
  getCurrentOrganisation,
  setCurrentOrganisation,
  setOrganisationReadOnly,
} from '../src/js/organisation.ts'
import { createSyncOrchestrator } from '../src/js/sync-orchestrator.ts'
import { FakeAuthWorker, installFakeAuthWorker } from './fake-auth-worker.ts'
import { installFakeDrive } from './fake-drive.ts'
import { must } from './must.ts'
import { suppressConsoleLogs, wait } from './test-helpers.ts'
import '../src/components/drive-sync-panel.ts'

const { describe, it, beforeEach, afterEach } = window

suppressConsoleLogs()

describe('drive-sync-panel', () => {
  let drive: ReturnType<typeof installFakeDrive> | undefined
  let before: { id: string | null; name: string }
  let organisationId: string

  beforeEach(async () => {
    localStorage.removeItem('last-sync-time')
    before = getCurrentOrganisation()
    const organisation = await createOrganisation(`Panel ${crypto.randomUUID().slice(0, 8)}`)
    organisationId = organisation.id
    await setCurrentOrganisation(organisation.id, organisation.name)
  })

  afterEach(async () => {
    drive?.uninstall()
    drive = undefined
    localStorage.removeItem('last-sync-time')
    await setOrganisationReadOnly(organisationId, false)
    await deleteOrganisation(organisationId)
    if (before.id) await setCurrentOrganisation(before.id, before.name)
  })

  async function show(connected = true) {
    if (connected) drive = installFakeDrive()
    const el = await fixture<DriveSyncPanel>(html`<drive-sync-panel></drive-sync-panel>`)
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
    expect(text(el)).to.contain('Ready to sync')
    expect(text(el)).to.not.contain('Last synced')
    el.disabled = true
    await el.updateComplete
    el.disabled = false
    await waitUntil(() => text(el).includes('Ready to sync'), 'it is ready again')
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
      expect(text(el)).to.contain('Sync failed')
      expect(text(el)).to.contain('It broke')
    })
  })

  describe('syncing', () => {
    it('syncs, says so, and goes back to ready', async function () {
      this.timeout(8000)
      const el = await show()
      button(el, /Sync with Drive/)?.click()
      await waitUntil(() => text(el).includes('Sync complete!'), 'it says it is done')
      expect(localStorage.getItem('last-sync-time')).to.be.a('string')
      expect(text(el)).to.contain('Last synced')
      await waitUntil(() => !el.syncing, 'it is done', { timeout: 4000 })
      expect(text(el)).to.contain('Ready to sync')
    })

    it('says an organisation with view-only access uploads nothing', async function () {
      this.timeout(8000)
      const el = await show()
      // The Drive folder is made by the first sync: after that the user can only read it
      const { name, id } = getCurrentOrganisation()
      await (await createSyncOrchestrator(name, id)).sync()
      must(drive).readOnly = true
      button(el, /Sync with Drive/)?.click()
      await waitUntil(() => text(el).includes('view-only access'), 'it says so', { timeout: 4000 })
    })

    it('says what went wrong', async () => {
      const el = await show()
      must(drive).failRequests({ status: 500, times: 100 })
      button(el, /Sync with Drive/)?.click()
      await waitUntil(() => text(el).includes('Sync failed'), 'it says so', { timeout: 4000 })
      expect(el.syncing).to.equal(false)
      expect(el.syncError).to.be.a('string')
    })

    it('does nothing while it is syncing, or cannot', async () => {
      const el = await show()
      el.syncing = true
      await el._handleSync()
      await el._handleReset()
      expect(el.syncProgress).to.equal(null)
      el.syncing = false
      el.syncAvailable = false
      await el._handleSync()
      expect(el.syncProgress).to.equal(null)
    })

    it('names the organisation after the Google account before it syncs', async () => {
      const auth = installFakeAuthWorker(new FakeAuthWorker())
      try {
        const el = await show()
        button(el, /Sync with Drive/)?.click()
        await waitUntil(() => text(el).includes('Sync complete!'), 'it says it is done', {
          timeout: 4000,
        })
      } finally {
        auth.uninstall()
      }
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
      expect(localStorage.getItem('last-sync-time')).to.be.a('string')
      await waitUntil(() => reloads === 1, 'it reloads', { timeout: 3000 })
    })

    it('says what went wrong', async () => {
      const el = await show()
      must(el._resetModal.value as AppModal).ask = async () => true
      must(drive).failRequests({ status: 500, times: 100 })
      button(el, /Reset from Google Drive/)?.click()
      await waitUntil(() => text(el).includes('Sync failed'), 'it says so', { timeout: 4000 })
      expect(el.syncing).to.equal(false)
    })
  })
})
