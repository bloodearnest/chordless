/**
 * Which spaces are syncing now (sync-status.ts), what a space with no setlists is (empty-space-kind.ts)
 * and what the home page shows for it (components/empty-space.ts).
 */
import { expect, fixture, html, waitUntil } from '@open-wc/testing'
import '../src/components/empty-space.ts'
import type { EmptySpace } from '../src/components/empty-space.ts'
import type { Space } from '../src/js/data-types.ts'
import { emptySpaceKind } from '../src/js/empty-space-kind.ts'
import { forgetSync, lastSyncOf, recordSync } from '../src/js/last-sync.ts'
import { SyncStatusEvent, syncRunning, trackSync } from '../src/js/sync-status.ts'
import { clearToasts, shownToast, suppressConsoleLogs } from './test-helpers.ts'

const { describe, it, beforeEach, afterEach } = window

suppressConsoleLogs()

const spaceOf = (extra: Partial<Space> = {}): Space => ({
  id: `sync-status-${crypto.randomUUID()}`,
  name: 'Choir',
  createdDate: '2026-11-12T00:00:00Z',
  modifiedDate: '2026-11-12T00:00:00Z',
  ...extra,
})

describe('trackSync', () => {
  let id: string
  beforeEach(() => {
    id = `tracked-${crypto.randomUUID()}`
  })
  afterEach(() => forgetSync(id))

  it('says a space is syncing while it runs, how far it has got, and notes the sync when it is over', async () => {
    const seen: (string | null)[] = []
    const onStatus = (event: SyncStatusEvent) => {
      if (event.spaceId === id) seen.push(syncRunning(id)?.progress?.message ?? null)
    }
    window.addEventListener(SyncStatusEvent.type, onStatus)
    expect(syncRunning(id)).to.equal(null)
    expect(lastSyncOf(id)).to.equal(null)
    let inside: unknown
    try {
      const result = await trackSync(id, async report => {
        report({ stage: 'pulling', message: 'Getting songs', current: 3, total: 10 })
        inside = syncRunning(id)
        return 'done'
      })
      expect(result).to.equal('done')
    } finally {
      window.removeEventListener(SyncStatusEvent.type, onStatus)
    }
    expect(inside).to.deep.include({
      progress: { stage: 'pulling', message: 'Getting songs', current: 3, total: 10 },
    })
    // (started, said how far, over)
    expect(seen).to.deep.equal([null, 'Getting songs', null])
    expect(syncRunning(id)).to.equal(null)
    expect(lastSyncOf(id)).to.not.equal(null)
  })

  it('does not note a sync that failed, but is no longer running, and throws the error again', async () => {
    let error: Error | null = null
    await trackSync(id, () => Promise.reject(new Error('offline'))).catch(e => {
      error = e
    })
    expect((error as Error | null)?.message).to.equal('offline')
    expect(syncRunning(id)).to.equal(null)
    expect(lastSyncOf(id)).to.equal(null)
  })

  it('keeps saying it is syncing until the last of two overlapping syncs is over', async () => {
    let finishFirst = () => {}
    const first = trackSync(
      id,
      () =>
        new Promise<void>(resolve => {
          finishFirst = resolve
        })
    )
    await trackSync(id, async () => {})
    expect(syncRunning(id)).to.not.equal(null)
    finishFirst()
    await first
    expect(syncRunning(id)).to.equal(null)
  })

  it('runs for no space without telling anyone', async () => {
    let told = 0
    const onStatus = () => told++
    window.addEventListener(SyncStatusEvent.type, onStatus)
    try {
      expect(await trackSync(null, async () => 7)).to.equal(7)
    } finally {
      window.removeEventListener(SyncStatusEvent.type, onStatus)
    }
    expect(told).to.equal(0)
  })
})

describe('what a space with no setlists is', () => {
  const ids: string[] = []
  afterEach(() => {
    for (const id of ids.splice(0)) forgetSync(id)
  })
  const space = (extra: Partial<Space> = {}) => {
    const made = spaceOf(extra)
    ids.push(made.id)
    return made
  }

  it('is a first use for a personal space that has never synced and is not in Drive', () => {
    expect(emptySpaceKind(space())).to.equal('first-use')
  })

  it('is not yet fetched for a team, or a space in Drive, that has never synced', () => {
    expect(emptySpaceKind(space({ team: { id: 't', role: 'writer' }, rootRef: 't' }))).to.equal(
      'not-synced'
    )
    expect(emptySpaceKind(space({ rootRef: 'folder' }))).to.equal('not-synced')
  })

  it('is being fetched while a sync of a space never fetched is running', async () => {
    const team = space({ team: { id: 't', role: 'writer' }, rootRef: 't' })
    let kind = ''
    await trackSync(team.id, async () => {
      kind = emptySpaceKind(team)
      // (this one is not a sync that ended well: it has not noted the sync yet)
    })
    expect(kind).to.equal('syncing')
  })

  it('is just empty once it has been fetched, or if it is a team’s with a sync that has been', () => {
    const team = space({ team: { id: 't', role: 'writer' }, rootRef: 't' })
    recordSync(team.id)
    expect(emptySpaceKind(team)).to.equal('empty')
    const personal = space()
    recordSync(personal.id)
    expect(emptySpaceKind(personal)).to.equal('empty')
  })

  it('is not “being fetched” for a routine sync of one that has been', async () => {
    const team = space({ team: { id: 't', role: 'writer' }, rootRef: 't' })
    recordSync(team.id)
    let kind = ''
    await trackSync(team.id, async () => {
      kind = emptySpaceKind(team)
    })
    expect(kind).to.equal('empty')
  })
})

describe('empty-space', () => {
  const ids: string[] = []
  afterEach(() => {
    for (const id of ids.splice(0)) forgetSync(id)
    clearToasts()
  })
  const team = (extra: Partial<Space> = {}) => {
    const made = spaceOf({ team: { id: 't', role: 'writer' }, rootRef: 't', ...extra })
    ids.push(made.id)
    return made
  }
  const show = (space: Space) =>
    fixture<EmptySpace>(html`<empty-space .space=${space}></empty-space>`)
  const text = (el: EmptySpace) => el.shadowRoot?.textContent?.replace(/\s+/g, ' ') ?? ''
  const message = (el: EmptySpace) =>
    el.shadowRoot?.querySelector('status-message')?.getAttribute('message') ?? ''

  it('says the team’s files are being fetched, how far, and what it is when they are in', async () => {
    const space = team({ name: 'Events' })
    const el = await show(space)
    expect(message(el)).to.contain('have not been fetched')

    let report = (_: { stage: 'pulling'; message: string; current: number; total: number }) => {}
    let finish = () => {}
    const syncing = trackSync(
      space.id,
      report0 =>
        new Promise<void>(resolve => {
          report = report0
          finish = resolve
        })
    )
    await waitUntil(() => message(el).includes("Getting Events's songs"), 'the sync to show')
    report({ stage: 'pulling', message: 'Getting 20 of 60', current: 20, total: 60 })
    await waitUntil(
      () =>
        el.shadowRoot?.querySelector('status-message')?.getAttribute('detail') ===
        'Getting 20 of 60'
    )
    const bar = el.shadowRoot?.querySelector('progress-bar') as HTMLElement & {
      current: number
      total: number
    }
    expect([bar.current, bar.total]).to.deep.equal([20, 60])

    finish()
    await syncing
    await waitUntil(() => message(el).includes('has no setlists yet'), 'the empty team')
  })

  it('offers to fetch a space that has not been, and says why when that fails', async () => {
    const el = await show(team({ name: 'Band' }))
    expect(el.shadowRoot?.querySelector('status-message')?.getAttribute('detail')).to.contain(
      'online and signed in'
    )
    el.shadowRoot?.querySelector<HTMLButtonElement>('#fetch-space')?.click()
    await waitUntil(() => shownToast()?.kind === 'error', 'the failure')
    expect(shownToast()?.message).to.contain("Couldn't get Band's songs and setlists")
    expect(shownToast()?.action?.label).to.equal('Try again')
    await waitUntil(
      () => !el.shadowRoot?.querySelector<HTMLButtonElement>('#fetch-space')?.disabled,
      'the button to be free again'
    )
    // (Try again asks again, and fails the same way)
    clearToasts()
    const again = shownToast()
    expect(again).to.equal(null)
    el.shadowRoot?.querySelector<HTMLButtonElement>('#fetch-space')?.click()
    await waitUntil(() => shownToast()?.action?.label === 'Try again', 'the second failure')
    shownToast()?.action?.run()
    await waitUntil(
      () => !el.shadowRoot?.querySelector<HTMLButtonElement>('#fetch-space')?.disabled,
      'the third try to end'
    )
  })

  it('fetches the space when asked, and is free again, with nothing said, when that works', async () => {
    const space = team()
    const el = await show(space)
    const fetched: string[] = []
    el.fetchSpace = async fetching => void fetched.push(fetching.id)
    el.shadowRoot?.querySelector<HTMLButtonElement>('#fetch-space')?.click()
    await waitUntil(() => fetched.length === 1, 'the fetch')
    await waitUntil(
      () => !el.shadowRoot?.querySelector<HTMLButtonElement>('#fetch-space')?.disabled,
      'the button to be free again'
    )
    expect(fetched).to.deep.equal([space.id])
    expect(shownToast()).to.equal(null)
  })

  it('says a team that has been fetched has no setlists, and tells where to make one', async () => {
    const space = team({ name: 'Youth' })
    recordSync(space.id)
    const el = await show(space)
    expect(message(el)).to.equal('Youth has no setlists yet.')
    expect(text(el)).to.not.contain('Welcome')
  })

  it('ignores the sync of another space', async () => {
    const space = team()
    const el = await show(space)
    let updates = 0
    const real = el.requestUpdate.bind(el)
    el.requestUpdate = (...args: Parameters<typeof real>) => {
      updates++
      return real(...args)
    }
    window.dispatchEvent(new SyncStatusEvent('another-space'))
    expect(updates).to.equal(0)
    window.dispatchEvent(new SyncStatusEvent(space.id))
    expect(updates).to.equal(1)
  })
})
