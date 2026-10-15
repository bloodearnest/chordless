import { expect, fixture, html } from '@open-wc/testing'
import { SongImportedEvent } from '../src/components/song-import.ts'
import { createSetlist, getCurrentDB } from '../src/js/db.ts'
import { createSong } from '../src/js/song-utils.ts'
import { installFakeAuthWorker } from './fake-auth-worker.ts'
import { must } from './must.ts'
import { suppressConsoleLogs } from './test-helpers.ts'

const { describe, it, afterEach } = window

suppressConsoleLogs()

/** The song-import page's remaining corners: messages, the opener, and what can go wrong */
describe('song-import: corners', () => {
  const unique = (name: string) => `${name} ${crypto.randomUUID().slice(0, 8)}`
  const chart = (title: string, body = '[C]Hello') => `{title: ${title}}\n{key: C}\n\n${body}`
  const importer = async (): Promise<any> => fixture(html`<song-import></song-import>`)
  const $ = (element: any, selector: string) => element.shadowRoot.querySelector(selector)
  const waitFor = async (check: () => unknown, timeout = 2000) => {
    const start = Date.now()
    while (!check()) {
      if (Date.now() - start > timeout) throw new Error('Timed out waiting')
      await new Promise(resolve => setTimeout(resolve, 10))
    }
  }
  const message = (data: unknown) =>
    window.dispatchEvent(
      new MessageEvent('message', { origin: 'https://songselect.ccli.com', data })
    )

  it('imports what the SongSelect bookmarklet sends, and ignores messages of no kind', async () => {
    const element = await importer()
    message(null)
    message({ type: 'other' })
    message({ type: 'CHORDLESS_IMPORT_FAILED' })
    await element.updateComplete
    expect($(element, '[role="alert"]').textContent).to.contain('failed')
    const title = unique('Bookmarklet')
    message({
      type: 'CHORDLESS_IMPORT',
      data: { chordproText: chart(title), metadata: { title }, source: 'songselect' },
    })
    await waitFor(() => element._state === 'choices')
    expect(element._imports[0].song.title).to.equal(title)
  })

  it('tells the page that opened it that it is ready', async () => {
    const posted: unknown[] = []
    const real = Object.getOwnPropertyDescriptor(window, 'opener')
    Object.defineProperty(window, 'opener', {
      configurable: true,
      value: { postMessage: (data: unknown) => posted.push(data) },
    })
    try {
      const element = await importer()
      expect(posted).to.deep.equal([{ type: 'CHORDLESS_READY' }])
      expect(element.shadowRoot.textContent).to.contain('Waiting for song data')
      Object.defineProperty(window, 'opener', {
        configurable: true,
        value: {
          postMessage: () => {
            throw new Error('closed')
          },
        },
      })
      element._signalReady()
    } finally {
      if (real) Object.defineProperty(window, 'opener', real)
      else Reflect.deleteProperty(window, 'opener')
    }
  })

  it('imports a chart with a CCLI number, from the chart or the sender', async () => {
    const element = await importer()
    await element.receiveAll([
      { name: 'a', chordproText: `${chart(unique('Ccli A'))}\n{ccli: 7000001}`, source: 'paste' },
      {
        name: 'b',
        chordproText: chart(unique('Ccli B')),
        metadata: { ccliNumber: '7000002' },
        source: 'paste',
      },
      { name: 'c', chordproText: '[C]no title', source: 'paste' },
    ])
    expect(
      element._imports.map((item: { song: { title: string } }) => item.song.title)
    ).to.have.length(3)
    expect(element._imports[2].song.title).to.equal('Untitled')
  })

  it('does not import from the paste box once it has gone', async () => {
    const element = await importer()
    await element.receive({ chordproText: chart(unique('Pasted')), source: 'paste' })
    await element.updateComplete
    element._importPasted()
    await waitFor(() => element._error)
    expect(element._error).to.contain('No songs to import')
  })

  it('says so when the setlist it was to add to is not there, or cannot be saved', async () => {
    const element = await importer()
    await element.receive({ chordproText: chart(unique('Lost')), source: 'paste' })
    await element._addToSetlist('no-such-setlist')
    expect(element._error).to.contain('Setlist not found')
  })

  it('says so when a song cannot be updated', async () => {
    const element = await importer()
    await element.receive({ chordproText: chart(unique('Gone')), source: 'paste' })
    await element._update({ song: { uuid: 'no-such-song' }, chordproText: 'x' })
    expect(element._error).to.contain('Failed to update song')
  })

  it('names setlists with a name, and asks about several songs already in the library', async () => {
    const db = await getCurrentDB()
    const setlist = createSetlist({ date: '2099-02-02', name: unique('Named') })
    await db.saveSetlist(setlist)
    const titles = [unique('Dup one'), unique('Dup two')]
    for (const title of titles) await createSong(chart(title))
    const element = await importer()
    await element.receiveAll(
      titles.map(title => ({ name: title, chordproText: chart(title), source: 'paste' }))
    )
    await element.updateComplete
    expect(element.shadowRoot.textContent).to.contain('2 of these songs are already')
    $(element, '.use-existing-all').click()
    await waitFor(() => $(element, '.choices'))
    expect($(element, 'select').textContent).to.contain(setlist.name)
  })

  it('opens the new setlist form for a user nobody knows, and a failed save of it is shown', async () => {
    const element = await importer()
    await element.receive({ chordproText: chart(unique('Fresh')), source: 'paste' })
    await element.updateComplete
    await element._openNewSetlist()
    const db = element._db
    const real = db.saveSetlist
    db.saveSetlist = async () => {
      throw new Error('disk full')
    }
    try {
      await element._createSetlist(
        Object.assign(new Event('x'), { details: { date: '2099-03-03', name: 'N' } })
      )
    } finally {
      db.saveSetlist = real
    }
    expect(element._error).to.contain('Failed to create setlist')
    must(element)
    expect(SongImportedEvent.type).to.be.a('string')
  })

  describe('with someone signed in', () => {
    let auth: ReturnType<typeof installFakeAuthWorker>
    afterEach(() => auth?.uninstall())

    it('starts a new setlist led by them, for several songs, and saves it', async () => {
      auth = installFakeAuthWorker()
      auth.worker.stored = {
        blob: 'blob',
        metadata: {
          access_token: 'token',
          expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
          user: {
            picture: null,
            given_name: null,
            family_name: null,
            sub: '1',
            name: 'Ann Singer',
            email: 'ann@example.com',
          },
        },
        updated_at: new Date().toISOString(),
      } as never
      const db = await getCurrentDB()
      await db.saveSetlist(createSetlist({ date: '2099-04-04' }))
      const element = await importer()
      await element.receiveAll([
        { name: 'a', chordproText: chart(unique('Many A')), source: 'paste' },
        { name: 'b', chordproText: chart(unique('Many B')), source: 'paste' },
      ])
      await element.updateComplete
      expect($(element, 'select').textContent).to.contain('2099')
      await element._openNewSetlist()
      expect(element._newSetlist.owner).to.equal('Ann Singer')
      expect($(element, 'setlist-details-form').getAttribute('submit-label')).to.contain('Songs')
      const url = new Promise<string>(resolve =>
        element.addEventListener(
          SongImportedEvent.type,
          (event: SongImportedEvent) => {
            event.preventDefault()
            resolve(event.url)
          },
          { once: true }
        )
      )
      await element._createSetlist(
        Object.assign(new Event('x'), { details: { date: '2099-05-05', name: 'Made' } })
      )
      expect(await url).to.match(/^\/setlist\//)
    })
  })

  it('goes to the library when several songs were imported to it only', async () => {
    const element = await importer()
    await element.receiveAll([
      { name: 'a', chordproText: chart(unique('Lib A')), source: 'paste' },
      { name: 'b', chordproText: chart(unique('Lib B')), source: 'paste' },
    ])
    const url = new Promise<string>(resolve =>
      element.addEventListener(
        SongImportedEvent.type,
        (event: SongImportedEvent) => {
          event.preventDefault()
          resolve(event.url)
        },
        { once: true }
      )
    )
    element._libraryOnly()
    expect(await url).to.equal('/songs')
  })

  it('shows what went wrong when a song cannot be processed', async () => {
    const element = await importer()
    await element.receive({ chordproText: 5, source: 'paste' })
    expect(element._error).to.contain('Failed to process song')
  })
})
