import { expect, fixture, html } from '@open-wc/testing'
import '../src/components/space-tabs.ts'
import type { SpaceTabs } from '../src/components/space-tabs.ts'
import { ChordlessDB } from '../src/js/db.ts'
import { SHARED_DB_ID } from '../src/js/share-receiver.ts'
import { addChart } from '../src/js/song-utils.ts'
import {
  createSpace,
  deleteSpace,
  getCurrentSpace,
  listSpaces,
  setCurrentSpace,
  switchSpace,
} from '../src/js/space.ts'
import {
  loadSpaceTabs,
  MAX_TABS,
  noteTabUsed,
  type SpaceTab,
  splitTabs,
  visibleSpaces,
} from '../src/js/space-tabs.ts'
import { whatWouldBeAdded } from '../src/js/space-transfer.ts'
import { must } from './must.ts'
import { deleteDatabase, suppressConsoleLogs } from './test-helpers.ts'

const { describe, it, beforeEach, afterEach } = window

suppressConsoleLogs()

const tab = (id: string, kind: string | null = null): SpaceTab => ({ id, name: id, kind })

describe('splitTabs', () => {
  it('shows every tab when they fit', () => {
    const tabs = ['a', 'b', 'c'].map(id => tab(id))
    expect(splitTabs(tabs, 'a', []).more).to.deep.equal([])
  })

  it('keeps the current and the most recently used as tabs, in the fixed order, and the rest under More', () => {
    const tabs = ['a', 'b', 'c', 'd', 'e', 'f'].map(id => tab(id))
    const { shown, more } = splitTabs(tabs, 'f', ['e', 'd', 'c', 'b'])
    expect(shown.map(each => each.id)).to.deep.equal(['c', 'd', 'e', 'f'])
    expect(more.map(each => each.id)).to.deep.equal(['a', 'b'])
    expect(shown.length).to.equal(MAX_TABS)
  })
})

describe('the tabs of the spaces on this device', () => {
  const made: string[] = []
  let before: { id: string | null; name: string }

  /** Only the spaces this test made: other test files make spaces on the same device */
  const mine = async () => (await listSpaces()).filter(each => made.includes(each.id))

  async function space(name: string, songs = 0): Promise<string> {
    const created = await createSpace(`${name} ${crypto.randomUUID().slice(0, 8)}`)
    made.push(created.id)
    if (songs) {
      const db = new ChordlessDB(created.id)
      await db.init()
      await addChart(db, `{title: ${name}}\n{key: G}\n[G]${name} line`, {
        variantLabel: 'Test',
        importSource: 'test',
        makeDefault: 'first',
      })
      db.db?.close()
    }
    return created.id
  }

  beforeEach(async () => {
    before = getCurrentSpace()
  })

  afterEach(async () => {
    for (const id of made.splice(0)) await deleteSpace(id).catch(() => {})
    await deleteDatabase(SHARED_DB_ID)
    if (before.id) await setCurrentSpace(before.id, before.name)
  })

  it('has none for one place', async () => {
    const only = await space('Only', 1)
    expect(await loadSpaceTabs(only, await mine())).to.deep.equal([])
  })

  it('leaves out a Personal space with nothing in it, unless it is the current one', async () => {
    const empty = await space('Empty')
    const full = await space('Full', 1)
    expect(await loadSpaceTabs(full, await mine())).to.deep.equal([])
    const tabs = await loadSpaceTabs(empty, await mine())
    expect(tabs.map(each => each.id).sort()).to.deep.equal([empty, full].sort())
  })

  it('puts Teams before Personal, labelled, and Shared last, once something was shared', async () => {
    const personal = await space('Mine', 1)
    const team = await space('Team', 1)
    const { updateSpace } = await import('../src/js/space.ts')
    await updateSpace(team, { team: { id: 'space-bbbb2222', role: 'writer' } })
    const shared = new ChordlessDB(SHARED_DB_ID)
    await shared.init()
    await addChart(shared, '{title: Gift}\n{key: G}\n[G]Gift line', {
      variantLabel: 'Shared',
      importSource: 'test',
      makeDefault: 'first',
    })
    shared.db?.close()

    const tabs = await loadSpaceTabs(personal, await mine())
    expect(tabs.map(each => each.id)).to.deep.equal([team, personal, SHARED_DB_ID])
    expect(tabs[0].kind).to.equal('Team')
    expect(tabs[1].kind).to.equal('Personal')
    expect(tabs[2].kind).to.equal(null)
  })

  it('draws a tablist of them, marks the current one, and switches when one is chosen', async () => {
    const first = await space('First', 1)
    const second = await space('Second', 1)
    await setCurrentSpace(first)
    const switched: string[] = []
    const tabs = await fixture<SpaceTabs>(html`<space-tabs
      .spaces=${await mine()}
      .switchTo=${async (id: string) => {
        switched.push(id)
      }}
    ></space-tabs>`)
    for (let i = 0; i < 50 && !tabs.shadowRoot?.querySelector('[role=tab]'); i++)
      await new Promise(resolve => setTimeout(resolve, 20))
    const found = [...(tabs.shadowRoot?.querySelectorAll<HTMLElement>('[role=tab]') ?? [])]
    expect(found.length).to.equal(2)
    expect(must(tabs.shadowRoot?.querySelector('[role=tablist]'))).to.exist
    expect(
      found.find(each => each.dataset.space === first)?.getAttribute('aria-selected')
    ).to.equal('true')

    found.find(each => each.dataset.space === first)?.click()
    expect(switched).to.deep.equal([])
    found.find(each => each.dataset.space === second)?.click()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(switched).to.deep.equal([second])
  })

  it('offers imports only the spaces that have a tab, unless that leaves none', async () => {
    const empty = await space('Empty')
    const full = await space('Full', 1)
    const offered = (await visibleSpaces(full, await mine())).map(each => each.id)
    expect(offered).to.include(full)
    expect(offered).to.not.include(empty)
    // (with none to show, all are offered: a space hidden is not offered unless it is the only one)
    const lonely = (await mine()).filter(each => each.id === empty)
    expect((await visibleSpaces(null, lonely)).map(each => each.id)).to.deep.equal([empty])
  })

  it('keeps the tabs in their order when the recent list cannot be read or kept', async () => {
    localStorage.setItem('space-tabs-recent', '{not json')
    const tabs = ['a', 'b', 'c', 'd', 'e'].map(id => tab(id))
    expect(splitTabs(tabs, 'a').shown.map(each => each.id)).to.deep.equal(['a', 'b', 'c', 'd'])
    localStorage.setItem('space-tabs-recent', '{"a":1}')
    expect(splitTabs(tabs, 'e').shown.map(each => each.id)).to.deep.equal(['a', 'b', 'c', 'e'])
    localStorage.removeItem('space-tabs-recent')

    const real = Storage.prototype.setItem
    Storage.prototype.setItem = () => {
      throw new Error('blocked')
    }
    try {
      noteTabUsed('a')
    } finally {
      Storage.prototype.setItem = real
    }
  })

  it('puts the tabs that do not fit under More, and moves between tabs with the arrow keys', async () => {
    const ids: string[] = []
    for (const name of ['One', 'Two', 'Three', 'Four', 'Five']) ids.push(await space(name, 1))
    await setCurrentSpace(ids[0])
    const opened: string[] = []
    let sharedOpened = 0
    const element = await fixture<SpaceTabs>(html`<space-tabs
      .spaces=${await mine()}
      .switchTo=${async (id: string) => {
        opened.push(id)
      }}
      .openShared=${() => {
        sharedOpened++
      }}
    ></space-tabs>`)
    const root = must(element.shadowRoot)
    for (let i = 0; i < 50 && !root.querySelector('select'); i++)
      await new Promise(resolve => setTimeout(resolve, 20))
    const tabs = [...root.querySelectorAll<HTMLElement>('[role=tab]')]
    expect(tabs.length).to.equal(MAX_TABS)

    tabs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    expect(root.activeElement).to.equal(tabs[1])
    tabs[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
    expect(root.activeElement).to.equal(tabs[0])
    tabs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }))
    root
      .querySelector('[role=tablist]')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))

    const more = must(root.querySelector('select'))
    expect(more.options.length).to.equal(2)
    more.value = more.options[1].value
    more.dispatchEvent(new Event('change'))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(opened).to.deep.equal([more.options[1].value])
    more.value = 'nothing-like-this'
    more.dispatchEvent(new Event('change'))

    element._tabs = [...element._tabs, { id: SHARED_DB_ID, name: 'Shared', kind: null }]
    await element.updateComplete
    await element._open({ id: SHARED_DB_ID, name: 'Shared', kind: null })
    expect(sharedOpened).to.equal(1)
  })

  it('draws no tabs, and does not fail, when the spaces cannot be read', async () => {
    const broken = [] as unknown as Parameters<typeof loadSpaceTabs>[1]
    Object.defineProperty(broken, 'filter', {
      get() {
        throw new Error('no database')
      },
    })
    const element = await fixture<SpaceTabs>(html`<space-tabs .spaces=${broken}></space-tabs>`)
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(element.shadowRoot?.querySelector('[role=tablist]')).to.equal(null)
  })

  it('draws nothing for one place', async () => {
    const only = await space('Solo', 1)
    await setCurrentSpace(only)
    const tabs = await fixture<SpaceTabs>(html`<space-tabs .spaces=${await mine()}></space-tabs>`)
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(tabs.shadowRoot?.querySelector('[role=tablist]')).to.equal(null)
  })

  it('counts only what bringing one space into another would add', async () => {
    const source = await space('Source', 1)
    const same = await space('Same', 0)
    const sdb = new ChordlessDB(source)
    await sdb.init()
    const ddb = new ChordlessDB(same)
    await ddb.init()
    expect(await whatWouldBeAdded(sdb, ddb)).to.deep.equal({ songs: 1, setlists: 0 })
    const chart = must(await sdb.getAllSongs())[0]
    const content = must(await sdb.getChordPro(chart.chordproFileId)).content
    await addChart(ddb, content, {
      variantLabel: 'Test',
      importSource: 'test',
      makeDefault: 'first',
    })
    expect(await whatWouldBeAdded(sdb, ddb)).to.deep.equal({ songs: 0, setlists: 0 })
    sdb.db?.close()
    ddb.db?.close()
    void switchSpace
  })
})
