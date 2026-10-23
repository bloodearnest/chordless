/**
 * The page that makes a team space (team-space-wizard.ts): signing in with Drive, a name and a
 * folder, and what is said when the Worker refuses. The Worker is a fetch that answers from a
 * table, Google's sign-in window a stub, the folder chooser and Drive's folder call given in, and
 * the service worker that keeps the sign-in a fake one.
 */
import { expect } from '@open-wc/testing'
import '../src/components/team-space-wizard.ts'
import type { AppModal } from '../src/components/app-modal.ts'
import type { TeamSpaceWizard } from '../src/components/team-space-wizard.ts'
import { ChordlessDB } from '../src/js/db.ts'
import { addChart } from '../src/js/song-utils.ts'
import {
  createSpace,
  deleteSpace,
  getCurrentSpace,
  listSpaces,
  setCurrentSpace,
} from '../src/js/space.ts'
import { makeEntry, makeSetlist } from './builders.ts'
import { type FakeAuthWorker, installFakeAuthWorker } from './fake-auth-worker.ts'
import { must } from './must.ts'
import { suppressConsoleLogs, wait } from './test-helpers.ts'

const { describe, it, beforeEach, afterEach } = window

suppressConsoleLogs()

const encode = (value: object) =>
  btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const idToken = () =>
  `${encode({ alg: 'RS256' })}.${encode({ exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`
const DRIVE = 'https://www.googleapis.com/auth/drive.file'
const user = {
  name: 'Bea Singer',
  email: 'bea@example.com',
  picture: null,
  given_name: null,
  family_name: null,
  sub: '1',
}

describe('team-space-wizard', () => {
  let worker: FakeAuthWorker
  let uninstallWorker: () => void
  const realFetch = window.fetch
  const realGoogle = (window as { google?: unknown }).google
  let requests: { key: string; body?: unknown }[]
  let workerAnswer: () => Response
  let asked: string[]
  let codeResponse: { code?: string; error?: string }
  let page: TeamSpaceWizard
  let shown: number
  let madeFolders: [string, string][]
  let synced: string[]
  let syncFails: boolean
  let before: { id: string | null; name: string }
  const prefix = 'Wizard Church'

  const text = () => (page.shadowRoot?.textContent ?? '').replace(/\s+/g, ' ')
  const button = (label: string) =>
    must(
      Array.from(page.shadowRoot?.querySelectorAll<HTMLButtonElement>('button') ?? []).find(each =>
        each.textContent?.includes(label)
      )
    )
  async function until(condition: () => unknown, what: string) {
    for (let i = 0; i < 100 && !condition(); i++) await wait(20)
    expect(
      condition(),
      `${what}: ${page?.shadowRoot?.textContent?.replace(/\s+/g, ' ').slice(0, 400)}`
    ).to.be.ok
  }
  const type = async (name: string) => {
    const input = must(page.shadowRoot?.querySelector<HTMLInputElement>('#name'))
    input.value = name
    input.dispatchEvent(new Event('input'))
    await page.updateComplete
  }

  async function open(scope: string | null = `${DRIVE} openid email profile`, ownPick = true) {
    if (scope) {
      worker.stored = {
        blob: 'blob',
        metadata: {
          access_token: 'token',
          expires_at: new Date(Date.now() + 3600_000).toISOString(),
          id_token: idToken(),
          scope,
          user,
        },
        updated_at: new Date().toISOString(),
      }
    }
    page = document.createElement('team-space-wizard')
    page.show = () => {
      shown++
    }
    if (ownPick) page.pick = async () => ({ id: 'picked', name: 'Church Drive' })
    page.folders = {
      createTeamFolder: async (parentId, name) => {
        madeFolders.push([parentId, name])
        return 'new-folder'
      },
    }
    page.syncSpace = async space => {
      synced.push(space.name)
      if (syncFails) throw new Error('Drive is not answering')
    }
    document.body.append(page)
    await page.updateComplete
  }

  beforeEach(() => {
    ;({ worker, uninstall: uninstallWorker } = installFakeAuthWorker())
    before = getCurrentSpace()
    shown = 0
    requests = []
    asked = []
    codeResponse = { code: 'the-code' }
    madeFolders = []
    synced = []
    syncFails = false
    workerAnswer = () => Response.json({ spaceId: 'space-dddd4444', role: 'owner' })
    window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), window.location.origin).pathname
      const key = `${init?.method ?? 'GET'} ${path}`
      requests.push({ key, body: init?.body ? JSON.parse(String(init.body)) : undefined })
      if (path === '/oauth/callback') {
        return Response.json({
          blob: 'new-blob',
          access_token: 'tok',
          expires_in: 3600,
          id_token: idToken(),
          scope: `${DRIVE} openid email profile`,
          user,
        })
      }
      if (key === 'POST /api/spaces') return workerAnswer()
      return Response.json({ error: 'no such route' }, { status: 404 })
    }) as typeof fetch
    ;(window as { google?: unknown }).google = {
      accounts: {
        oauth2: {
          initCodeClient: (config: { scope: string; callback: (response: object) => void }) => ({
            requestCode: () => {
              asked.push(config.scope)
              config.callback(codeResponse)
            },
          }),
        },
      },
    }
  })

  afterEach(async () => {
    page?.remove()
    window.fetch = realFetch
    ;(window as { google?: unknown }).google = realGoogle
    uninstallWorker()
    for (const space of await listSpaces()) {
      if (space.name.startsWith(prefix)) await deleteSpace(space.id)
    }
    if (before.id) await setCurrentSpace(before.id, before.name)
  })

  it('asks to sign in with Drive first, then shows the form', async () => {
    await open(null)
    await until(() => text().includes('Sign in with Google'), 'asks to sign in')
    button('Sign in with Google').click()
    await until(() => page.shadowRoot?.querySelector('#name'), 'the form')
    expect(asked).to.have.length(1)
    expect(asked[0]).to.contain(DRIVE)
  })

  it('asks to connect Drive for someone signed in without it', async () => {
    await open('openid email profile')
    await until(() => text().includes('Connect Google Drive'), 'asks to connect Drive')
    button('Connect Google Drive').click()
    await until(() => page.shadowRoot?.querySelector('#name'), 'the form')
    expect(asked).to.deep.equal([DRIVE])
  })

  it('makes the space once it has a name and a folder, and opens it on request', async () => {
    await open()
    await until(() => page.shadowRoot?.querySelector('#name'), 'the form')
    expect(button('Create team space').disabled).to.equal(true)

    const name = `${prefix} ${crypto.randomUUID().slice(0, 8)}`
    await type(name)
    expect(button('Create team space').disabled, 'no folder yet').to.equal(true)
    button('Choose a folder').click()
    await until(() => text().includes('Church Drive'), 'the folder is shown')
    expect(button('Create team space').disabled).to.equal(false)

    button('Create team space').click()
    await until(() => text().includes('is ready'), 'created')
    expect(madeFolders).to.deep.equal([['picked', `${name} Chordless`]])
    const post = must(requests.find(request => request.key === 'POST /api/spaces'))
    expect(post.body).to.deep.equal({ blob: 'blob', rootRef: 'new-folder', name })
    const made = must((await listSpaces()).find(space => space.name === name))
    expect(made.team).to.deep.equal({ id: 'space-dddd4444', role: 'owner' })

    button('Open').click()
    await until(() => shown === 1, 'shows the space')
    expect(getCurrentSpace().id).to.equal(made.id)
  })

  it('says what the Worker said, and leaves the form to try again', async () => {
    workerAnswer = () => Response.json({ error: 'Not allowed' }, { status: 403 })
    await open()
    await until(() => page.shadowRoot?.querySelector('#name'), 'the form')
    await type(`${prefix} refused`)
    button('Choose a folder').click()
    await until(() => text().includes('Church Drive'), 'the folder is shown')
    button('Create team space').click()
    await until(() => text().includes('Not allowed'), 'says why')
    expect(button('Create team space').disabled).to.equal(false)
    expect((await listSpaces()).some(space => space.name === `${prefix} refused`)).to.equal(false)
  })

  it('says why the folder could not be chosen, and keeps the one it had', async () => {
    await open()
    await until(() => page.shadowRoot?.querySelector('#name'), 'the form')
    button('Choose a folder').click()
    await until(() => text().includes('Church Drive'), 'the folder is shown')
    page.pick = async () => {
      throw new Error('The folder picker is not set up on this server')
    }
    button('Choose a different folder').click()
    await until(() => text().includes('not set up'), 'says why')
    expect(text()).to.contain('Church Drive')
  })

  it('says why signing in did not work, and offers it again', async () => {
    codeResponse = { error: 'access_denied' }
    await open(null)
    await until(() => text().includes('Sign in with Google'), 'asks to sign in')
    button('Sign in with Google').click()
    await until(() => page.shadowRoot?.querySelector('.error'), 'says why')
    expect(text()).to.contain('Sign in with Google')
    expect(page.shadowRoot?.querySelector('#name')).to.equal(null)
  })

  it('makes nothing without a name and a folder, whatever is sent to it', async () => {
    await open()
    await until(() => page.shadowRoot?.querySelector('#name'), 'the form')
    await page._create()
    expect(requests.some(request => request.key === 'POST /api/spaces')).to.equal(false)
    expect(madeFolders).to.deep.equal([])
  })

  it('uses the real folder picker unless given another, which says when the server has no key', async () => {
    await open(undefined, false)
    await until(() => page.shadowRoot?.querySelector('#name'), 'the form')
    button('Choose a folder').click()
    await until(() => page.shadowRoot?.querySelector('.error'), 'says why')
    expect(text()).to.contain('not set up')
  })

  it('keeps the folder it had when they cancel choosing another', async () => {
    await open()
    await until(() => page.shadowRoot?.querySelector('#name'), 'the form')
    button('Choose a folder').click()
    await until(() => text().includes('Church Drive'), 'the folder is shown')
    page.pick = async () => null
    button('Choose a different folder').click()
    await wait(50)
    expect(text()).to.contain('Church Drive')
    expect(page.shadowRoot?.querySelector('.error')).to.equal(null)
  })

  it('saves the new space to Drive before saying it is ready, so the team has something to get', async () => {
    await open()
    await until(() => page.shadowRoot?.querySelector('#name'), 'the form')
    const name = `${prefix} saved ${crypto.randomUUID().slice(0, 8)}`
    await type(name)
    button('Choose a folder').click()
    await until(() => text().includes('Church Drive'), 'the folder is shown')
    button('Create team space').click()
    await until(() => text().includes('is ready'), 'created')
    expect(synced).to.deep.equal([name])
    expect(text()).to.not.contain('Couldn’t save')
  })

  it('keeps the space and offers another try when saving to Drive does not work', async () => {
    syncFails = true
    await open()
    await until(() => page.shadowRoot?.querySelector('#name'), 'the form')
    await type(`${prefix} unsaved ${crypto.randomUUID().slice(0, 8)}`)
    button('Choose a folder').click()
    await until(() => text().includes('Church Drive'), 'the folder is shown')
    button('Create team space').click()
    await until(() => text().includes('is ready'), 'created')
    expect(text()).to.contain('Drive is not answering')
    expect(text()).to.contain('so the team can’t get it')

    syncFails = false
    button('Try again').click()
    await until(() => !text().includes('Drive is not answering'), 'tried again')
    expect(text()).to.not.contain('Try again')
    expect(synced).to.have.length(2)
  })

  describe('bringing songs and setlists across', () => {
    const ALPHA = '{title: Alpha}\n{key: G}\n[G]Alpha line'
    const BETA = '{title: Beta}\n{key: D}\n[D]Beta line'
    const ADD = { variantLabel: 'Test', importSource: 'test', makeDefault: 'first' } as const
    let source: { id: string; name: string }

    /** A space on this device with two songs and a setlist (one of them synced, if asked) */
    async function sourceSpace(synced = false) {
      const made = await createSpace(`${prefix} source ${crypto.randomUUID().slice(0, 8)}`)
      source = made
      const db = new ChordlessDB(made.id)
      await db.init()
      const alpha = await addChart(db, ALPHA, ADD)
      await addChart(db, BETA, ADD)
      await db.saveSetlist(
        makeSetlist({
          id: `list-${crypto.randomUUID()}`,
          date: '2026-10-25',
          fileRef: synced ? 'drive-file' : null,
          songs: [makeEntry({ order: 0, songId: alpha.id, songUuid: alpha.uuid, key: 'A' })],
        })
      )
      db.db?.close()
    }

    const check = (id: string) => must(page.shadowRoot?.querySelector<HTMLInputElement>(`#${id}`))
    async function pickSource() {
      await until(() => text().includes('Songs ('), 'something to bring')
      // (with other spaces holding songs as well, there is a choice of where from)
      const select = page.shadowRoot?.querySelector<HTMLSelectElement>('#source')
      if (select) {
        select.value = source.id
        select.dispatchEvent(new Event('change'))
      }
      await until(() => text().includes('Songs (2,'), 'the source counted')
    }
    async function fillForm() {
      await until(() => page.shadowRoot?.querySelector('#name'), 'the form')
      await type(`${prefix} team ${crypto.randomUUID().slice(0, 8)}`)
      button('Choose a folder').click()
      await until(() => text().includes('Church Drive'), 'the folder is shown')
    }
    async function answer(confirm: boolean) {
      const modal = must(page.shadowRoot?.querySelector<AppModal>('app-modal'))
      await until(() => modal.open, 'the question to be asked')
      await modal.updateComplete
      must(
        modal.shadowRoot?.querySelector<HTMLElement>(
          confirm ? '.modal-btn-confirm' : '.modal-btn-cancel'
        )
      ).click()
    }
    const inTeamSpace = async () => {
      const made = must((await listSpaces()).find(space => space.team))
      const db = new ChordlessDB(made.id)
      await db.init()
      const found = { songs: await db.getAllSongs(), setlists: await db.getAllSetlists() }
      db.db?.close()
      return found
    }
    const inSource = async () => {
      const db = new ChordlessDB(source.id)
      await db.init()
      const found = await db.getAllSetlists()
      db.db?.close()
      return found
    }

    /** A space with only these charts (and no setlists), another place to bring songs from */
    async function songsOnlySpace(...charts: string[]) {
      const made = await createSpace(`${prefix} songs ${crypto.randomUUID().slice(0, 8)}`)
      const db = new ChordlessDB(made.id)
      await db.init()
      for (const chart of charts) await addChart(db, chart, ADD)
      db.db?.close()
      return made
    }

    it('lets them choose between spaces that hold songs, and counts the one chosen', async () => {
      const other = await songsOnlySpace('{title: Gamma}\n[C]Gamma line')
      await sourceSpace()
      await open()
      await until(() => page.shadowRoot?.querySelector('#source'), 'a choice of source')
      const select = must(page.shadowRoot?.querySelector<HTMLSelectElement>('#source'))
      select.value = other.id
      select.dispatchEvent(new Event('change'))
      await until(() => text().includes('Songs (1,'), 'the other counted')
      expect(page.shadowRoot?.querySelector('#setlists')).to.equal(null)

      await pickSource()
      expect(text()).to.contain('Setlists (1,')
      check('copy').click()
      check('move').click()
      await page.updateComplete
      expect(check('move').checked).to.equal(true)
    })

    /** Open the page and choose a source, if there is a choice */
    async function openWith(from: { id: string }) {
      await open()
      await until(() => text().includes('Bring across'), 'something to bring')
      const select = page.shadowRoot?.querySelector<HTMLSelectElement>('#source')
      if (select) {
        select.value = from.id
        select.dispatchEvent(new Event('change'))
      }
    }

    it('does not offer a space with nothing in it as a source', async () => {
      const empty = await createSpace(`${prefix} empty ${crypto.randomUUID().slice(0, 8)}`)
      await sourceSpace()
      await open()
      await until(() => text().includes('Bring across'), 'something to bring')
      const offered = [
        ...(page.shadowRoot?.querySelectorAll<HTMLOptionElement>('#source option') ?? []),
      ]
      expect(offered.map(option => option.value)).to.not.include(empty.id)
    })

    it('offers only the setlists of a space that has setlists and no songs', async () => {
      const made = await createSpace(`${prefix} lists ${crypto.randomUUID().slice(0, 8)}`)
      source = made
      const db = new ChordlessDB(made.id)
      await db.init()
      await db.saveSetlist(makeSetlist({ id: `list-${crypto.randomUUID()}`, date: '2026-11-08' }))
      db.db?.close()
      await openWith(source)
      await until(() => text().includes('Setlists (1,'), 'the setlist counted')
      expect(page.shadowRoot?.querySelector('#songs')).to.equal(null)
    })

    it('says nothing new came across when only what a space has none of was asked for', async () => {
      source = await songsOnlySpace('{title: Eta}\n[C]Eta line')
      await openWith(source)
      await until(() => /Songs \(1,/.test(text()), 'the source counted')
      await fillForm()
      check('songs').click()
      await page.updateComplete
      button('Create team space').click()
      await until(() => text().includes('is ready'), 'created')
      expect(text()).to.contain('Nothing new came across')
    })

    it('suggests inviting the people who lead the setlists it brought, but not the person making it', async () => {
      await sourceSpace()
      const db = new ChordlessDB(source.id)
      await db.init()
      // (on different days: a copy skips a setlist that is the same event as one it has)
      for (const [date, owner, ownerId] of [
        ['2026-11-15', 'Cat', 'cat@example.com'],
        ['2026-11-22', 'Bea', 'bea@example.com'],
      ]) {
        await db.saveSetlist(
          makeSetlist({ id: `list-${crypto.randomUUID()}`, date, owner, ownerId })
        )
      }
      db.db?.close()
      await openWith(source)
      await until(() => text().includes('Setlists (3,'), 'three setlists')
      await fillForm()
      check('copy').click()
      await page.updateComplete
      button('Create team space').click()
      await until(() => page.shadowRoot?.querySelector('team-invite-step'), 'created')
      const step = must(page.shadowRoot?.querySelector('team-invite-step'))
      await until(
        () => step.shadowRoot?.textContent?.includes('cat@example.com'),
        'the leader suggested'
      )
      expect(step.shadowRoot?.textContent).to.not.contain('bea@example.com')
    })

    it('shows sizes in KB and in MB', async () => {
      const kb = `{title: Delta}\n[C]${'Delta line '.repeat(300)}`
      source = await songsOnlySpace(kb)
      await openWith(source)
      await until(() => /Songs \(1, \d+ KB\)/.test(text()), 'a size in KB')

      page.remove()
      const mb = `{title: Epsilon}\n[C]${'Epsilon '.repeat(150_000)}`
      source = await songsOnlySpace(mb)
      await openWith(source)
      await until(() => /Songs \(1, \d\.\d MB\)/.test(text()), 'a size in MB')
    })

    it('brings the songs of a space with no setlists, and says "1 song"', async () => {
      source = await songsOnlySpace('{title: Zeta}\n[C]Zeta line')
      await openWith(source)
      await until(() => /Songs \(1,/.test(text()), 'the source counted')
      expect(page.shadowRoot?.querySelector('#move')).to.equal(null)
      await fillForm()
      button('Create team space').click()
      await until(() => text().includes('is ready'), 'created')
      expect(text()).to.contain('1 song came across')
    })

    it('asks about moving 2 setlists in the plural, and says how many stay behind', async () => {
      await sourceSpace(true)
      const db = new ChordlessDB(source.id)
      await db.init()
      await db.saveSetlist(
        makeSetlist({ id: `list-${crypto.randomUUID()}`, date: '2026-11-01', fileRef: 'drive-2' })
      )
      db.db?.close()
      await openWith(source)
      await until(() => text().includes('Setlists (2,'), 'two setlists')
      await fillForm()
      button('Create team space').click()
      const modal = must(page.shadowRoot?.querySelector<AppModal>('app-modal'))
      await until(() => modal.open, 'the question to be asked')
      expect(modal.message).to.contain('2 setlists will move')
      await answer(true)
      await until(() => text().includes('is ready'), 'created')
      expect(text()).to.contain('2 setlists are also still in')
    })

    it('offers what a space holds, with counts and sizes, and nothing where it holds nothing', async () => {
      await sourceSpace()
      await open()
      await pickSource()
      expect(text()).to.match(/Songs \(2, \d+ B\)/)
      expect(text()).to.match(/Setlists \(1, \d+ B\)/)
      expect(check('songs').checked).to.equal(true)
      expect(check('move').checked).to.equal(true)
      expect(text()).to.not.contain('Pads')
    })

    it('copies the songs and moves the setlists when asked, after confirming the move', async () => {
      await sourceSpace()
      await open()
      await pickSource()
      await fillForm()
      button('Create team space').click()
      await answer(true)
      await until(() => text().includes('is ready'), 'created')
      expect(text()).to.contain('2 songs and 1 setlist came across')
      const brought = await inTeamSpace()
      expect(brought.songs).to.have.length(2)
      expect(brought.setlists).to.have.length(1)
      expect(await inSource()).to.have.length(0)
    })

    it('makes nothing when the move is not confirmed', async () => {
      await sourceSpace()
      await open()
      await pickSource()
      await fillForm()
      button('Create team space').click()
      await answer(false)
      await wait(50)
      expect(requests.some(request => request.key === 'POST /api/spaces')).to.equal(false)
      expect(madeFolders).to.deep.equal([])
      expect(await inSource()).to.have.length(1)
    })

    it('keeps a copy in the source when asked, with no question', async () => {
      await sourceSpace()
      await open()
      await pickSource()
      await fillForm()
      check('copy').click()
      await page.updateComplete
      button('Create team space').click()
      await until(() => text().includes('is ready'), 'created')
      expect((await inTeamSpace()).setlists).to.have.length(1)
      expect(await inSource()).to.have.length(1)
    })

    it('brings only what is ticked: no songs, and no setlists, means nothing comes', async () => {
      await sourceSpace()
      await open()
      await pickSource()
      await fillForm()
      check('songs').click()
      check('setlists').click()
      await page.updateComplete
      expect(page.shadowRoot?.querySelector('#move')).to.equal(null)
      button('Create team space').click()
      await until(() => text().includes('is ready'), 'created')
      expect(text()).to.not.contain('came across')
      const brought = await inTeamSpace()
      expect(brought.songs.length + brought.setlists.length).to.equal(0)
    })

    it('says which setlists could not leave the source because they are in Drive', async () => {
      await sourceSpace(true)
      await open()
      await pickSource()
      await fillForm()
      button('Create team space').click()
      await answer(true)
      await until(() => text().includes('is ready'), 'created')
      expect(text()).to.contain('1 setlist is also still in')
      expect(await inSource()).to.have.length(1)
    })

    it('keeps the new space and offers another try when bringing them across fails', async () => {
      await sourceSpace()
      await open()
      await pickSource()
      await fillForm()
      check('setlists').click()
      await page.updateComplete
      const real = ChordlessDB.prototype.init
      ChordlessDB.prototype.init = async function (this: ChordlessDB) {
        if (this.dbName !== source.id && this.dbName !== getCurrentSpace().id) {
          throw new Error('the disk is full')
        }
        return real.call(this)
      }
      try {
        button('Create team space').click()
        await until(() => text().includes('the disk is full'), 'says why')
      } finally {
        ChordlessDB.prototype.init = real
      }
      expect((await listSpaces()).some(space => space.team)).to.equal(true)
      button('Try again').click()
      await until(() => !text().includes('the disk is full'), 'tried again')
      await until(() => text().includes('came across'), 'brought across')
      expect((await inTeamSpace()).songs).to.have.length(2)
    })
  })
})
