/**
 * One space's card on Account and Teams: what it says of the space, and its Sync and Switch. Drive
 * is a fake Drive, and the spaces are real ones in the spaces database.
 */
import { expect, fixture, html } from '@open-wc/testing'
import type { AppModal } from '../src/components/app-modal.ts'
import {
  type SpaceCard,
  SpaceManageEvent,
  SpaceSwitchEvent,
  SpaceSyncedEvent,
} from '../src/components/space-card.ts'
import '../src/components/space-card.ts'
import type { Space } from '../src/js/data-types.ts'
import { ChordlessDB } from '../src/js/db.ts'
import type { SignInState } from '../src/js/google-auth.ts'
import { forgetSync, recordSync } from '../src/js/last-sync.ts'
import { addChart } from '../src/js/song-utils.ts'
import { createSpace, deleteSpace, updateSpace } from '../src/js/space.ts'
import { makeSetlist } from './builders.ts'
import { installFakeAuthWorker } from './fake-auth-worker.ts'
import { installFakeDrive } from './fake-drive.ts'
import { must } from './must.ts'
import { suppressConsoleLogs, wait } from './test-helpers.ts'

const { describe, it, beforeEach, afterEach } = window

suppressConsoleLogs()

describe('space-card', () => {
  let drive: ReturnType<typeof installFakeDrive>
  let uninstallWorker: () => void
  let space: Space
  const made: string[] = []

  beforeEach(async () => {
    drive = installFakeDrive()
    ;({ uninstall: uninstallWorker } = installFakeAuthWorker())
    space = await make(`Card ${crypto.randomUUID().slice(0, 8)}`)
  })

  afterEach(async () => {
    drive.uninstall()
    uninstallWorker()
    for (const id of made.splice(0)) {
      forgetSync(id)
      await deleteSpace(id).catch(() => {})
    }
  })

  /** A space with a song and a setlist in it */
  async function make(name: string, updates: Partial<Space> = {}): Promise<Space> {
    const created = await createSpace(name)
    made.push(created.id)
    const db = new ChordlessDB(created.id)
    await db.init()
    await addChart(db, '{title: Alpha}\n{key: G}\n[G]Alpha line', {
      variantLabel: 'Original',
      importSource: 'test',
      makeDefault: 'first',
    })
    await db.saveSetlist(makeSetlist({ id: `list-${crypto.randomUUID()}`, date: '2026-12-06' }))
    db.db?.close()
    return Object.keys(updates).length ? updateSpace(created.id, updates) : created
  }

  async function card(
    signIn: SignInState | null,
    options: { current?: boolean; space?: Space } = {}
  ) {
    const el = await fixture<SpaceCard>(
      html`<space-card .space=${options.space ?? space} .signIn=${signIn} ?current=${options.current}></space-card>`
    )
    for (let i = 0; i < 50 && !el._summary; i++) await wait(20)
    await el.updateComplete
    return el
  }
  const text = (el: SpaceCard) => (el.shadowRoot?.textContent ?? '').replace(/\s+/g, ' ')
  const button = (el: SpaceCard, id: string) =>
    el.shadowRoot?.querySelector<HTMLButtonElement>(`#${id}`)

  const labels = (el: SpaceCard) =>
    Array.from(el.shadowRoot?.querySelectorAll('.chip') ?? []).map(chip => chip.textContent?.trim())

  it('names the space, labels it Personal, and says how much is in it', async () => {
    const el = await card('signed-out')
    expect(el.shadowRoot?.querySelector('.title')?.textContent).to.equal(space.name)
    expect(labels(el)).to.deep.equal(['Personal'])
    expect(text(el)).to.not.contain('~')
    expect(text(el)).to.match(/1 song · 1 setlist · about \d+ B/)
  })

  it('labels nothing for a personal space that is still called Personal', async () => {
    const plain = await make('Personal')
    const el = await card('signed-out', { space: plain })
    expect(labels(el)).to.deep.equal([])
  })

  it('asks the page to show it when told to manage it', async () => {
    const el = await card('signed-out')
    const asked: string[] = []
    el.addEventListener(SpaceManageEvent.type, event =>
      asked.push((event as SpaceManageEvent).spaceId)
    )
    must(button(el, 'manage')).click()
    expect(asked).to.deep.equal([space.id])
  })

  it('puts Switch first of the buttons, then Sync, then Manage', async () => {
    const el = await card('signed-in')
    const order = Array.from(el.shadowRoot?.querySelectorAll('.actions button') ?? []).map(
      each => each.id
    )
    expect(order).to.deep.equal(['switch', 'sync', 'manage'])
  })

  it('says a Team is a Team, and what the person is in it', async () => {
    const team = await make(`Team ${crypto.randomUUID().slice(0, 8)}`, {
      team: { id: 't-1', role: 'writer' },
    })
    const el = await card('signed-in', { space: team })
    expect(el.shadowRoot?.querySelector('.title')?.textContent).to.equal(team.name)
    expect(labels(el)).to.deep.equal(['Team', 'worship leader'])
  })

  it('marks the space in use, which has no Switch, and gives the others one', async () => {
    const current = await card('signed-out', { current: true })
    expect(text(current)).to.contain('Current')
    expect(button(current, 'switch')).to.equal(null)
    const other = await card('signed-out')
    expect(text(other)).to.not.contain('Current')
    expect(button(other, 'switch')).to.not.equal(null)
  })

  it('says one song and one setlist in the singular, and a changed space is counted again', async () => {
    const el = await card('signed-out')
    expect(text(el)).to.contain('1 song ·')
    const other = await make(`Other ${crypto.randomUUID().slice(0, 8)}`)
    el.space = other
    await wait(100)
    await el.updateComplete
    expect(el._summary).to.not.equal(null)
  })

  describe('the line about syncing', () => {
    it('says what stands in the way', async () => {
      expect(text(await card('signed-out'))).to.contain('Sign in to sync')
      expect(text(await card('expired'))).to.contain('Sign-in expired: reconnect to sync')
      expect(text(await card('no-drive'))).to.contain('Connect Google Drive to sync')
      expect(text(await card(null))).to.not.contain('sync')
    })

    it('offers no Sync until it can', async () => {
      for (const state of ['signed-out', 'expired', 'no-drive', null] as const) {
        expect(button(await card(state), 'sync')).to.equal(null)
      }
      expect(button(await card('signed-in'), 'sync')).to.not.equal(null)
    })

    it('lets a Team’s member sync with no Drive: the Team’s files come through Chordless', async () => {
      const team = await make(`Team ${crypto.randomUUID().slice(0, 8)}`, {
        team: { id: 't-2', role: 'reader' },
      })
      const el = await card('no-drive', { space: team })
      expect(button(el, 'sync')).to.not.equal(null)
      expect(text(el)).to.contain('Not synced yet')
    })

    it('says when it last synced, or that it has not', async () => {
      expect(text(await card('signed-in'))).to.contain('Not synced yet')
      recordSync(space.id)
      expect(text(await card('signed-in'))).to.contain('Synced Just now')
    })
  })

  describe('syncing', () => {
    it('syncs that space, says when, and tells the page', async () => {
      const el = await card('signed-in')
      let told = 0
      el.addEventListener(SpaceSyncedEvent.type, () => told++)
      must(button(el, 'sync')).click()
      for (let i = 0; i < 150 && !text(el).includes('Synced Just now'); i++) await wait(20)
      expect(text(el)).to.contain('Synced Just now')
      expect(told).to.equal(1)
      const files = drive.listFiles(file => Boolean(file.appProperties.setlistId))
      expect(files).to.have.length(1)
    })

    it('says what went wrong, and can be tried again', async () => {
      const el = await card('signed-in')
      drive.failRequests({ status: 500, times: 100 })
      must(button(el, 'sync')).click()
      for (let i = 0; i < 150 && !text(el).includes('Sync failed'); i++) await wait(20)
      expect(text(el)).to.contain('Sync failed')
      expect(must(button(el, 'sync')).disabled).to.equal(false)
    })

    it('does not start a second sync while one is going', async () => {
      const el = await card('signed-in')
      el._syncing = true
      await el._sync()
      expect(el._progress).to.equal('')
    })

    it('shows how far a sync has got', async () => {
      const el = await card('signed-in')
      must(button(el, 'sync')).click()
      await el.updateComplete
      expect(text(el)).to.match(
        /Starting…|Syncing|Scanning|Checking|Downloading|Uploading|Initializing/
      )
      for (let i = 0; i < 150 && el._syncing; i++) await wait(20)
    })
  })

  describe('switching', () => {
    async function answer(el: SpaceCard, confirm: boolean) {
      const modal = must(el.shadowRoot?.querySelector<AppModal>('app-modal'))
      for (let i = 0; i < 50 && !modal.open; i++) await wait(20)
      await modal.updateComplete
      must(
        modal.shadowRoot?.querySelector<HTMLElement>(
          confirm ? '.modal-btn-confirm' : '.modal-btn-cancel'
        )
      ).click()
      return modal
    }

    it('asks first, naming the space, and tells the page to switch when told yes', async () => {
      const el = await card('signed-out')
      const switched: string[] = []
      el.addEventListener(SpaceSwitchEvent.type, event =>
        switched.push((event as SpaceSwitchEvent).spaceId)
      )
      must(button(el, 'switch')).click()
      const modal = await answer(el, true)
      expect(modal.message).to.contain(`Switch to "${space.name}"?`)
      await wait(50)
      expect(switched).to.deep.equal([space.id])
    })

    it('does nothing when told no', async () => {
      const el = await card('signed-out')
      let switched = 0
      el.addEventListener(SpaceSwitchEvent.type, () => switched++)
      must(button(el, 'switch')).click()
      await answer(el, false)
      await wait(50)
      expect(switched).to.equal(0)
    })
  })
})
