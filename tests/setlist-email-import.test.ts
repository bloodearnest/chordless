/**
 * Making a setlist from an email: the review of its songs, what the person decides, and the
 * setlist it makes or the one it updates. (The whole thing, in a browser through a link from the
 * Worker, is in import-setlist.playwright.ts.)
 */
import { expect, fixture, html, waitUntil } from '@open-wc/testing'
import {
  type SetlistEmailImport,
  SetlistEmailImportedEvent,
} from '../src/components/setlist-email-import.ts'
import { type ChordlessDB, getCurrentDB } from '../src/js/db.ts'
import { encodeImport } from '../src/js/email-link.ts'
import type { ImportedSetlist } from '../src/js/email-setlist.ts'
import { offerLink, takeLink } from '../src/js/incoming-link.ts'
import { setRouter } from '../src/js/navigation.ts'
import { SHARED_DB_ID } from '../src/js/share-receiver.ts'
import { addChart, createSong } from '../src/js/song-utils.ts'
import { createSpace, deleteSpace, getCurrentSpace, setCurrentSpace } from '../src/js/space.ts'
import { makeEntry, makeImportedSong, makeSetlist } from './builders.ts'
import { FakeAuthWorker, installFakeAuthWorker } from './fake-auth-worker.ts'
import { must } from './must.ts'
import { deleteDatabase, suppressConsoleLogs, wait } from './test-helpers.ts'
import '../src/components/setlist-email-import.ts'

const { describe, it, beforeEach, afterEach } = window

suppressConsoleLogs()

const KEPT = 'chordless:email-import'
const chart = (title: string, ccli = '', key = 'G') =>
  `{title: ${title}}\n{key: ${key}}\n${ccli ? `{ccli: ${ccli}}\n` : ''}\n[${key}]${title} words`

const email = (over: Partial<ImportedSetlist> = {}): ImportedSetlist => ({
  name: 'Sunday 25th October',
  date: '2099-10-25',
  dateWarning: null,
  sentDate: '2099-10-20',
  orderFromList: true,
  leader: { name: 'Leader One', email: 'one@example.com' },
  songs: [],
  unlisted: [],
  ...over,
})

describe('setlist-email-import', () => {
  let before: { id: string | null; name: string }
  let spaceId: string
  let db: ChordlessDB
  let importer: SetlistEmailImport
  let visited: string[]
  const startUrl = window.location.pathname + window.location.search

  beforeEach(async () => {
    visited = []
    setRouter({
      navigate: async (url: string) => {
        visited.push(url)
        return true
      },
    })
    sessionStorage.removeItem(KEPT)
    takeLink('/import-setlist')
    before = getCurrentSpace()
    const space = await createSpace(`Email ${crypto.randomUUID().slice(0, 8)}`)
    spaceId = space.id
    await setCurrentSpace(space.id, space.name)
    db = await getCurrentDB()
  })

  afterEach(async () => {
    importer?.remove()
    setRouter(null)
    sessionStorage.removeItem(KEPT)
    takeLink('/import-setlist')
    window.history.replaceState(null, '', startUrl)
    db.db?.close()
    await deleteDatabase(SHARED_DB_ID)
    await deleteSpace(spaceId)
    if (before.id) await setCurrentSpace(before.id, before.name)
  })

  async function open() {
    importer = await fixture<SetlistEmailImport>(
      html`<setlist-email-import></setlist-email-import>`
    )
    await wait(30)
    return importer
  }
  /** Open it on an email to review */
  async function review(
    imported: ImportedSetlist,
    ...rest: Parameters<SetlistEmailImport['_review']> extends [unknown, ...infer R] ? R : never
  ) {
    await open()
    await importer._review(imported, ...rest)
    await importer.updateComplete
  }
  const text = () => importer.shadowRoot?.textContent?.replace(/\s+/g, ' ') ?? ''
  const $ = (selector: string) => importer.shadowRoot?.querySelector<HTMLElement>(selector) ?? null
  const $$ = (selector: string) => [
    ...(importer.shadowRoot?.querySelectorAll<HTMLElement>(selector) ?? []),
  ]
  const button = (label: RegExp) => $$('button').find(b => label.test(b.textContent ?? ''))
  const change = async (
    el: HTMLElement | null | undefined,
    set: (el: HTMLInputElement) => void
  ) => {
    const input = must(el) as HTMLInputElement
    set(input)
    input.dispatchEvent(
      new Event(input.type === 'checkbox' || input.type === 'radio' ? 'change' : 'input')
    )
    await importer.updateComplete
  }

  describe('before an email', () => {
    it('explains how to get one', async () => {
      await open()
      expect(text()).to.contain('Import a setlist from an email')
      expect(text()).to.contain('import@chordless.app')
      expect(importer._state).to.equal('pick')
    })

    it('says so when a link cannot be read, and takes the fragment off the address', async () => {
      await open()
      window.history.replaceState(null, '', `${startUrl}#not-a-link`)
      expect(await importer._openLink('#not-a-link')).to.equal(true)
      await importer.updateComplete
      expect(text()).to.contain('Could not read that link')
      expect(window.location.hash).to.equal('')
      expect(importer._state).to.equal('pick')
    })

    it('reads a link from the address when it opens', async () => {
      const fragment = await encodeImport(email({ songs: [makeImportedSong('Alpha Song')] }))
      window.history.replaceState(null, '', `${startUrl}#${fragment}`)
      await open()
      await waitUntil(() => importer._state === 'review', 'the review')
      expect(window.location.hash).to.equal('')
    })

    it('reads a link the installed app was given, when it opens or when it is open', async () => {
      const fragment = await encodeImport(email({ songs: [makeImportedSong('Alpha Song')] }))
      offerLink('/import-setlist', `#${fragment}`)
      await open()
      await waitUntil(() => importer._state === 'review', 'the review')
      await importer._startAgain()
      offerLink('/import-setlist', `#${fragment}`)
      await waitUntil(() => importer._state === 'review', 'the review again')
    })

    it('reads a link that is put in the address of a page that is open', async () => {
      await open()
      const fragment = await encodeImport(email({ songs: [makeImportedSong('Alpha Song')] }))
      window.history.replaceState(null, '', `${startUrl}#${fragment}`)
      window.dispatchEvent(new HashChangeEvent('hashchange'))
      await waitUntil(() => importer._state === 'review', 'the review')
      window.history.replaceState(null, '', `${startUrl}#`)
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    })

    it('ignores a link offered after it has gone', async () => {
      await open()
      importer.remove()
      offerLink('/import-setlist', '#whatever')
      await wait(30)
      expect(takeLink('/import-setlist')).to.equal('#whatever')
    })

    it('goes back to what was being reviewed, with the decisions made', async () => {
      await createSong(chart('Alpha Song', '111'), {})
      const imported = email({ songs: [makeImportedSong('Alpha Song', { ccli: '111' })] })
      sessionStorage.setItem(
        KEPT,
        JSON.stringify({
          email: imported,
          rows: [{ include: false, pick: 'new', key: 'A', notes: 'again' }],
          unlisted: [],
        })
      )
      await open()
      await waitUntil(() => importer._state === 'review', 'the review')
      expect(importer._rows[0]).to.include({ include: false, key: 'A', notes: 'again' })
    })

    it('goes back to the first page when what was kept cannot be read, or has no email', async () => {
      sessionStorage.setItem(KEPT, '{not json')
      await open()
      expect(importer._state).to.equal('pick')
      expect(sessionStorage.getItem(KEPT)).to.equal(null)
      importer.remove()
      sessionStorage.setItem(KEPT, JSON.stringify({ rows: [] }))
      await open()
      expect(importer._state).to.equal('pick')
    })
  })

  describe('the review', () => {
    it('shows the songs of the email, found in the library, or not', async () => {
      await createSong(chart('Alpha Song', '111'), {})
      await review(
        email({
          songs: [
            makeImportedSong('Alpha Song', { ccli: '111', listed: 'Alpha (chorus)' }),
            makeImportedSong('Totally New Song', { ccli: '2222222' }),
            makeImportedSong('Another New Song'),
          ],
        })
      )
      expect(text()).to.contain('Sunday 25th October')
      expect(text()).to.contain('1. Alpha Song')
      expect(text()).to.contain('listed as “Alpha (chorus)”')
      expect(text()).to.contain('✓ In your library')
      expect(text()).to.contain('Open it on SongSelect')
      expect(text()).to.contain('Search SongSelect for it')
      expect(text()).to.contain('2 songs are not in your library yet')
      expect((button(/Create setlist/) as HTMLButtonElement).disabled).to.equal(true)
    })

    it('says one song is missing in the singular', async () => {
      await review(email({ songs: [makeImportedSong('Totally New Song')] }))
      expect(text()).to.contain('1 song is not in your library yet')
      expect(text()).to.contain(
        'Open it on SongSelect'
          .replace('Open it on', 'Search')
          .replace('Search SongSelect', 'Search SongSelect')
      )
    })

    it('says what is doubtful about the email', async () => {
      await review(email({ dateWarning: 'Its weekday is wrong', date: '', orderFromList: false }))
      expect(text()).to.contain('Its weekday is wrong. Check the date below.')
      expect(text()).to.contain('The email gave no date')
      expect(text()).to.contain('no list of songs')
      expect(importer._setlist.date).to.match(/^\d{4}-\d{2}-\d{2}$/)
    })

    it('says a chart was taken for a song by elimination', async () => {
      await createSong(chart('Holy Is The Lord'), {})
      await review(
        email({
          songs: [
            makeImportedSong('Holy Is The Lord', {
              pairedBy: 'elimination',
              listed: 'Holy Is The Lord',
            }),
          ],
        })
      )
      expect(text()).to.contain('in the same key, and no other song was left')
    })

    it('lists charts attached but not in the list, for the person to add', async () => {
      await createSong(chart('Extra Song'), {})
      await review(email({ unlisted: [makeImportedSong('Extra Song')] }))
      expect(text()).to.contain('Charts attached but not in the list')
      expect(importer._unlisted[0].include).to.equal(false)
      await change($('input[aria-label="Add Extra Song"]'), el => {
        el.checked = true
      })
      expect(importer._unlisted[0].include).to.equal(true)
    })

    it('offers the songs it might be, and says when they were found by their words', async () => {
      await createSong(chart('Amazing Grace'), {})
      await createSong(
        chart('Great Is Thy Faithfulness', '', 'D').replace('words', 'oh how sweet the sound'),
        {}
      )
      await review(
        email({
          songs: [
            makeImportedSong('Amazing Grace Medley'),
            makeImportedSong('how sweet the sound'),
          ],
        })
      )
      expect(text()).to.contain('Is it one of these?')
      expect(text()).to.contain('No song has that title, but its words are in these:')
      expect(text()).to.contain('None of these')
      expect(importer._rows[0].pick).to.not.equal('new')
      expect(importer._rows[1].pick).to.equal('new')
    })
  })

  describe('what the person decides', () => {
    it('is kept, and survives a reload', async () => {
      await createSong(chart('Alpha Song', '111'), {})
      await review(email({ songs: [makeImportedSong('Alpha Song', { ccli: '111' })] }))
      await change($('input.key'), el => {
        el.value = 'A'
      })
      await change($('.note input'), el => {
        el.value = 'four times'
      })
      const kept = JSON.parse(must(sessionStorage.getItem(KEPT)))
      expect(kept.rows[0]).to.include({ key: 'A', notes: 'four times', include: true })
    })

    it('leaves a song out, and takes it back', async () => {
      await createSong(chart('Alpha Song', '111'), {})
      await review(
        email({
          songs: [makeImportedSong('Alpha Song', { ccli: '111' }), makeImportedSong('Missing One')],
        })
      )
      await change($('input[aria-label="Include Alpha Song"]'), el => {
        el.checked = false
      })
      expect(importer._rows[0].include).to.equal(false)
      expect(importer._chosen()).to.have.length(0)
      button(/Leave it out/)?.click()
      await importer.updateComplete
      expect(importer._rows[1].include).to.equal(false)
      expect(text()).to.contain('Not in your library.')
      expect(importer._missing()).to.have.length(0)
    })

    it('picks one of the songs it might be, or none, which then has to be imported', async () => {
      await createSong(chart('Amazing Grace'), {})
      await review(email({ songs: [makeImportedSong('Amazing Grace Medley')] }))
      const radios = $$('.candidates input[type="radio"]') as HTMLInputElement[]
      expect(radios).to.have.length(2)
      await change(radios[1], el => {
        el.checked = true
      })
      expect(importer._rows[0].pick).to.equal('new')
      expect(importer._missing()).to.have.length(1)
      expect(text()).to.contain('Search SongSelect for it')
      await change($$('.candidates input[type="radio"]')[0], el => {
        el.checked = true
      })
      expect(importer._missing()).to.have.length(0)
    })

    it('starts over', async () => {
      await review(email())
      button(/Start over/)?.click()
      await importer.updateComplete
      expect(importer._state).to.equal('pick')
      expect(sessionStorage.getItem(KEPT)).to.equal(null)
    })

    it('has nothing to keep with no email, and does not mind storage being off', async () => {
      await open()
      importer._keep()
      expect(sessionStorage.getItem(KEPT)).to.equal(null)
      const realSet = Storage.prototype.setItem
      const realRemove = Storage.prototype.removeItem
      // (only the session's: the rest of the app keeps using storage)
      Storage.prototype.setItem = function (key: string, value: string) {
        if (this === sessionStorage) throw new Error('full')
        return realSet.call(this, key, value)
      }
      Storage.prototype.removeItem = function (key: string) {
        if (this === sessionStorage) throw new Error('off')
        return realRemove.call(this, key)
      }
      try {
        await importer._review(email())
        importer._forget()
      } finally {
        Storage.prototype.setItem = realSet
        Storage.prototype.removeItem = realRemove
      }
    })
  })

  describe('the library, looked at again', () => {
    it('finds a song that was imported from SongSelect meanwhile, on coming back', async () => {
      await review(email({ songs: [makeImportedSong('Arrives Later', { ccli: '9999999' })] }))
      expect(importer._missing()).to.have.length(1)
      await createSong(chart('Arrives Later', '9999999'), {})
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
      document.dispatchEvent(new Event('visibilitychange'))
      await waitUntil(() => importer._missing().length === 0, 'the song to be found')
      window.dispatchEvent(new Event('focus'))
    })

    it('does nothing when the page is hidden, or when nothing is being reviewed', async () => {
      await open()
      await importer._refresh()
      await review(email())
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
      try {
        document.dispatchEvent(new Event('visibilitychange'))
      } finally {
        delete (document as { visibilityState?: unknown }).visibilityState
      }
    })

    it('keeps what it had when the library cannot be read', async () => {
      await review(email({ songs: [makeImportedSong('Whatever')] }))
      const real = Object.getPrototypeOf(db).getAllSongs
      Object.getPrototypeOf(db).getAllSongs = () => Promise.reject(new Error('unreadable'))
      try {
        await importer._refresh()
      } finally {
        Object.getPrototypeOf(db).getAllSongs = real
      }
      expect(importer._rows).to.have.length(1)
    })
  })

  describe('the leader', () => {
    it('is told by email, or by name', async () => {
      await open()
      const leader = { name: 'Leader One', email: 'one@example.com' }
      const setlist = (over: object) => makeSetlist(over as never)
      expect(importer._isLeader(setlist({ ownerId: 'ONE@example.com' }), leader)).to.equal(true)
      expect(importer._isLeader(setlist({ ownerId: 'two@example.com' }), leader)).to.equal(false)
      expect(importer._isLeader(setlist({ owner: 'leader one', ownerId: '' }), leader)).to.equal(
        true
      )
      expect(importer._isLeader(setlist({ owner: 'Someone', ownerId: '' }), leader)).to.equal(false)
      expect(
        importer._isLeader(setlist({ owner: 'Leader One' }), { name: '', email: '' })
      ).to.equal(false)
    })
  })

  describe('making the setlist', () => {
    async function ready() {
      await createSong(chart('Alpha Song', '111'), {})
      await createSong(chart('Bravo Song', '222', 'D'), {})
      await review(
        email({
          songs: [
            makeImportedSong('Alpha Song', { ccli: '111', key: 'A', tempo: 90 }),
            makeImportedSong('Bravo Song', { ccli: '222', key: 'D', notes: 'drop out' }),
          ],
        })
      )
    }

    it('is made with the songs in order, and the page goes to it', async () => {
      await ready()
      const seen: string[] = []
      importer.addEventListener(SetlistEmailImportedEvent.type, event =>
        seen.push((event as SetlistEmailImportedEvent).url)
      )
      button(/Create setlist/)?.click()
      await waitUntil(() => visited.length === 1, 'the page to go to the setlist')
      expect(visited[0]).to.match(/^\/setlist\//)
      expect(seen).to.deep.equal(visited)
      const [setlist] = await db.getAllSetlists()
      expect(setlist.songs.map(entry => [entry.key, entry.tempo, entry.notes])).to.deep.equal([
        ['A', 90, ''],
        ['D', null, 'drop out'],
      ])
      expect(sessionStorage.getItem(KEPT)).to.equal(null)
    })

    it('is made from the details the page worked out when it is not given others', async () => {
      await ready()
      await importer._save()
      await waitUntil(() => visited.length === 1, 'the page to go to the setlist')
      expect((await db.getAllSetlists())[0].name).to.equal('Sunday 25th October')
    })

    it('stays where it is when the listener cancels the move', async () => {
      await ready()
      importer.addEventListener(SetlistEmailImportedEvent.type, event => event.preventDefault())
      button(/Create setlist/)?.click()
      await waitUntil(
        () => db.getAllSetlists().then(all => all.length === 1) as never,
        'the setlist'
      )
      await wait(50)
      expect(visited).to.deep.equal([])
    })

    it('says why it could not be made, and goes back to the review', async () => {
      await ready()
      const real = Object.getPrototypeOf(db).saveSetlist
      Object.getPrototypeOf(db).saveSetlist = () => Promise.reject(new Error('disk full'))
      try {
        button(/Create setlist/)?.click()
        await waitUntil(() => importer._error, 'the failure to be shown')
      } finally {
        Object.getPrototypeOf(db).saveSetlist = real
      }
      expect(importer._error).to.contain('disk full')
      expect(importer._state).to.equal('review')
    })

    it('is not made while a song is missing, or with no database', async () => {
      await review(email({ songs: [makeImportedSong('Not Here')] }))
      await importer._save()
      expect((await db.getAllSetlists()).length).to.equal(0)
      importer._db = null
      await importer._save()
      expect(() => importer._reviewed(importer._rows[0])).to.throw('is not in the library')
    })

    it('has a song of another database copied into the library with it', async () => {
      const shared = new (await import('../src/js/db.ts')).ChordlessDB(SHARED_DB_ID)
      await shared.init()
      await addChart(shared, chart('Shared Only Song', '7654321'), {
        variantLabel: 'Shared',
        importSource: 'test',
        makeDefault: 'first',
      })
      shared.db?.close()
      await review(email({ songs: [makeImportedSong('Shared Only Song', { ccli: '7654321' })] }))
      expect(text()).to.contain('copied into your library')
      button(/Create setlist/)?.click()
      await waitUntil(() => visited.length === 1, 'the page to go to the setlist')
      expect((await db.getAllSongs()).map(song => song.title)).to.include('Shared Only Song')
    })
  })

  describe('updating the setlist of that date', () => {
    async function withSetlist() {
      await createSong(chart('Alpha Song', '111'), {})
      await createSong(chart('Bravo Song', '222', 'D'), {})
      const alpha = must((await db.getAllSongs()).find(song => song.title === 'Alpha Song'))
      const bravo = must((await db.getAllSongs()).find(song => song.title === 'Bravo Song'))
      await db.saveSetlist(
        makeSetlist({
          id: 'have',
          date: '2099-10-25',
          name: 'Mine',
          owner: 'Leader One',
          ownerId: 'one@example.com',
          songs: [
            makeEntry({ order: 0, songId: bravo.id, songUuid: bravo.uuid, key: 'D' }),
            makeEntry({ order: 1, songId: alpha.id, songUuid: alpha.uuid, key: 'G' }),
          ],
        })
      )
      await review(
        email({
          songs: [makeImportedSong('Alpha Song', { ccli: '111', key: 'A' })],
        })
      )
    }

    it('is offered, and chosen when it is the leader’s', async () => {
      await withSetlist()
      expect(text()).to.contain('You already have a setlist for')
      expect(importer._target).to.equal('have')
      expect(text()).to.contain('Changes to Mine')
      expect(text()).to.contain('key G → A')
      expect(button(/Update setlist/)).to.not.equal(undefined)
      expect(text()).to.contain('Its date, name, time and leader are left as they are.')
    })

    it('lets a song the email lacks be kept, or not', async () => {
      await withSetlist()
      expect(text()).to.contain('Keep Bravo Song')
      await change($('.changes input[type="checkbox"]'), el => {
        el.checked = true
      })
      expect(importer._keepIds.size).to.equal(1)
      await change($('.changes input[type="checkbox"]'), el => {
        el.checked = false
      })
      expect(importer._keepIds.size).to.equal(0)
    })

    it('says when nothing changes', async () => {
      await createSong(chart('Alpha Song', '111'), {})
      const alpha = must((await db.getAllSongs())[0])
      await db.saveSetlist(
        makeSetlist({
          id: 'same',
          date: '2099-10-25',
          owner: 'Leader One',
          ownerId: 'one@example.com',
          songs: [makeEntry({ order: 0, songId: alpha.id, songUuid: alpha.uuid, key: 'G' })],
        })
      )
      await review(email({ songs: [makeImportedSong('Alpha Song', { ccli: '111', key: 'G' })] }))
      expect(text()).to.contain('nothing changes')
    })

    it('is changed, in the email’s order', async () => {
      await withSetlist()
      await change($('.changes input[type="checkbox"]'), el => {
        el.checked = true
      })
      button(/Update setlist/)?.click()
      await waitUntil(() => visited.length === 1, 'the page to go to the setlist')
      expect(visited[0]).to.equal('/setlist/have')
      const updated = must(await db.getSetlist('have'))
      expect(updated.name).to.equal('Mine')
      expect(updated.songs).to.have.length(2)
      expect(updated.songs[0].key).to.equal('A')
    })

    it('can be turned down for a new setlist, whose details are then asked for', async () => {
      await withSetlist()
      const details = () => must($('setlist-details-form')?.parentElement)
      expect(details().hidden, 'no details to give while updating').to.equal(true)
      await change($$('input[name="target"]').at(-1), el => {
        el.checked = true
      })
      expect(importer._target).to.equal('new')
      expect(importer._updating()).to.equal(undefined)
      expect(details().hidden).to.equal(false)
      expect(button(/Create setlist/)).to.not.equal(undefined)
      await change($$('input[name="target"]')[0], el => {
        el.checked = true
      })
      expect(importer._target).to.equal('have')
    })

    it('points out a setlist of that date that is not the leader’s, and makes a new one until told', async () => {
      await db.saveSetlist(
        makeSetlist({
          id: 'theirs',
          date: '2099-10-25',
          owner: 'Someone Else',
          ownerId: 'else@example.com',
        })
      )
      await review(email())
      expect(text()).to.contain('You already have a setlist for')
      expect($('fieldset a')?.getAttribute('href')).to.equal('/setlist/theirs')
      expect(importer._target).to.equal('new')
    })

    it('is not chosen when two setlists of that date are the leader’s', async () => {
      await db.saveSetlist(
        makeSetlist({ id: 'one', date: '2099-10-25', ownerId: 'one@example.com' })
      )
      await db.saveSetlist(
        makeSetlist({ id: 'two', date: '2099-10-25', ownerId: 'one@example.com' })
      )
      await review(email())
      expect(importer._target).to.equal('new')
      expect(text()).to.contain('You already have setlists for')
    })
  })

  describe('being cancelled', () => {
    it('goes back to the import page', async () => {
      await review(email())
      button(/Cancel/)?.click()
      expect(visited).to.deep.equal(['/import-song'])
    })
  })

  describe('what is made up for', () => {
    it('is the signed-in user as leader when the email has none, and as who made the setlist', async () => {
      const auth = installFakeAuthWorker(new FakeAuthWorker())
      auth.worker.stored = {
        blob: 'blob',
        metadata: {
          user: {
            name: 'Ann Smith',
            email: 'ann@example.com',
            picture: null,
            given_name: null,
            family_name: null,
            sub: 's',
          },
        },
        updated_at: 'now',
      }
      try {
        await createSong(chart('Alpha Song', '111'), {})
        await review(
          email({
            name: '',
            leader: { name: '', email: '' },
            songs: [makeImportedSong('Alpha Song', { ccli: '111' })],
          })
        )
        expect(importer._setlist.owner).to.equal('Ann Smith')
        expect(importer._setlist.ownerId).to.equal('ann@example.com')
        expect(text()).to.contain('Setlist from an email')
        button(/Create setlist/)?.click()
        await waitUntil(() => visited.length === 1, 'the page to go to the setlist')
        expect((await db.getAllSetlists())[0].createdBy).to.equal('ann@example.com')
      } finally {
        auth.uninstall()
      }
    })

    it('is no leader when the email has none and nobody is signed in', async () => {
      await review(email({ leader: { name: '', email: '' } }))
      expect(importer._setlist.owner).to.equal('')
      expect(importer._setlist.ownerId).to.equal('')
    })

    it('is the song’s own title, shown when the library calls it something else', async () => {
      await createSong(chart('Alpha Song (Live)', '111'), {})
      await review(email({ songs: [makeImportedSong('Alpha Song', { ccli: '111' })] }))
      expect(text()).to.contain('✓ In your library: Alpha Song (Live)')
    })

    it('keeps the person’s pick, even of none, when the library is looked at again', async () => {
      await createSong(chart('Amazing Grace'), {})
      await review(email({ songs: [makeImportedSong('Amazing Grace Medley')] }))
      importer._change(importer._rows[0], { pick: 'new' })
      await importer._refresh()
      expect(importer._rows[0].pick).to.equal('new')
      const [candidate] =
        importer._rows[0].match.kind === 'possible' ? importer._rows[0].match.candidates : []
      importer._change(importer._rows[0], { pick: candidate.uuid })
      await importer._refresh()
      expect(importer._rows[0].pick).to.equal(candidate.uuid)
    })

    it('picks the best candidate when the one wanted is no longer there, and falls back to it', async () => {
      await createSong(chart('Amazing Grace'), {})
      await review(email({ songs: [makeImportedSong('Amazing Grace Medley')] }))
      const match = importer._rows[0].match
      expect(importer._pickFor(match, 'gone')).to.equal(
        match.kind === 'possible' ? match.candidates[0].uuid : ''
      )
      importer._rows[0].pick = 'gone'
      expect(importer._reviewed(importer._rows[0]).library.title).to.equal('Amazing Grace')
    })

    it('names a setlist of that date by its type when it has no name, and its leader if it has one', async () => {
      await db.saveSetlist(
        makeSetlist({
          id: 'plain',
          date: '2099-10-25',
          name: '',
          type: 'Church Service',
          owner: '',
          ownerId: '',
        })
      )
      await review(email())
      expect(text()).to.contain('Update Church Service')
      expect(text()).to.not.contain('()')
    })

    it('says the songs will be in the email’s order when that is not the setlist’s', async () => {
      await createSong(chart('Alpha Song', '111'), {})
      await createSong(chart('Bravo Song', '222', 'D'), {})
      const alpha = must((await db.getAllSongs()).find(song => song.title === 'Alpha Song'))
      const bravo = must((await db.getAllSongs()).find(song => song.title === 'Bravo Song'))
      await db.saveSetlist(
        makeSetlist({
          id: 'order',
          date: '2099-10-25',
          owner: 'Leader One',
          ownerId: 'one@example.com',
          songs: [
            makeEntry({ order: 0, songId: bravo.id, songUuid: bravo.uuid, key: 'D' }),
            makeEntry({ order: 1, songId: alpha.id, songUuid: alpha.uuid, key: 'G' }),
          ],
        })
      )
      await review(
        email({
          songs: [
            makeImportedSong('Alpha Song', { ccli: '111' }),
            makeImportedSong('Bravo Song', { ccli: '222' }),
          ],
        })
      )
      expect(text()).to.contain('The songs are in the email’s order')
    })
  })
})
