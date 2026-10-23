import { expect, fixture, html } from '@open-wc/testing'
import { type SongVersions, SongVersionsChangedEvent } from '../src/components/song-versions.ts'
import '../src/components/song-versions.ts'
import type { SongRecord } from '../src/js/data-types.ts'
import { ChordlessDB } from '../src/js/db.ts'
import { hashText } from '../src/js/song-utils.ts'
import { makeEntry, makeSetlist, makeSong } from './builders.ts'
import { must } from './must.ts'
import {
  A11Y,
  clearToasts,
  deleteDatabase,
  shownToast,
  suppressConsoleLogs,
} from './test-helpers.ts'

const { describe, it, beforeEach, afterEach } = window

suppressConsoleLogs()

describe('song-versions', () => {
  let db: ChordlessDB
  let dbName: string

  beforeEach(async () => {
    dbName = `versions-view-${crypto.randomUUID()}`
    db = new ChordlessDB(dbName)
    await db.init()
  })

  afterEach(async () => {
    clearToasts()
    must(db.db).close()
    await deleteDatabase(dbName)
  })

  const add = (uuid: string, overrides: Partial<SongRecord> = {}) =>
    db.saveSong({
      ...makeSong({
        uuid,
        id: 'ccli-1',
        ccliNumber: '1',
        title: 'Amazing',
        titleNormalized: 'amazing',
        variantLabel: 'Original',
        importDate: '2026-01-01',
        importUser: 'Jo',
        key: 'G',
        ...overrides,
      }),
    })

  async function show(songId = 'ccli-1') {
    const el = await fixture<SongVersions>(
      html`<song-versions .songId=${songId} .db=${db}></song-versions>`
    )
    await settled(el)
    return el
  }
  /** Wait for the component's database reads, and its render */
  async function settled(el: SongVersions) {
    for (let n = 0; n < 50; n++) {
      await new Promise(resolve => setTimeout(resolve, 10))
      await el.updateComplete
      if (el._variants.length || n > 10) break
    }
  }
  const $ = (el: SongVersions, selector: string) =>
    el.shadowRoot?.querySelector(selector) as HTMLElement | null
  const all = (el: SongVersions, selector: string) =>
    [...(el.shadowRoot?.querySelectorAll(selector) ?? [])] as HTMLElement[]
  const text = (node: Element | null | undefined) => node?.textContent?.replace(/\s+/g, ' ').trim()
  const changed = (el: SongVersions) =>
    new Promise<void>(resolve =>
      el.addEventListener(SongVersionsChangedEvent.type, () => resolve(), { once: true })
    )

  it('shows nothing for a song that is not there', async () => {
    const el = await show('nothing')
    expect($(el, 'section')).to.equal(null)
  })

  it('lists the variants, the default first, with who imported them, and is accessible', async () => {
    await add('default', { importSource: 'songselect' })
    await add('variant', {
      isDefault: false,
      variantOf: 'default',
      variantLabel: 'Capo 3',
      key: null,
      importUser: null,
    })
    const el = await show()
    const items = all(el, 'li')
    expect(items.map(item => text(item.querySelector('.label')))).to.deep.equal([
      'Original',
      'Capo 3',
    ])
    expect(text(items[0].querySelector('.default'))).to.equal('Default')
    expect(text(items[0].querySelector('.origin'))).to.contain('Imported by Jo')
    expect(text(items[0].querySelector('.origin'))).to.contain('SongSelect')
    expect(text(items[0].querySelector('.origin'))).to.contain('key G')
    expect(text(items[1].querySelector('.origin'))).to.contain('Importer unknown')
    expect(items[1].querySelector('.default')).to.equal(null)
    await expect(el).to.be.accessible(A11Y)
  })

  it('makes a variant the default, and tells the page', async () => {
    await add('default')
    await add('variant', { isDefault: false, variantOf: 'default', variantLabel: 'Capo 3' })
    const el = await show()
    const done = changed(el)
    all(el, 'li')[1].querySelector<HTMLElement>('.make-default')?.click()
    await done
    await el.updateComplete
    expect(must(await db.getSong('variant')).isDefault).to.equal(true)
    expect(text(all(el, 'li')[0].querySelector('.label'))).to.equal('Capo 3')
    expect(all(el, '.make-default')).to.have.length(1)
  })

  it('renames a variant in place, or leaves it as it was on cancel', async () => {
    await add('only')
    const el = await show()
    $(el, '.rename')?.click()
    await el.updateComplete
    const input = $(el, 'input[name=name]') as HTMLInputElement
    expect(input.value).to.equal('Original')
    ;($(el, 'form button[type=button]') as HTMLElement).click()
    await el.updateComplete
    expect($(el, 'input[name=name]')).to.equal(null)

    $(el, '.rename')?.click()
    await el.updateComplete
    const typed = $(el, 'input[name=name]') as HTMLInputElement
    typed.value = 'Simon, capo 3'
    const done = changed(el)
    $(el, 'form')?.dispatchEvent(new Event('submit', { cancelable: true }))
    await done
    expect(must(await db.getSong('only')).variantLabel).to.equal('Simon, capo 3')
  })

  it('deletes a variant only after a second tap, offering to cancel, calling it Delete song when it is the only one', async () => {
    await add('default')
    const only = await show()
    expect(text(only.shadowRoot?.querySelector('.delete'))).to.equal('Delete song')

    await add('variant', { isDefault: false, variantOf: 'default' })
    const setlist = makeSetlist({ songs: [makeEntry({ songUuid: 'variant', songId: 'ccli-1' })] })
    await db.saveSetlist(setlist)
    const el = await show()
    all(el, 'li')[1].querySelector<HTMLElement>('.delete')?.click()
    await new Promise(resolve => setTimeout(resolve, 30))
    await el.updateComplete
    expect(text($(el, '.confirm'))).to.contain('will use the default')
    ;($(el, '.confirm .btn:not(.primary)') as HTMLElement).click()
    await el.updateComplete
    expect($(el, '.confirm')).to.equal(null)
    expect(await db.getSong('variant')).to.not.equal(undefined)

    all(el, 'li')[1].querySelector<HTMLElement>('.delete')?.click()
    await new Promise(resolve => setTimeout(resolve, 30))
    await el.updateComplete
    const done = changed(el)
    $(el, '.confirm-delete')?.click()
    await done
    expect(await db.getSong('variant')).to.equal(undefined)
    expect(must(await db.getSetlist(setlist.id)).songs[0].songUuid).to.equal('default')
  })

  it('says what a deleted default is replaced by', async () => {
    await add('default')
    await add('variant', { isDefault: false, variantOf: 'default' })
    const el = await show()
    all(el, 'li')[0].querySelector<HTMLElement>('.delete')?.click()
    await new Promise(resolve => setTimeout(resolve, 30))
    await el.updateComplete
    expect(text($(el, '.confirm'))).to.contain('the next version')
  })

  it('merges another song in as a variant, with the name typed', async () => {
    await add('official')
    await add('hand', {
      id: 'title-amazing',
      ccliNumber: null,
      title: 'amazing',
      variantLabel: 'Original',
    })
    await add('unrelated', {
      id: 'title-other',
      ccliNumber: null,
      title: 'Other',
      titleNormalized: 'other',
      variantLabel: 'Kings',
    })
    const el = await show()
    expect(all(el, 'select option').map(text)).to.deep.equal([
      'Choose a song',
      'amazing',
      'Other — Kings',
    ])
    expect(($(el, '.merge-button') as HTMLButtonElement).disabled).to.equal(true)
    const select = $(el, 'select') as HTMLSelectElement
    select.value = 'title-amazing'
    select.dispatchEvent(new Event('change'))
    await el.updateComplete
    ;($(el, 'input[name=label]') as HTMLInputElement).value = 'Simon'
    const done = changed(el)
    $(el, '.merge')?.dispatchEvent(new Event('submit', { cancelable: true }))
    await done
    await el.updateComplete
    expect(must(await db.getSong('hand')).variantOf).to.equal('official')
    expect(must(await db.getSong('hand')).variantLabel).to.equal('Simon')
    expect(all(el, 'li')).to.have.length(2)
  })

  it('has no merge when there is no other song, and offers a CCLI number to tell songs apart', async () => {
    await add('official')
    const el = await show()
    expect($(el, 'details')).to.equal(null)
    await add('other', { id: 'ccli-2', ccliNumber: '2', title: 'Other', titleNormalized: 'other' })
    await el._load()
    await el.updateComplete
    expect(all(el, 'select option').map(text)).to.include('Other (2)')
  })

  it('shows a toast, and changes nothing, when a change fails', async () => {
    await add('default')
    await add('variant', { isDefault: false, variantOf: 'default' })
    const el = await show()
    const real = db.saveSong.bind(db)
    db.saveSong = async () => {
      throw new Error('disk full')
    }
    try {
      all(el, 'li')[1].querySelector<HTMLElement>('.make-default')?.click()
      await new Promise(resolve => setTimeout(resolve, 50))
    } finally {
      db.saveSong = real
    }
    expect(shownToast()?.message).to.contain("Couldn't make it the default")
    expect(must(await db.getSong('variant')).isDefault).to.equal(false)
  })

  it('uses the current space when no database is given', async () => {
    const el = await fixture<SongVersions>(
      html`<song-versions .songId=${'nothing-here'}></song-versions>`
    )
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(el._variants).to.deep.equal([])
  })

  it('offers a song with several variants once, by its default', async () => {
    await add('official')
    const other = { id: 'title-other', ccliNumber: null, title: 'Other', titleNormalized: 'other' }
    await add('a1', { ...other, isDefault: false, variantLabel: 'First' })
    await add('a2', { ...other, isDefault: false, variantLabel: 'Second' })
    await add('z', { ...other, isDefault: true, variantLabel: 'Original' })
    const el = await show()
    expect(all(el, 'select option').map(text)).to.deep.equal(['Choose a song', 'Other'])
  })

  it('calls a variant with no name "Original", and starts its rename empty', async () => {
    await add('unnamed', { variantLabel: '' })
    const el = await show()
    expect(text($(el, '.label'))).to.equal('Original')
    $(el, '.rename')?.click()
    await el.updateComplete
    expect(($(el, 'input[name=name]') as HTMLInputElement).value).to.equal('')
  })

  describe('merging with the details one is missing', () => {
    async function addWithChart(uuid: string, text: string, overrides: Partial<SongRecord> = {}) {
      await db.saveChordPro({
        id: `chordpro-${uuid}`,
        content: text,
        contentHash: hashText(text),
        lastModified: 1,
      })
      await add(uuid, { chordproFileId: `chordpro-${uuid}`, ...overrides })
    }
    const textOf = async (uuid: string) =>
      must(await db.getChordPro(must(await db.getSong(uuid)).chordproFileId)).content

    async function merge(fill: boolean) {
      await addWithChart('official', '{title: Amazing}\n{artist: Keith Getty}\n[G]x')
      await addWithChart('hand', '{title: Amazing}\n[G]x', {
        id: 'title-amazing',
        ccliNumber: null,
        title: 'amazing',
      })
      const el = await show()
      const select = $(el, 'select') as HTMLSelectElement
      select.value = 'title-amazing'
      select.dispatchEvent(new Event('change'))
      await el.updateComplete
      const box = $(el, 'input[name=fill]') as HTMLInputElement
      expect(box.checked).to.equal(true)
      box.checked = fill
      const done = changed(el)
      $(el, '.merge')?.dispatchEvent(new Event('submit', { cancelable: true }))
      await done
    }

    it('fills them in, as it offers to by default', async () => {
      await merge(true)
      expect(await textOf('hand')).to.contain('{artist: Keith Getty}')
    })

    it('leaves the charts as they are when that is unticked', async () => {
      await merge(false)
      expect(await textOf('hand')).to.not.contain('artist')
    })
  })

  describe('deleting the only version, which is the song', () => {
    const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
    const entry = () => makeEntry({ songUuid: 'only', songId: 'ccli-1' })

    it('says how many setlists have it, and on confirming deletes it and says the song is gone', async () => {
      await add('only')
      await db.saveSetlist(makeSetlist({ id: 'one', songs: [entry()] }))
      await db.saveSetlist(makeSetlist({ id: 'two', songs: [entry()] }))
      const el = await show()
      $(el, '.delete')?.click()
      await wait(30)
      await el.updateComplete
      expect(text($(el, '.confirm'))).to.contain('Delete this song? It is in 2 setlists')
      let deleted: boolean | null = null
      el.addEventListener(
        SongVersionsChangedEvent.type,
        event => {
          deleted = (event as SongVersionsChangedEvent).songDeleted
        },
        { once: true }
      )
      $(el, '.confirm-delete')?.click()
      for (let n = 0; n < 50 && deleted === null; n++) await wait(10)
      expect(deleted).to.equal(true)
      expect(await db.getSong('only')).to.equal(undefined)
      expect(must(await db.getSetlist('one')).songs).to.deep.equal([])
      expect($(el, 'section')).to.equal(null)
    })

    it('does not mention setlists when none has it, and says "it" for one', async () => {
      await add('only')
      const el = await show()
      $(el, '.delete')?.click()
      await wait(30)
      await el.updateComplete
      expect(text($(el, '.confirm'))).to.not.contain('setlist')
      ;($(el, '.confirm .btn:not(.primary)') as HTMLElement).click()
      await el.updateComplete

      await db.saveSetlist(makeSetlist({ id: 'one', songs: [entry()] }))
      $(el, '.delete')?.click()
      await wait(30)
      await el.updateComplete
      expect(text($(el, '.confirm'))).to.contain(
        'It is in 1 setlist and will be taken out of it, so it will no longer count as played there'
      )
    })

    it('says so, and keeps the song, when it cannot be deleted', async () => {
      await add('only')
      const el = await show()
      $(el, '.delete')?.click()
      await wait(30)
      await el.updateComplete
      const real = db.deleteSong.bind(db)
      db.deleteSong = async () => {
        throw new Error('disk full')
      }
      try {
        $(el, '.confirm-delete')?.click()
        await wait(50)
      } finally {
        db.deleteSong = real
      }
      expect(shownToast()?.message).to.contain("Couldn't delete the song")
      expect(await db.getSong('only')).to.not.equal(undefined)
    })
  })
})
