import { expect } from '@esm-bundle/chai'
import '../public/components/bookmarklet-installer.js'
import { bookmarkletUrl, importFromSongSelect } from '../public/js/songselect-bookmarklet.js'

const { describe, it, afterEach } = window

/** The script a browser runs for a javascript: URL */
const scriptOf = url => decodeURIComponent(url.slice('javascript:'.length))

describe('bookmarkletUrl', () => {
  it('is a javascript: URL with no raw spaces or line breaks', () => {
    const url = bookmarkletUrl('https://chordless.app')
    expect(url.startsWith('javascript:')).to.equal(true)
    expect(url).to.not.match(/[\s]/)
  })

  it('imports into the given origin', () => {
    expect(scriptOf(bookmarkletUrl('https://chordless.app'))).to.contain(
      '("https://chordless.app")'
    )
  })

  it('runs, and only works on SongSelect', async () => {
    const alerts = []
    const realAlert = window.alert
    window.alert = message => alerts.push(message)
    try {
      // The script is an async function call; eval returns its promise
      await (0, eval)(scriptOf(bookmarkletUrl('https://chordless.app')))
    } finally {
      window.alert = realAlert
    }
    expect(alerts).to.deep.equal(['Please navigate to a SongSelect song page first.'])
  })
})

describe('importFromSongSelect', () => {
  const CHORDLESS = 'https://chordless.app'

  /**
   * A stand-in for the SongSelect page's window. Records what happens, in order,
   * in `log`; `ready()` plays the import page saying it's ready.
   */
  function fakePage({
    download = { ok: true, payload: '{title: Test}' },
    popupBlocked = false,
  } = {}) {
    const log = []
    const listeners = new Set()
    const tab = { postMessage: (message, origin) => log.push(['post', message, origin]) }
    const page = {
      log,
      location: { href: 'https://songselect.ccli.com/songs/1234567/test-song' },
      document: {
        querySelector: () => ({ textContent: ' Test Song ' }),
        body: { textContent: 'Key: G  Tempo: 72' },
      },
      alert: message => log.push(['alert', message]),
      open: (url, name) => {
        log.push(['open', url, name])
        return popupBlocked ? null : tab
      },
      fetch: async url => {
        log.push(['fetch', url])
        if (download instanceof Error) throw download
        return { ok: download.ok, status: 403, json: async () => ({ payload: download.payload }) }
      },
      setTimeout: () => 0, // never times out
      addEventListener: (type, listener) => listeners.add(listener),
      removeEventListener: (type, listener) => listeners.delete(listener),
      ready: (origin = CHORDLESS) => {
        for (const listener of listeners) {
          listener({ origin, data: { type: 'CHORDLESS_READY' } })
        }
      },
      listeners,
    }
    return page
  }

  /** Run the import, with the import page becoming ready after the download */
  async function run(page) {
    const done = importFromSongSelect(CHORDLESS, page)
    await new Promise(resolve => setTimeout(resolve))
    page.ready()
    await done
  }

  it('opens Chordless before downloading, then sends the song once it is ready', async () => {
    const page = fakePage()
    await run(page)
    expect(page.log.map(entry => entry[0])).to.deep.equal(['open', 'fetch', 'post'])
    expect(page.log[0].slice(1)).to.deep.equal([`${CHORDLESS}/import-song`, 'chordless'])
    expect(page.log[1][1]).to.contain('songNumber=1234567&key=G')
    expect(page.log[2][1]).to.deep.equal({
      type: 'CHORDLESS_IMPORT',
      data: {
        chordproText: '{title: Test}',
        metadata: { ccliNumber: '1234567', title: 'Test Song', key: 'G' },
        source: 'songselect',
      },
    })
    expect(page.log[2][2]).to.equal(CHORDLESS)
    expect(page.listeners.size).to.equal(0)
  })

  it('sends the song when Chordless was ready before the download finished', async () => {
    const page = fakePage()
    const realFetch = page.fetch
    page.fetch = async url => {
      page.ready()
      return realFetch(url)
    }
    await importFromSongSelect(CHORDLESS, page)
    expect(page.log.map(entry => entry[0])).to.deep.equal(['open', 'fetch', 'post'])
  })

  it('ignores ready messages from other sites', async () => {
    const page = fakePage()
    const done = importFromSongSelect(CHORDLESS, page)
    await new Promise(resolve => setTimeout(resolve))
    page.ready('https://evil.example')
    await new Promise(resolve => setTimeout(resolve))
    expect(page.log.map(entry => entry[0])).to.deep.equal(['open', 'fetch'])
    page.ready()
    await done
    expect(page.log.at(-1)[0]).to.equal('post')
  })

  it('tells Chordless when the download fails', async () => {
    const page = fakePage({ download: { ok: false } })
    await run(page)
    expect(page.log.at(-1)[1]).to.deep.equal({
      type: 'CHORDLESS_IMPORT_FAILED',
      data: { message: 'SongSelect download failed: 403' },
    })
  })

  it("tells Chordless when the user can't access the chart", async () => {
    const page = fakePage({ download: { ok: true, payload: '  ' } })
    await run(page)
    expect(page.log.at(-1)[1].type).to.equal('CHORDLESS_IMPORT_FAILED')
  })

  it("stops without downloading if the tab can't be opened", async () => {
    const page = fakePage({ popupBlocked: true })
    await importFromSongSelect(CHORDLESS, page)
    expect(page.log).to.deep.equal([
      ['open', `${CHORDLESS}/import-song`, 'chordless'],
      ['alert', '⚠️ Popup blocked. Please allow popups.'],
    ])
    expect(page.listeners.size).to.equal(0)
  })
})

describe('bookmarklet-installer', () => {
  let installer

  async function makeInstaller() {
    installer = document.createElement('bookmarklet-installer')
    document.body.appendChild(installer)
    await installer.updateComplete
    return installer
  }

  const $ = selector => installer.shadowRoot.querySelector(selector)

  afterEach(() => installer?.remove())

  it('offers the bookmarklet for this origin as a link and as code', async () => {
    await makeInstaller()
    const url = bookmarkletUrl(window.location.origin)
    expect($('a').getAttribute('href')).to.equal(url)
    expect($('textarea').value).to.equal(url)
  })

  it("doesn't run the bookmarklet when the link is clicked here", async () => {
    await makeInstaller()
    const click = new MouseEvent('click', { bubbles: true, cancelable: true })
    $('a').dispatchEvent(click)
    expect(click.defaultPrevented).to.equal(true)
  })

  it('copies the code and says so', async () => {
    await makeInstaller()
    let copied = null
    const realClipboard = Object.getOwnPropertyDescriptor(Navigator.prototype, 'clipboard')
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async text => (copied = text) },
    })
    try {
      $('.copy').click()
      await new Promise(resolve => setTimeout(resolve))
      await installer.updateComplete
    } finally {
      delete navigator.clipboard
      if (realClipboard) Object.defineProperty(Navigator.prototype, 'clipboard', realClipboard)
    }
    expect(copied).to.equal(bookmarkletUrl(window.location.origin))
    expect($('[role="status"]').textContent).to.contain('Copied')
  })
})
