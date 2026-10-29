/** The view of a setlist someone shared by link, with a receiver that says what each link holds */
import { expect } from '@open-wc/testing'
import { ChordlessDB } from '../src/js/db.ts'
import { offerLink, takeLink } from '../src/js/incoming-link.ts'
import { setRouter } from '../src/js/navigation.ts'
import type { ShareOpening } from '../src/js/share-receiver.ts'
import { shareSetlistId } from '../src/js/share-receiver.ts'
import '../src/js/views/share-view.ts'
import type { ShareView } from '../src/js/views/share-view.ts'
import { makeSetlist } from './builders.ts'
import { deleteDatabase, suppressConsoleLogs, wait } from './test-helpers.ts'

const { describe, it, beforeEach, afterEach } = window

suppressConsoleLogs()

const KEY = 'A'.repeat(22)
const CODE = 'abc123'

describe('the share view', () => {
  let outlet: HTMLElement
  let view: ShareView
  let visited: Array<{ url: string; replace?: boolean }>
  const dbs: ChordlessDB[] = []
  const startUrl = window.location.pathname + window.location.search

  beforeEach(() => {
    visited = []
    setRouter({
      navigate: async (url: string, options?: { replace?: boolean }) => {
        visited.push({ url, replace: options?.replace })
        return true
      },
    })
    outlet = document.createElement('div')
    document.body.append(outlet)
  })

  afterEach(async () => {
    view?.remove()
    outlet.remove()
    setRouter(null)
    window.history.replaceState(null, '', startUrl)
    for (const db of dbs.splice(0)) {
      db.db?.close()
      await deleteDatabase(db.dbName)
    }
  })

  /** Open a share whose receiver gives this (or fails, or says this setlist is the user's own) */
  async function open(
    opening: ShareOpening | Error,
    {
      own = null,
      hash = '',
      songIndex = -1,
    }: { own?: string | null; hash?: string; songIndex?: number } = {}
  ) {
    window.history.replaceState(null, '', `${startUrl}${hash}`)
    view = document.createElement('share-view')
    view.receiver = {
      ownSetlistFor: async () => own,
      openShare: async () => {
        if (opening instanceof Error) throw opening
        return opening
      },
    }
    view.route = { name: 'share', fileId: 'file1', songIndex }
    outlet.append(view)
    await wait(150)
    return view
  }

  const status = () => view.querySelector('#share-status')

  async function readyOpening(received: object = {}): Promise<ShareOpening> {
    const db = new ChordlessDB(`test-share-${crypto.randomUUID()}`)
    await db.init()
    dbs.push(db)
    const setlist = makeSetlist({
      id: shareSetlistId('file1'),
      date: '2026-10-25',
      received: { fileId: 'file1', leaderName: 'Ann', ...received },
    } as never)
    await db.saveSetlist(setlist)
    return { state: 'ready', db, setlist, fresh: true }
  }

  it('says it is opening, until it has the setlist', async () => {
    view = document.createElement('share-view')
    view.receiver = {
      ownSetlistFor: async () => null,
      openShare: () => new Promise(() => {}),
    }
    view.route = { name: 'share', fileId: 'file1', songIndex: -1 }
    outlet.append(view)
    await wait(50)
    expect(status()?.getAttribute('data-state')).to.equal('loading')
    expect(view.textContent).to.not.contain('Go to Chordless')
  })

  it('says what is wrong with a link that cannot show a setlist', async () => {
    const cases: Array<[ShareOpening, string, string]> = [
      [{ state: 'ended' }, 'ended', 'This share has ended'],
      [{ state: 'needs-key' }, 'needs-key', 'This link is incomplete'],
      [{ state: 'bad-key' }, 'bad-key', "This link doesn't open the setlist"],
      [{ state: 'unavailable', offline: false }, 'unavailable', "Can't reach the setlist"],
      [{ state: 'unavailable', offline: true }, 'unavailable', "You're offline"],
    ]
    for (const [opening, state, heading] of cases) {
      await open(opening)
      expect(status()?.getAttribute('data-state'), heading).to.equal(state)
      expect(status()?.textContent?.trim(), heading).to.equal(heading)
      expect(view.textContent).to.contain('Go to Chordless')
      view.remove()
    }
  })

  it('says it cannot reach the setlist when opening it fails', async () => {
    await open(new Error('boom'))
    expect(status()?.getAttribute('data-state')).to.equal('unavailable')
    expect(status()?.textContent?.trim()).to.equal("Can't reach the setlist")
  })

  it('goes to the setlist instead, for someone who has it in their space', async () => {
    await open({ state: 'ended' }, { own: 'own-setlist', hash: `#${KEY}${CODE}`, songIndex: 2 })
    expect(visited).to.deep.equal([{ url: '/setlist/own-setlist/song/2', replace: true }])
  })

  it('takes the key and code the installed app was launched with, when the address has none', async () => {
    offerLink('/s/file1', `#${KEY}${CODE}`)
    const owned: string[] = []
    const opened: string[] = []
    view = document.createElement('share-view')
    view.receiver = {
      ownSetlistFor: async (code: string) => {
        owned.push(code)
        return null
      },
      openShare: async (_fileId: string, key: string) => {
        opened.push(key)
        return { state: 'ended' } as ShareOpening
      },
    }
    view.route = { name: 'share', fileId: 'file1', songIndex: -1 }
    outlet.append(view)
    await wait(100)
    expect(opened).to.deep.equal([KEY])
    expect(owned).to.deep.equal([CODE])
    expect(takeLink('/s/file1')).to.equal(null)
  })

  it('does not look for an own setlist when the link has no code', async () => {
    let asked = 0
    view = document.createElement('share-view')
    view.receiver = {
      ownSetlistFor: async () => {
        asked++
        return 'x'
      },
      openShare: async () => ({ state: 'ended' }) as ShareOpening,
    }
    view.route = { name: 'share', fileId: 'file1', songIndex: -1 }
    window.history.replaceState(null, '', `${startUrl}#${KEY}`)
    outlet.append(view)
    await wait(100)
    expect(asked).to.equal(0)
    expect(visited).to.deep.equal([])
  })

  it('lets go of a setlist it opened for a view that has gone', async () => {
    const opening = await readyOpening()
    const real = opening.state === 'ready' ? opening.db : null
    let closed = 0
    const realClose = real?.db?.close.bind(real.db)
    if (real?.db) {
      real.db.close = () => {
        closed++
        realClose?.()
      }
    }
    view = document.createElement('share-view')
    view.receiver = {
      ownSetlistFor: async () => null,
      openShare: async () => {
        view.remove()
        return opening
      },
    }
    view.route = { name: 'share', fileId: 'file1', songIndex: -1 }
    outlet.append(view)
    await wait(100)
    expect(closed).to.equal(1)
  })

  it('refuses a view with no share route', async () => {
    view = document.createElement('share-view')
    view.receiver = { ownSetlistFor: async () => null, openShare: async () => ({ state: 'ended' }) }
    view.route = { name: 'home' }
    const errors: unknown[] = []
    const onError = (event: PromiseRejectionEvent) => {
      errors.push(event.reason)
      event.preventDefault()
    }
    window.addEventListener('unhandledrejection', onError)
    outlet.append(view)
    await wait(100)
    window.removeEventListener('unhandledrejection', onError)
    expect(String(errors[0])).to.contain('no share route')
  })

  describe('with a setlist', () => {
    it('shows it, with a banner on the overview that says who shared it and until when', async () => {
      await open(await readyOpening({ expires: '2026-12-25T00:00:00Z' }))
      const banner = view.querySelector('#share-banner')
      expect(banner?.textContent).to.contain('Shared with you by')
      expect(banner?.textContent).to.contain('Ann')
      expect(banner?.textContent).to.contain('until')
      expect(view.querySelector('#app-header')).to.not.equal(null)
    })

    it('has no mention of who or until when, when it does not know', async () => {
      const opening = await readyOpening()
      if (opening.state === 'ready' && opening.setlist.received)
        opening.setlist.received.leaderName = ''
      await open(opening)
      const banner = view.querySelector('#share-banner')
      expect(banner?.textContent).to.not.contain(' by ')
      expect(banner?.textContent).to.not.contain('until')
    })

    it('has no banner on a song', async () => {
      await open(await readyOpening(), { songIndex: 0 })
      expect(view.querySelector('#share-banner')).to.equal(null)
    })

    it('keeps its state, and follows the route', async () => {
      await open(await readyOpening())
      expect(view.captureViewState()).to.not.equal(null)
      view.route = { name: 'share', fileId: 'file1', songIndex: 0 }
      await view.updateComplete
      await wait(50)
      expect(view.querySelector('#share-banner')).to.equal(null)
    })

    it('stops when it is removed', async () => {
      await open(await readyOpening())
      view.remove()
      expect(view.captureViewState()).to.equal(undefined)
    })
  })
})
