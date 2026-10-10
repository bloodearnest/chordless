/**
 * A view comes and goes with the route, so it must leave nothing behind: not a
 * listener on window or document, not a class on <body>, not the setlist's songs
 * in the shell's menu. Each view is mounted and unmounted a few times, and the
 * app must look as it did before.
 */
import { expect } from '@open-wc/testing'
import '../src/components/nav-menu.js'
import { getCurrentDB } from '../src/js/db.js'
import { setRouter } from '../src/js/navigation.ts'
import '../src/js/views/bookmarklet-view.js'
import '../src/js/views/home-view.js'
import '../src/js/views/import-song-view.js'
import '../src/js/views/library-view.js'
import '../src/js/views/not-found-view.js'
import '../src/js/views/preferences-view.js'
import '../src/js/views/setlist-view.js'
import '../src/js/views/storage-view.js'
import { suppressConsoleLogs } from './test-helpers.js'

const { describe, it, before, after, beforeEach, afterEach } = window

const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

/** Wait until a view has loaded what it shows, and run the setup it defers a frame */
async function loaded(view) {
  await view.updateComplete
  const ready = {
    'home-view': () => view.querySelector('setlist-group, status-message:not([state="loading"])'),
    'library-view': () =>
      view.querySelector('song-list, status-message:not([state="loading"])') &&
      (!view.route.songUuid || view.querySelector('.song-content')),
    'setlist-view': () => view.querySelector('setlist-overview'),
  }[view.localName]
  for (let i = 0; ready && i < 100 && !ready(); i++) await wait(20)
  await wait(100)
}

/**
 * Track the listeners added to some targets, net of those removed (or whose abort
 * signal fired). A listener added with `once` is not tracked.
 */
function trackListeners(targets) {
  const proto = EventTarget.prototype
  const originalAdd = proto.addEventListener
  const originalRemove = proto.removeEventListener
  const entries = []
  const capture = options => (typeof options === 'boolean' ? options : Boolean(options?.capture))
  const same = (entry, target, type, listener, useCapture) =>
    entry.target === target &&
    entry.type === type &&
    entry.listener === listener &&
    entry.capture === useCapture
  const drop = entry => {
    const index = entries.indexOf(entry)
    if (index >= 0) entries.splice(index, 1)
  }

  proto.addEventListener = function (type, listener, options) {
    if (targets.has(this) && !options?.once) {
      const useCapture = capture(options)
      if (!entries.some(entry => same(entry, this, type, listener, useCapture))) {
        const entry = { target: this, type, listener, capture: useCapture }
        entries.push(entry)
        options?.signal?.addEventListener('abort', () => drop(entry), { once: true })
      }
    }
    return originalAdd.call(this, type, listener, options)
  }
  proto.removeEventListener = function (type, listener, options) {
    if (targets.has(this)) {
      const useCapture = capture(options)
      const entry = entries.find(candidate => same(candidate, this, type, listener, useCapture))
      if (entry) drop(entry)
    }
    return originalRemove.call(this, type, listener, options)
  }

  return {
    /** What is listening, as sorted "target type" lines */
    snapshot: () => entries.map(entry => `${targets.get(entry.target)} ${entry.type}`).sort(),
    stop() {
      proto.addEventListener = originalAdd
      proto.removeEventListener = originalRemove
    },
  }
}

describe('views leave nothing behind', () => {
  let outlet
  let menu
  let tracker
  let seeded

  /** The state of the page outside the view */
  const pageState = () => ({
    listeners: tracker.snapshot(),
    bodyClass: document.body.className,
    bodyEditMode: document.body.getAttribute('data-edit-mode'),
    bodyUserSelect: document.body.style.userSelect,
    headerExpanded: document.documentElement.style.getPropertyValue('--header-expanded'),
    menuSongs: menu.songs?.length ?? 0,
    menuOverviewLink: menu.showOverviewLink,
    menuTitle: menu.setlistTitle,
    outletChildren: outlet.children.length,
  })

  /** Mount a view and let it load, then unmount it, a few times over */
  async function mountAndUnmount(tag, route, times = 3) {
    for (let i = 0; i < times; i++) {
      const view = document.createElement(tag)
      view.route = route
      outlet.append(view)
      await loaded(view)
      view.remove()
      await wait(50)
    }
  }

  suppressConsoleLogs()

  before(async () => {
    // A song, and a setlist of it, for the views that show them
    const db = await getCurrentDB()
    const id = crypto.randomUUID()
    const songId = `title-teardown-${id}`
    await db.saveChordPro({
      id: `chordpro-${id}`,
      content: '{title: Teardown Song}\n{key: G}\n\n{comment: Verse 1}\n[G]Amazing [C]grace',
      contentHash: id,
      lastModified: Date.now(),
    })
    await db.saveSong({
      uuid: `song-${id}`,
      id: songId,
      title: 'Teardown Song',
      titleNormalized: 'teardownsong',
      isDefault: true,
      chordproFileId: `chordpro-${id}`,
      modifiedDate: new Date().toISOString(),
    })
    await db.saveSetlist({
      id: `setlist-${id}`,
      date: '2026-10-11',
      time: '10:30',
      type: 'Church Service',
      name: '',
      owner: 'Ann',
      songs: [{ songId, songUuid: `song-${id}`, key: 'A', order: 0 }],
      createdDate: new Date().toISOString(),
      modifiedDate: new Date().toISOString(),
    })
    seeded = { setlistId: `setlist-${id}`, songUuid: `song-${id}` }
  })

  after(async () => {
    const db = await getCurrentDB()
    await db.deleteSetlist?.(seeded.setlistId)
  })

  beforeEach(() => {
    // Without a router, goTo() would load a page: and so end the test run
    setRouter({ navigate: async () => true })
    outlet = document.createElement('div')
    menu = document.createElement('nav-menu')
    menu.id = 'nav-menu'
    document.body.append(outlet, menu)
    tracker = trackListeners(
      new Map([
        [window, 'window'],
        [document, 'document'],
        [document.body, 'body'],
        [document.documentElement, 'html'],
        [menu, 'nav-menu'],
      ])
    )
  })

  afterEach(() => {
    setRouter(null)
    tracker.stop()
    outlet.remove()
    menu.remove()
    document.body.classList.remove('edit-mode')
    document.body.removeAttribute('data-edit-mode')
  })

  const simple = [
    ['home-view', { name: 'home' }],
    ['storage-view', { name: 'storage' }],
    ['preferences-view', { name: 'preferences' }],
    ['import-song-view', { name: 'import-song' }],
    ['bookmarklet-view', { name: 'bookmarklet' }],
    ['not-found-view', { name: 'not-found', path: '/nope' }],
    ['library-view', { name: 'songs' }],
  ]
  for (const [tag, route] of simple) {
    it(`${tag}`, async function () {
      this.timeout(15000)
      await mountAndUnmount(tag, route, 1) // once to let modules and shared state settle
      const before = pageState()
      await mountAndUnmount(tag, route)
      expect(pageState()).to.deep.equal(before)
    })
  }

  it('library-view, with a song open', async function () {
    this.timeout(15000)
    const route = { name: 'songs', songUuid: seeded.songUuid }
    await mountAndUnmount('library-view', route, 1)
    const before = pageState()
    await mountAndUnmount('library-view', route)
    expect(pageState()).to.deep.equal(before)
  })

  it('library-view, left in edit mode', async function () {
    this.timeout(15000)
    const route = { name: 'songs', songUuid: seeded.songUuid }
    await mountAndUnmount('library-view', route, 1)
    const before = pageState()
    const view = document.createElement('library-view')
    view.route = route
    outlet.append(view)
    await loaded(view)
    view
      .querySelector('#library-app-header')
      .dispatchEvent(new CustomEvent('app-header:edit-mode-toggle'))
    expect(document.body.classList.contains('edit-mode')).to.equal(true)
    view.remove()
    await wait(50)
    expect(pageState()).to.deep.equal(before)
  })

  for (const [label, songIndex] of [
    ['its overview', -1],
    ['a song', 0],
  ]) {
    it(`setlist-view, on ${label}`, async function () {
      this.timeout(15000)
      const route = () => ({ name: 'setlist', setlistId: seeded.setlistId, songIndex })
      await mountAndUnmount('setlist-view', route(), 1)
      const before = pageState()
      await mountAndUnmount('setlist-view', route())
      expect(pageState()).to.deep.equal(before)
    })
  }

  it('setlist-view fills the menu with its songs, and empties it when left', async function () {
    this.timeout(15000)
    const view = document.createElement('setlist-view')
    view.route = { name: 'setlist', setlistId: seeded.setlistId, songIndex: -1 }
    outlet.append(view)
    await loaded(view)
    expect(menu.songs.length).to.equal(1)

    view.remove()
    await wait(50)
    expect(menu.songs.length).to.equal(0)
    expect(menu.showOverviewLink).to.equal(false)
  })
})
