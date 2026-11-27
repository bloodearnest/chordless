/**
 * One space's card on Account and Teams: what it says of the space, and its Sync. Drive
 * is a fake Drive, and the spaces are real ones in the spaces database.
 */
import { expect, fixture, html, waitUntil } from '@open-wc/testing'
import type { AppModal } from '../src/components/app-modal.ts'
import {
  type SpaceCard,
  SpaceConnectDriveEvent,
  SpaceDataEvent,
  SpaceDefaultEvent,
  SpaceDisconnectDriveEvent,
  SpaceManageEvent,
  SpaceSyncedEvent,
} from '../src/components/space-card.ts'
import '../src/components/space-card.ts'
import type { Space } from '../src/js/data-types.ts'
import { ChordlessDB } from '../src/js/db.ts'
import type { SignInState } from '../src/js/google-auth.ts'
import { forgetSync, recordSync } from '../src/js/last-sync.ts'
import { addChart } from '../src/js/song-utils.ts'
import { createSpace, deleteSpace, updateSpace } from '../src/js/space.ts'
import { ServerHasDataError } from '../src/js/space-move.ts'
import { syncSpaceNow } from '../src/js/space-sync.ts'
import { UserError } from '../src/js/utils/errors.ts'
import { makeSetlist } from './builders.ts'
import { installFakeAuthWorker } from './fake-auth-worker.ts'
import { installFakeDrive } from './fake-drive.ts'
import { must } from './must.ts'
import { suppressConsoleLogs } from './test-helpers.ts'

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
    await waitUntil(() => el._summary)
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

  it('offers Connect Google Drive on a Personal space with none, and Reconnect when it has expired', async () => {
    const own = await card('no-drive')
    expect(text(own)).to.contain('Google Drive is not connected')
    let asked = 0
    own.addEventListener(SpaceConnectDriveEvent.type, () => asked++)
    must(button(own, 'connect-drive')).click()
    expect(asked).to.equal(1)
    expect(button(own, 'sync')).to.equal(null)

    const expired = await card('expired')
    expect(text(expired)).to.contain('Google Drive needs reconnecting')
    expired.addEventListener(SpaceConnectDriveEvent.type, () => asked++)
    must(button(expired, 'reconnect-drive')).click()
    expect(asked).to.equal(2)
    expect(button(expired, 'connect-drive')).to.equal(null)
  })

  it('shows which Google Drive a Personal space syncs through, with a way to disconnect it', async () => {
    const own = await card('signed-in')
    expect(button(own, 'disconnect-drive')).to.not.equal(null)
    expect(own.shadowRoot?.querySelector('#drive-line')).to.equal(null)
    own.driveEmail = 'ann@gmail.example'
    await own.updateComplete
    expect(text(own)).to.contain('Google Drive: ann@gmail.example')
    let asked = 0
    own.addEventListener(SpaceDisconnectDriveEvent.type, () => asked++)
    must(button(own, 'disconnect-drive')).click()
    expect(asked).to.equal(1)
  })

  it('says a Team’s expired sign-in as it always did, not as a Drive that needs reconnecting', async () => {
    const team = await make(`Team ${crypto.randomUUID().slice(0, 8)}`, {
      team: { id: 't-8', role: 'writer' },
    })
    const el = await card('expired', { space: team })
    expect(text(el)).to.contain('Sign-in expired: reconnect to sync')
    expect(button(el, 'reconnect-drive')).to.equal(null)
  })

  it('says nothing of Google Drive on a Team, which syncs through the Worker', async () => {
    const team = await make(`Team ${crypto.randomUUID().slice(0, 8)}`, {
      team: { id: 't-7', role: 'writer' },
    })
    for (const state of ['no-drive', 'signed-in'] as const) {
      const theirs = await card(state, { space: team })
      theirs.driveEmail = 'ann@gmail.example'
      await theirs.updateComplete
      expect(button(theirs, 'connect-drive')).to.equal(null)
      expect(button(theirs, 'disconnect-drive')).to.equal(null)
      expect(text(theirs)).to.not.contain('Google Drive')
    }
  })

  it('shows the CCLI licence number when the space has one, and nothing when it has none', async () => {
    expect(text(await card('signed-out'))).to.not.contain('CCLI licence')
    const licensed = await make(`Licensed ${crypto.randomUUID().slice(0, 6)}`, {
      ccliLicence: '471102',
    })
    expect(text(await card('signed-out', { space: licensed }))).to.contain('CCLI licence 471102')
  })

  it('puts the labels after the name on the left', async () => {
    const team = await make(`Team ${crypto.randomUUID().slice(0, 8)}`, {
      team: { id: 't-9', role: 'writer' },
    })
    const el = await card('signed-in', { space: team })
    const box = (selector: string) =>
      must(el.shadowRoot?.querySelector(selector)).getBoundingClientRect()
    const chips = Array.from(el.shadowRoot?.querySelectorAll('.chip') ?? []).map(chip =>
      chip.getBoundingClientRect()
    )
    const title = box('.title')
    expect(chips).to.have.length(2)
    expect(chips[0].left).to.be.greaterThan(title.right - 1)
    expect(chips[1].left).to.be.greaterThan(chips[0].right - 1)
  })

  it('labels nothing for a personal space that is still called Personal', async () => {
    const plain = await make('Personal')
    const el = await card('signed-out', { space: plain })
    expect(labels(el)).to.deep.equal([])
  })

  it('says which space is the default, and offers the others to be made so, when there is a choice', async () => {
    const handle = async (props: { isDefault?: boolean; several?: boolean }) => {
      const el = await fixture<SpaceCard>(
        html`<space-card .space=${space} .signIn=${'signed-out'} ?isDefault=${props.isDefault} ?several=${props.several}></space-card>`
      )
      await waitUntil(() => el._summary)
      await el.updateComplete
      return el
    }
    // (with one space there is nothing to choose)
    const alone = await handle({ isDefault: true })
    expect(labels(alone)).to.deep.equal(['Personal'])
    expect(button(alone, 'make-default')).to.equal(null)

    const chosen = await handle({ isDefault: true, several: true })
    expect(labels(chosen)).to.deep.equal(['Personal', 'Default'])
    expect(button(chosen, 'make-default')).to.equal(null)

    const other = await handle({ several: true })
    expect(labels(other)).to.deep.equal(['Personal'])
    let asked = ''
    other.addEventListener(SpaceDefaultEvent.type, event => {
      asked = (event as SpaceDefaultEvent).spaceId
    })
    must(button(other, 'make-default')).click()
    expect(asked).to.equal(space.id)
  })

  it('has Manage Users, which asks the page to go to the space’s own page, and Manage Data, which asks for its data', async () => {
    const el = await card('signed-out')
    const asked: string[] = []
    el.addEventListener(SpaceManageEvent.type, event =>
      asked.push((event as SpaceManageEvent).spaceId)
    )
    const data: string[] = []
    el.addEventListener(SpaceDataEvent.type, event => data.push((event as SpaceDataEvent).spaceId))
    expect(must(button(el, 'manage')).textContent?.trim()).to.equal('Manage Users')
    expect(must(button(el, 'manage-data')).textContent?.trim()).to.equal('Manage Data')
    must(button(el, 'manage')).click()
    must(button(el, 'manage-data')).click()
    expect(asked).to.deep.equal([space.id])
    expect(data).to.deep.equal([space.id])
    // (its data, leaders and people are all there: no button of their own here)
    expect(button(el, 'leaders')).to.equal(null)
    expect(button(el, 'users')).to.equal(null)
  })

  const order = (el: SpaceCard) =>
    Array.from(el.shadowRoot?.querySelectorAll('.actions button') ?? []).map(each => each.id)

  it('has no Switch button: the space tabs switch', async () => {
    const el = await card('signed-in')
    expect(order(el)).to.deep.equal([
      'sync',
      'move-to-server',
      'manage',
      'manage-data',
      'disconnect-drive',
    ])
  })

  it('says a Team is a Team, and what the person is in it', async () => {
    const team = await make(`Team ${crypto.randomUUID().slice(0, 8)}`, {
      team: { id: 't-1', role: 'writer' },
    })
    const el = await card('signed-in', { space: team })
    expect(el.shadowRoot?.querySelector('.title')?.textContent).to.equal(team.name)
    expect(labels(el)).to.deep.equal(['Team', 'Worship leader'])
  })

  it('says one song and one setlist in the singular, and a changed space is counted again', async () => {
    const el = await card('signed-out')
    expect(text(el)).to.contain('1 song ·')
    const other = await make(`Other ${crypto.randomUUID().slice(0, 8)}`)
    el.space = other
    await waitUntil(() => el._summary, 'the other space to be counted')
    await el.updateComplete
    expect(el._summary).to.not.equal(null)
  })

  describe('the line about syncing', () => {
    it('says what stands in the way', async () => {
      expect(text(await card('signed-out'))).to.contain('Sign in to sync')
      expect(text(await card('expired'))).to.contain('Google Drive needs reconnecting to sync')
      expect(text(await card('no-drive'))).to.contain('Google Drive is not connected')
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
      await waitUntil(() => text(el).includes('Synced Just now'), undefined, { timeout: 3000 })
      expect(text(el)).to.contain('Synced Just now')
      expect(told).to.equal(1)
      const files = drive.listFiles(file => Boolean(file.appProperties.setlistId))
      expect(files).to.have.length(1)
    })

    it('says what went wrong, and can be tried again', async () => {
      const el = await card('signed-in')
      drive.failRequests({ status: 500, times: 100 })
      must(button(el, 'sync')).click()
      await waitUntil(() => text(el).includes('Sync failed'), undefined, { timeout: 3000 })
      expect(text(el)).to.contain('Sync failed')
      expect(must(button(el, 'sync')).disabled).to.equal(false)
    })

    describe('a Personal space, when Drive has one other space’s folder', () => {
      let old: Space
      let personal: Space
      beforeEach(async () => {
        old = await make(`Old ${crypto.randomUUID().slice(0, 8)}`)
        await syncSpaceNow(old, null)
        personal = { ...space, name: 'Personal' }
        localStorage.removeItem(`chordless:adopt-declined:${space.id}`)
        localStorage.removeItem(`chordless:adopted-folder:${space.id}`)
      })

      async function answer(el: SpaceCard, confirm: boolean) {
        const modal = must(el.shadowRoot?.querySelector<AppModal>('app-modal'))
        await waitUntil(() => modal.open, 'the question', { timeout: 3000 })
        expect(modal.message).to.contain(old.name)
        await modal.updateComplete
        must(
          modal.shadowRoot?.querySelector<HTMLElement>(
            confirm ? '.modal-btn-confirm' : '.modal-btn-cancel'
          )
        ).click()
      }

      it('asks whether to use that folder, and syncs into it when told yes, renaming nothing', async () => {
        const el = await card('signed-in', { space: personal })
        must(button(el, 'sync')).click()
        await answer(el, true)
        await waitUntil(() => text(el).includes('Synced Just now'), undefined, { timeout: 3000 })
        const folders = [...drive.files.values()].filter(
          file => file.appProperties?.resourceType === 'space'
        )
        expect(folders.map(folder => folder.name)).to.deep.equal([old.name])
      })

      it('makes a folder called Personal when told no', async () => {
        const el = await card('signed-in', { space: personal })
        must(button(el, 'sync')).click()
        await answer(el, false)
        await waitUntil(() => text(el).includes('Synced Just now'), undefined, { timeout: 3000 })
        const folders = [...drive.files.values()].filter(
          file => file.appProperties?.resourceType === 'space'
        )
        expect(folders.map(folder => folder.name).sort()).to.deep.equal(
          [old.name, 'Personal'].sort()
        )
      })
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
      await waitUntil(() => !el._syncing, undefined, { timeout: 3000 })
    })
  })

  describe('moving to Chordless', () => {
    const server = { libraryId: 'library', movedAt: '2026-11-25T10:00:00.000Z' }

    /** Answer the card's question to confirm (the second modal: the first is the Drive folder's) */
    async function confirmWith(el: SpaceCard, answer: boolean) {
      const modal = must(el.shadowRoot?.querySelectorAll<AppModal>('app-modal')[1])
      await waitUntil(() => modal.open, 'the question', { timeout: 3000 })
      await modal.updateComplete
      must(
        modal.shadowRoot?.querySelector<HTMLElement>(
          answer ? '.modal-btn-confirm' : '.modal-btn-cancel'
        )
      ).click()
      return modal
    }

    it('is offered on a Personal space still on Drive, to someone signed in, and on nothing else', async () => {
      for (const state of ['signed-in', 'no-drive'] as const)
        expect(button(await card(state), 'move-to-server')).to.not.equal(null)
      for (const state of ['signed-out', 'expired', null] as const)
        expect(button(await card(state), 'move-to-server')).to.equal(null)
      const team = await make(`Team ${crypto.randomUUID().slice(0, 8)}`, {
        team: { id: 'team-1', role: 'owner' },
      })
      expect(button(await card('signed-in', { space: team }), 'move-to-server')).to.equal(null)
      const moved = await make(`Moved ${crypto.randomUUID().slice(0, 8)}`, { server })
      expect(button(await card('signed-in', { space: moved }), 'move-to-server')).to.equal(null)
    })

    it('asks first, says it cannot be undone, and moves nothing if told no', async () => {
      const el = await card('signed-in')
      const moves: string[] = []
      el.moveSpace = async id => {
        moves.push(id)
      }
      must(button(el, 'move-to-server')).click()
      const modal = await confirmWith(el, false)
      expect(modal.heading).to.contain(space.name)
      expect(modal.message).to.contain('cannot be undone')
      expect(modal.message).to.contain('Pad audio is not moved')
      await el.updateComplete
      expect(moves).to.deep.equal([])
      expect(text(el)).not.to.contain('Moving to Chordless')
    })

    it('does nothing while another sync, move or deletion is going', async () => {
      const el = await card('signed-in', {
        space: await make(`Busy ${crypto.randomUUID().slice(0, 8)}`, { server, rootRef: 'folder' }),
      })
      const calls: string[] = []
      el.moveSpace = async () => {
        calls.push('move')
      }
      el.trashDriveFiles = async () => {
        calls.push('trash')
      }
      el._syncing = true
      await el._move()
      await el._deleteDriveFiles()
      expect(calls).to.deep.equal([])
    })

    it('moves the space when told yes, says when, and tells the page', async () => {
      const el = await card('signed-in')
      const moves: string[] = []
      let release: () => void = () => {}
      const held = new Promise<void>(resolve => {
        release = resolve
      })
      el.moveSpace = async id => {
        moves.push(id)
        await held
      }
      let told = 0
      el.addEventListener(SpaceSyncedEvent.type, () => told++)
      must(button(el, 'move-to-server')).click()
      await confirmWith(el, true)
      await waitUntil(() => moves.length === 1, 'the move', { timeout: 3000 })
      await el.updateComplete
      expect(text(el)).to.contain('Moving to Chordless')
      expect(button(el, 'move-to-server')?.disabled).to.equal(true)
      release()
      await waitUntil(() => !el._syncing, undefined, { timeout: 3000 })
      expect(moves).to.deep.equal([space.id])
      expect(text(el)).to.contain('Synced Just now')
      expect(told).to.equal(1)
    })

    it('says how many songs have been sent as they go, and to stay on the page', async () => {
      const el = await card('signed-in')
      let finish: () => void = () => {}
      let tell: (sent: number, total: number) => void = () => {}
      el.moveSpace = (_id, _combine, progress) => {
        tell = progress ?? (() => {})
        return new Promise<void>(resolve => {
          finish = resolve
        })
      }
      must(button(el, 'move-to-server')).click()
      await confirmWith(el, true)
      await waitUntil(() => el._syncing, 'the move', { timeout: 3000 })
      await el.updateComplete
      expect(text(el)).to.contain('stay on this page')
      tell(3, 97)
      await el.updateComplete
      expect(text(el)).to.contain('3 of 97 songs sent')
      tell(0, 0)
      await el.updateComplete
      expect(text(el)).to.not.contain('songs sent')
      finish()
      await waitUntil(() => !el._syncing, undefined, { timeout: 3000 })
    })

    it('asks whether to combine when the account already has data, and moves with it if so', async function () {
      this.timeout(8000)
      const el = await card('signed-in')
      const calls: Array<boolean | undefined> = []
      el.moveSpace = async (_id, combine) => {
        calls.push(combine)
        if (!combine) throw new ServerHasDataError()
      }
      must(button(el, 'move-to-server')).click()
      await confirmWith(el, true)
      await waitUntil(
        () => el._confirmModal.value?.heading.includes('Combine'),
        'the second question',
        { timeout: 3000 }
      )
      expect(el._confirmModal.value?.heading).to.contain('Combine')
      await confirmWith(el, true)
      await waitUntil(() => calls.length === 2 && !el._syncing, 'the combined move', {
        timeout: 3000,
      })
      expect(calls).to.deep.equal([false, true])
      expect(el._error).to.equal('')
    })

    it('moves nothing when the question to combine is declined', async function () {
      this.timeout(8000)
      const el = await card('signed-in')
      const calls: Array<boolean | undefined> = []
      el.moveSpace = async (_id, combine) => {
        calls.push(combine)
        throw new ServerHasDataError()
      }
      must(button(el, 'move-to-server')).click()
      await confirmWith(el, true)
      await waitUntil(
        () => el._confirmModal.value?.heading.includes('Combine'),
        'the second question',
        { timeout: 3000 }
      )
      await confirmWith(el, false)
      await waitUntil(() => !el._syncing, undefined, { timeout: 3000 })
      expect(calls).to.deep.equal([false])
      expect(el._error).to.equal('')
      expect(button(el, 'move-to-server')?.disabled).to.equal(false)
    })

    it('says what went wrong, and can be tried again', async () => {
      const el = await card('signed-in')
      must(button(el, 'move-to-server')).click()
      el.moveSpace = async () => {
        throw new UserError('offline')
      }
      must(button(el, 'move-to-server')).click()
      await confirmWith(el, true)
      await waitUntil(() => text(el).includes('Could not move the space: offline'), undefined, {
        timeout: 3000,
      })
      // (an error not written for people is not shown: the plain sentence, with the error in the log)
      el.moveSpace = async () => {
        throw new Error('internal detail')
      }
      must(button(el, 'move-to-server')).click()
      await confirmWith(el, true)
      await waitUntil(() => text(el).includes('Could not move the space.'), undefined, {
        timeout: 3000,
      })
      expect(text(el)).not.to.contain('internal detail')
    })

    describe('a space that has moved', () => {
      let moved: Space
      beforeEach(async () => {
        moved = await make(`Moved ${crypto.randomUUID().slice(0, 8)}`, {
          server,
          rootRef: 'old-folder',
        })
      })

      it('says it is stored on Chordless, and offers nothing of Google Drive but its leftover files', async () => {
        const el = await card('signed-in', { space: moved })
        expect(text(el)).to.contain('Stored on Chordless')
        expect(text(el)).not.to.contain('Google Drive:')
        expect(button(el, 'disconnect-drive')).to.equal(null)
        expect(button(el, 'connect-drive')).to.equal(null)
        expect(button(el, 'reconnect-drive')).to.equal(null)
        expect(text(el)).to.contain('Its old files are still in Google Drive')
        expect(button(el, 'delete-drive-files')).to.not.equal(null)
      })

      it('syncs with a Chordless sign-in alone, and does not say Drive needs reconnecting', async () => {
        const el = await card('no-drive', { space: moved })
        expect(button(el, 'sync')).to.not.equal(null)
        expect(text(el)).not.to.contain('Google Drive is not connected')
        const expired = await card('expired', { space: moved })
        expect(text(expired)).not.to.contain('Google Drive needs reconnecting')
        expect(button(expired, 'sync')).to.equal(null)
      })

      it('offers to delete the Drive files only while there are some, to someone who can reach Drive', async () => {
        const none = await make(`Clean ${crypto.randomUUID().slice(0, 8)}`, { server })
        const clean = await card('signed-in', { space: none })
        expect(button(clean, 'delete-drive-files')).to.equal(null)
        expect(text(clean)).not.to.contain('old files')
        expect(button(await card('no-drive', { space: moved }), 'delete-drive-files')).to.equal(
          null
        )
        const notMoved = await make(`Drive ${crypto.randomUUID().slice(0, 8)}`, {
          rootRef: 'folder',
        })
        expect(button(await card('signed-in', { space: notMoved }), 'delete-drive-files')).to.equal(
          null
        )
      })

      it('asks first, and puts nothing in the Drive bin if told no', async () => {
        const el = await card('signed-in', { space: moved })
        const trashed: Space[] = []
        el.trashDriveFiles = async which => {
          trashed.push(which)
        }
        must(button(el, 'delete-drive-files')).click()
        const modal = await confirmWith(el, false)
        expect(modal.heading).to.contain(moved.name)
        expect(modal.message).to.contain('Drive bin')
        await el.updateComplete
        expect(trashed).to.deep.equal([])
      })

      it('puts the files in the Drive bin when told yes, and tells the page', async () => {
        const el = await card('signed-in', { space: moved })
        const trashed: Space[] = []
        el.trashDriveFiles = async which => {
          trashed.push(which)
        }
        let told = 0
        el.addEventListener(SpaceSyncedEvent.type, () => told++)
        must(button(el, 'delete-drive-files')).click()
        await confirmWith(el, true)
        await waitUntil(() => trashed.length === 1, 'the files', { timeout: 3000 })
        expect(trashed[0].id).to.equal(moved.id)
        expect(told).to.equal(1)
      })

      it('says what went wrong when the files could not be deleted', async () => {
        const el = await card('signed-in', { space: moved })
        el.trashDriveFiles = async () => {
          throw new UserError('quota')
        }
        must(button(el, 'delete-drive-files')).click()
        await confirmWith(el, true)
        await waitUntil(() => text(el).includes('Could not delete the files: quota'), undefined, {
          timeout: 3000,
        })
        expect(button(el, 'delete-drive-files')).to.not.equal(null)
      })
    })
  })
})
