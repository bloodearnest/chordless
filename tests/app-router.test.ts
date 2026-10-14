import { ContextConsumer } from '@lit/context'
import { expect } from '@open-wc/testing'
import { LitElement } from 'lit'
import { AppRouter, pageTitle, RouteChangeEvent } from '../src/js/app-router.ts'
import { routeContext } from '../src/js/route-context.ts'
import { must } from './must.ts'

const { describe, it, beforeEach, afterEach } = window

class RouteConsumer extends LitElement {
  consumer = new ContextConsumer(this, { context: routeContext, subscribe: true })
}
customElements.define('route-consumer', RouteConsumer)
declare global {
  interface HTMLElementTagNameMap {
    'route-consumer': RouteConsumer
  }
}

const startUrl = window.location.pathname + window.location.search

let captured = 0

/**
 * A view that records the routes the router gives it. Unless told otherwise it has
 * state to keep, each capture different, so a test can tell which one it gets back.
 */
function fakeView(name, { keepsState = true } = {}) {
  const view = document.createElement('div') as HTMLDivElement & {
    routes: unknown[]
    captureViewState?: () => unknown
  }
  view.dataset.view = name
  view.routes = []
  if (keepsState) view.captureViewState = () => ({ name, capture: ++captured })
  Object.defineProperty(view, 'route', {
    get: () => view.routes.at(-1),
    set: route => view.routes.push(route),
  })
  return view
}

/**
 * Forward entries left by an earlier test's history.back() make a push drop them, so the history
 * grows by less than one and a test of `history.length` fails now and then. Cut them off first.
 */
const atEndOfHistory = () => {
  const { navigation } = window as unknown as { navigation: { canGoForward: boolean } }
  if (navigation.canGoForward) window.history.pushState(null, '', window.location.href)
}

describe('AppRouter', () => {
  let outlet
  let router
  let views
  let loads

  const makeRouter = (extra = {}) => {
    router?.stop()
    router = new AppRouter({ outlet, views, transitions: false, storage: null, ...extra })
    return router
  }
  const routeChanged = () =>
    new Promise(resolve =>
      document.addEventListener(RouteChangeEvent.type, resolve, { once: true })
    )

  beforeEach(() => {
    outlet = document.createElement('div')
    document.body.append(outlet)
    loads = []
    views = {
      storage: {
        load: () => {
          loads.push('storage')
          return fakeView('storage')
        },
        title: () => 'Storage - Chordless',
      },
      songs: { load: () => fakeView('songs') },
      setlist: {
        load: route => {
          loads.push(`setlist:${route.setlistId}`)
          return fakeView('setlist')
        },
        title: route => `Setlist ${route.setlistId}`,
        sameView: (previous, next) => previous.setlistId === next.setlistId,
      },
    }
    window.history.replaceState(null, '', startUrl)
  })

  afterEach(() => {
    router?.stop()
    outlet.remove()
    window.history.replaceState(null, '', startUrl)
  })

  describe('start', () => {
    it('shows the view for the current URL', async () => {
      window.history.replaceState(null, '', '/storage')
      expect(await makeRouter().start()).to.equal(true)
      expect(outlet.querySelector('[data-view=storage]')).to.exist
      expect(router.route).to.deep.equal({ name: 'storage' })
      expect(document.title).to.equal('Storage - Chordless')
    })

    it('does nothing for a URL with no view', async () => {
      window.history.replaceState(null, '', '/bookmarklet')
      expect(await makeRouter().start()).to.equal(false)
      expect(outlet.children).to.have.length(0)
      expect(router.route).to.equal(null)
    })

    it('gives the view its route before attaching it', async () => {
      window.history.replaceState(null, '', '/setlist/abc/song/2')
      await makeRouter().start()
      expect(router.view.route).to.deep.equal({ name: 'setlist', setlistId: 'abc', songIndex: 2 })
    })
  })

  describe('navigate', () => {
    beforeEach(async () => {
      atEndOfHistory()
      window.history.replaceState(null, '', '/storage')
      await makeRouter().start()
    })

    it('shows the view, pushes the URL and sets the title', async () => {
      const before = window.history.length
      expect(await router.navigate('/setlist/abc')).to.equal(true)
      expect(window.location.pathname).to.equal('/setlist/abc')
      expect(window.history.length).to.equal(before + 1)
      expect(outlet.children).to.have.length(1)
      expect(outlet.firstElementChild.dataset.view).to.equal('setlist')
      expect(document.title).to.equal('Setlist abc')
    })

    it('returns false, and changes nothing, for a route with no view', async () => {
      const before = window.history.length
      expect(await router.navigate('/bookmarklet')).to.equal(false)
      expect(window.location.pathname).to.equal('/storage')
      expect(window.history.length).to.equal(before)
      expect(router.route).to.deep.equal({ name: 'storage' })
    })

    it('replaces rather than pushes when asked', async () => {
      const before = window.history.length
      await router.navigate('/songs', { replace: true })
      expect(window.location.pathname).to.equal('/songs')
      expect(window.history.length).to.equal(before)
    })

    it('tells the document, with the route it left', async () => {
      const changed = routeChanged()
      router.navigate('/songs')
      const event = (await changed) as RouteChangeEvent
      expect(event.route).to.deep.equal({ name: 'songs' })
      expect(event.previous).to.deep.equal({ name: 'storage' })
    })

    it('keeps the default title for a view with none', async () => {
      const original = document.title
      await router.navigate('/songs')
      expect(document.title).to.equal(original)
    })

    it('swaps the view in a view transition when the browser has them', async () => {
      if (!document.startViewTransition) return
      makeRouter({ transitions: true })
      await router.start()
      await router.navigate('/songs')
      expect(outlet.firstElementChild.dataset.view).to.equal('songs')
    })
  })

  describe("a view's own title", () => {
    beforeEach(async () => {
      window.history.replaceState(null, '', '/setlist/abc')
      await makeRouter().start()
    })

    it("is the view's, with the app's name after it, until the view is left", async () => {
      expect(document.title).to.equal('Setlist abc')
      router.setTitle('Sun 11 Oct - Easter')
      expect(document.title).to.equal('Sun 11 Oct - Easter - Chordless')

      await router.navigate('/storage')
      expect(document.title).to.equal('Storage - Chordless')
    })

    it('stays while the user moves within the view', async () => {
      router.setTitle('Sun 11 Oct')
      await router.navigate('/setlist/abc/song/1')
      expect(document.title).to.equal('Sun 11 Oct - Chordless')
      await router.navigate('/setlist/abc')
      expect(document.title).to.equal('Sun 11 Oct - Chordless')
    })

    it("does not carry over to another setlist's view", async () => {
      router.setTitle('Sun 11 Oct')
      await router.navigate('/setlist/other')
      expect(document.title).to.equal('Setlist other')
    })

    it("goes back to the entry's title when cleared", () => {
      router.setTitle('Sun 11 Oct')
      router.setTitle(null)
      expect(document.title).to.equal('Setlist abc')
    })
  })

  describe('moving within a view', () => {
    beforeEach(async () => {
      window.history.replaceState(null, '', '/setlist/abc')
      await makeRouter().start()
    })

    it('keeps the view, and gives it the new route, when the setlist stays the same', async () => {
      const view = router.view
      await router.navigate('/setlist/abc/song/1')
      expect(router.view).to.equal(view)
      expect(loads).to.deep.equal(['setlist:abc'])
      expect(view.routes.map(route => route.songIndex)).to.deep.equal([-1, 1])
    })

    it('does not cancel a change of view that is still loading', async () => {
      let release
      views.storage.load = () =>
        new Promise(resolve => {
          release = () => resolve(fakeView('storage'))
        })
      const going = router.navigate('/storage')
      // While storage loads, the setlist moves on within itself
      await router.navigate('/setlist/abc/song/1', { replace: true })
      expect(router.view.dataset.view).to.equal('setlist')
      expect(window.location.pathname).to.equal('/setlist/abc/song/1')

      release()
      await going
      expect(router.view.dataset.view).to.equal('storage')
      expect(window.location.pathname).to.equal('/storage')
    })

    it('replaces the view for another setlist', async () => {
      const view = router.view
      await router.navigate('/setlist/xyz')
      expect(router.view).to.not.equal(view)
      expect(loads).to.deep.equal(['setlist:abc', 'setlist:xyz'])
      expect(view.isConnected).to.equal(false)
    })
  })

  describe('history', () => {
    beforeEach(async () => {
      atEndOfHistory()
      window.history.replaceState(null, '', '/setlist/abc')
      await makeRouter().start()
    })

    it('pushes from the overview into a song, and replaces from song to song', async () => {
      const start = window.history.length
      await router.navigate('/setlist/abc/song/0')
      expect(window.history.length).to.equal(start + 1)
      await router.navigate('/setlist/abc/song/1')
      expect(window.history.length).to.equal(start + 1)
      expect(window.location.pathname).to.equal('/setlist/abc/song/1')
    })

    it('remembers a song was opened from the overview, or the library list', async () => {
      await router.navigate('/setlist/abc/song/0')
      expect(window.history.state).to.include({ fromParent: true })
      await router.navigate('/setlist/abc/song/1')
      expect(window.history.state).to.include({ fromParent: true })
    })

    it('goes back to the overview a song was opened from', async () => {
      await router.navigate('/setlist/abc/song/0')
      const changed = routeChanged()
      await router.navigate('/setlist/abc')
      const event = (await changed) as RouteChangeEvent
      expect(event.route).to.deep.equal({ name: 'setlist', setlistId: 'abc', songIndex: -1 })
      expect(window.location.pathname).to.equal('/setlist/abc')
    })

    it('replaces to the overview from a song that was a direct link', async () => {
      window.history.replaceState(null, '', '/setlist/abc/song/3')
      router.stop()
      await makeRouter().start()
      const start = window.history.length
      await router.navigate('/setlist/abc')
      expect(window.history.length).to.equal(start)
      expect(window.location.pathname).to.equal('/setlist/abc')
    })

    it('follows the back button', async () => {
      await router.navigate('/storage')
      expect(router.route.name).to.equal('storage')
      const changed = routeChanged()
      window.history.back()
      await changed
      expect(router.route).to.deep.equal({ name: 'setlist', setlistId: 'abc', songIndex: -1 })
      expect(outlet.firstElementChild.dataset.view).to.equal('setlist')
    })
  })

  describe('links', () => {
    let host

    /** Click a link, in a shadow root as the nav menu has them; true if the router took it */
    const click = (attributes, init = {}) => {
      const root = host.shadowRoot
      root.innerHTML = `<a ${attributes}>link</a>`
      let routerTookIt = null
      const finish = event => {
        routerTookIt = event.defaultPrevented
        // Never let the test page itself navigate
        event.preventDefault()
      }
      window.addEventListener('click', finish, { once: true })
      root
        .querySelector('a')
        .dispatchEvent(
          new MouseEvent('click', { bubbles: true, composed: true, cancelable: true, ...init })
        )
      return routerTookIt
    }

    beforeEach(async () => {
      host = document.createElement('div')
      host.attachShadow({ mode: 'open' })
      document.body.append(host)
      window.history.replaceState(null, '', '/storage')
      await makeRouter().start()
    })

    afterEach(() => host.remove())

    it('follows a link to a route with a view, from inside a shadow root', async () => {
      const changed = routeChanged()
      expect(click('href="/songs"')).to.equal(true)
      await changed
      expect(window.location.pathname).to.equal('/songs')
    })

    it('leaves a link to a route with no view to the browser', () => {
      expect(click('href="/bookmarklet"')).to.equal(false)
      expect(router.route.name).to.equal('storage')
    })

    it('leaves other kinds of clicks and links to the browser', () => {
      expect(click('href="/songs"', { metaKey: true })).to.equal(false)
      expect(click('href="/songs"', { ctrlKey: true })).to.equal(false)
      expect(click('href="/songs"', { shiftKey: true })).to.equal(false)
      expect(click('href="/songs"', { button: 1 })).to.equal(false)
      expect(click('href="/songs" target="_blank"')).to.equal(false)
      expect(click('href="/songs" download')).to.equal(false)
      expect(click('href="/songs" rel="external"')).to.equal(false)
      expect(click('href="https://example.com/songs"')).to.equal(false)
      expect(click('href="#top"')).to.equal(false)
      expect(click('')).to.equal(false)
      expect(window.location.pathname).to.equal('/storage')
    })
  })

  describe('loading a view', () => {
    let release

    beforeEach(async () => {
      window.history.replaceState(null, '', '/storage')
      await makeRouter().start()
    })

    /** Make the songs view load only when release() is called */
    const slowSongs = () => {
      const gate = new Promise(resolve => {
        release = resolve
      })
      views.songs.load = async () => {
        await gate
        return fakeView('songs')
      }
    }

    it('leaves the URL and the view alone until the new view has loaded', async () => {
      slowSongs()
      const done = router.navigate('/songs')
      await Promise.resolve()
      expect(window.location.pathname).to.equal('/storage')
      expect(outlet.firstElementChild.dataset.view).to.equal('storage')
      release()
      await done
      expect(window.location.pathname).to.equal('/songs')
      expect(outlet.firstElementChild.dataset.view).to.equal('songs')
    })

    it('shows an error view when loading fails, at the URL asked for', async () => {
      const original = console.error
      console.error = () => undefined
      try {
        views.songs.load = () => Promise.reject(new Error('offline'))
        await router.navigate('/songs')
      } finally {
        console.error = original
      }
      expect(outlet.firstElementChild.getAttribute('role')).to.equal('alert')
      expect(window.location.pathname).to.equal('/songs')
      expect(router.route.name).to.equal('songs')
    })

    it('shows the error view an app supplies', async () => {
      const original = console.error
      console.error = () => undefined
      try {
        makeRouter({
          errorView: (route, error) => {
            const view = document.createElement('p')
            view.textContent = `${route.name}: ${error.message}`
            return view
          },
        })
        window.history.replaceState(null, '', '/storage')
        await router.start()
        views.songs.load = () => Promise.reject(new Error('offline'))
        await router.navigate('/songs')
      } finally {
        console.error = original
      }
      expect(outlet.firstElementChild.textContent).to.equal('songs: offline')
    })

    it('drops a view that loaded after a newer navigation started', async () => {
      slowSongs()
      const slow = router.navigate('/songs')
      await router.navigate('/setlist/abc')
      release()
      await slow
      expect(window.location.pathname).to.equal('/setlist/abc')
      expect(outlet.children).to.have.length(1)
      expect(outlet.firstElementChild.dataset.view).to.equal('setlist')
      expect(router.route.name).to.equal('setlist')
    })

    it('shows a not-found view for an unknown URL when the app has one', async () => {
      views['not-found'] = { load: () => fakeView('not-found') }
      window.history.replaceState(null, '', '/no-such-page')
      expect(await makeRouter().start()).to.equal(true)
      expect(outlet.firstElementChild.dataset.view).to.equal('not-found')
    })
  })

  describe('telling assistive technology', () => {
    let announcer

    beforeEach(async () => {
      announcer = document.createElement('div')
      announcer.setAttribute('aria-live', 'polite')
      document.body.append(announcer)
      window.history.replaceState(null, '', '/storage')
      await makeRouter({ announcer }).start()
    })

    afterEach(() => announcer.remove())

    it('announces the title when the view changes, but not the first view', async () => {
      expect(announcer.textContent).to.equal('')
      await router.navigate('/setlist/abc')
      expect(announcer.textContent).to.equal('Setlist abc')
    })

    it('does not announce a move within a view', async () => {
      await router.navigate('/setlist/abc')
      announcer.textContent = ''
      await router.navigate('/setlist/abc/song/1')
      expect(announcer.textContent).to.equal('')
    })

    it('moves focus to a view that takes focus, and leaves the others', async () => {
      views.songs.load = () => {
        const view = fakeView('songs')
        view.setAttribute('tabindex', '-1')
        return view
      }
      const before = document.activeElement
      await router.navigate('/setlist/abc')
      expect(document.activeElement).to.equal(before)
      await router.navigate('/songs')
      expect(document.activeElement).to.equal(router.view)
    })
  })

  describe('route context', () => {
    it('provides the route to components, and clears it on stop', async () => {
      const host = document.createElement('route-consumer')
      document.body.append(host)
      const consumer = host.consumer
      window.history.replaceState(null, '', '/storage')
      await makeRouter().start()
      expect(consumer.value).to.deep.equal({ name: 'storage' })
      await router.navigate('/songs')
      expect(consumer.value).to.deep.equal({ name: 'songs' })
      router.stop()
      expect(consumer.value).to.equal(null)
      host.remove()
    })
  })

  describe('coming back to a view', () => {
    beforeEach(async () => {
      window.history.replaceState(null, '', '/storage')
      await makeRouter().start()
    })

    it('gives the history entries keys: kept by a replace, new for a push', async () => {
      const first = window.history.state.key
      expect(first).to.be.a('string')
      await router.navigate('/songs', { replace: true })
      expect(window.history.state.key).to.equal(first)
      await router.navigate('/setlist/abc')
      expect(window.history.state.key).to.not.equal(first)
    })

    it('hands back what a view showed when you return with the back button', async () => {
      const left = router.view.captureViewState()
      captured-- // the router will capture it again in a moment: the same number comes round
      await router.navigate('/songs')
      const back = routeChanged()
      window.history.back()
      await back
      expect(router.view.dataset.view).to.equal('storage')
      expect(router.view.restoredState).to.deep.equal(left)
    })

    it('hands back the state of the view you went forward to, too', async () => {
      await router.navigate('/songs')
      let changed = routeChanged()
      window.history.back() // storage, remembering songs' state under its entry
      await changed
      changed = routeChanged()
      window.history.forward()
      await changed
      expect(router.view.dataset.view).to.equal('songs')
      // songs was left when going back: that is what it gets
      expect(router.view.restoredState).to.include({ name: 'songs' })
    })

    it('starts a view clean when it is reached by a new navigation', async () => {
      await router.navigate('/songs')
      await router.navigate('/storage')
      expect(router.view.dataset.view).to.equal('storage')
      expect(router.view.restoredState).to.equal(undefined)
    })

    it('has nothing to hand back for a view that keeps no state', async () => {
      views.songs.load = () => fakeView('songs', { keepsState: false })
      await router.navigate('/songs')
      await router.navigate('/setlist/abc')
      const back = routeChanged()
      window.history.back()
      await back
      expect(router.view.dataset.view).to.equal('songs')
      expect(router.view.restoredState).to.equal(undefined)
    })

    it('does not capture a view that stays (a move within a setlist)', async () => {
      await router.navigate('/setlist/abc')
      const view = router.view
      const before = captured
      await router.navigate('/setlist/abc/song/1')
      expect(router.view).to.equal(view)
      expect(captured).to.equal(before)
    })

    /**
     * Navigate through six entries, ending on another view than the first (moving between
     * entries of the same view just keeps it), then go back to the first, and say what it
     * was handed
     */
    async function backToTheFirstOfSix() {
      for (const path of ['/songs', '/storage', '/songs', '/storage', '/songs']) {
        await router.navigate(path)
      }
      const back = routeChanged()
      window.history.go(-5)
      await back
      expect(router.view.dataset.view).to.equal('storage')
      return router.view.restoredState
    }

    it('remembers a view for a long trip through the history', async () => {
      expect(await backToTheFirstOfSix()).to.include({ name: 'storage' })
    })

    it('forgets the oldest entries when it has too many', async () => {
      makeRouter({ rememberLimit: 2 })
      window.history.replaceState(null, '', '/storage')
      await router.start()
      expect(await backToTheFirstOfSix()).to.equal(undefined)
    })
  })

  describe('across a reload', () => {
    const STORAGE_KEY = 'chordless:view-states'
    const storage = window.sessionStorage

    beforeEach(() => storage.removeItem(STORAGE_KEY))
    afterEach(() => storage.removeItem(STORAGE_KEY))

    /** A new router for the same page, as after a reload: it shares only storage and the history */
    async function reload() {
      router.stop()
      await makeRouter({ storage }).start()
      return router.view
    }

    it('hands back the state of a view that was left, to a router that starts afterwards', async () => {
      window.history.replaceState(null, '', '/storage')
      await makeRouter({ storage }).start()
      await router.navigate('/songs')
      const back = routeChanged()
      window.history.back()
      await back
      const left = JSON.parse(must(storage.getItem(STORAGE_KEY))).find(
        ([, state]) => state.name === 'storage'
      )
      expect(left).to.not.equal(undefined)

      const view = await reload()
      expect(view.dataset.view).to.equal('storage')
      expect(view.restoredState).to.deep.equal(left[1])
    })

    it('keeps the view that is showing when the page is hidden', async () => {
      window.history.replaceState(null, '', '/storage')
      await makeRouter({ storage }).start()
      expect(storage.getItem(STORAGE_KEY)).to.equal(null)

      window.dispatchEvent(new Event('pagehide'))
      const saved = JSON.parse(must(storage.getItem(STORAGE_KEY)))
      expect(saved).to.have.length(1)
      expect(saved[0][1]).to.include({ name: 'storage' })

      const view = await reload()
      expect(view.restoredState).to.deep.equal(saved[0][1])
    })

    it('keeps it when the tab goes out of sight, but not when it comes back', async () => {
      window.history.replaceState(null, '', '/storage')
      await makeRouter({ storage }).start()
      const visible = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState')
      const setVisibility = value =>
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => value })
      try {
        setVisibility('visible')
        document.dispatchEvent(new Event('visibilitychange'))
        expect(storage.getItem(STORAGE_KEY)).to.equal(null)
        setVisibility('hidden')
        document.dispatchEvent(new Event('visibilitychange'))
        expect(JSON.parse(must(storage.getItem(STORAGE_KEY)))).to.have.length(1)
      } finally {
        Reflect.deleteProperty(document, 'visibilityState')
        Object.defineProperty(Document.prototype, 'visibilityState', must(visible))
      }
    })

    it('starts without state if what is stored cannot be read', async () => {
      for (const junk of ['not json', '{"a":1}', '42', 'null']) {
        storage.setItem(STORAGE_KEY, junk)
        window.history.replaceState(null, '', '/storage')
        await makeRouter({ storage }).start()
        expect(router.view.restoredState, junk).to.equal(undefined)
        router.stop()
      }
    })

    it('still works when storage refuses to write', async () => {
      const full = {
        getItem: () => null,
        setItem: () => {
          throw new Error('quota')
        },
      }
      window.history.replaceState(null, '', '/storage')
      await makeRouter({ storage: full }).start()
      await router.navigate('/songs')
      const back = routeChanged()
      window.history.back()
      await back
      // Kept in memory all the same
      expect(router.view.restoredState).to.include({ name: 'storage' })
    })
  })

  describe('stop', () => {
    it('removes the view and stops following links', async () => {
      window.history.replaceState(null, '', '/storage')
      await makeRouter().start()
      const view = router.view
      router.stop()
      expect(view.isConnected).to.equal(false)
      expect(router.route).to.equal(null)
    })
  })
})

describe('pageTitle', () => {
  it('keeps the full title in a browser tab', () => {
    expect(pageTitle('Preferences - Chordless', false)).to.equal('Preferences - Chordless')
    expect(pageTitle('Chordless', false)).to.equal('Chordless')
  })

  it("leaves the app's name off in an installed app's window, which has it in front", () => {
    expect(pageTitle('Preferences - Chordless', true)).to.equal('Preferences')
    expect(pageTitle('Song Library - Chordless', true)).to.equal('Song Library')
    // The home page is just the app's name, which would say it twice
    expect(pageTitle('Chordless', true)).to.equal('Setlists')
    // A title that only mentions the name keeps it
    expect(pageTitle('About Chordless', true)).to.equal('About Chordless')
  })
})
