import { expect } from '@open-wc/testing'
import '../src/components/bookmarklet-installer.ts'
import { bookmarkletUrl, importFromSongSelect } from '../src/js/songselect-bookmarklet.ts'
import { must } from './must.ts'
import { A11Y } from './test-helpers.ts'

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
    const alerts: string[] = []
    const realAlert = window.alert
    window.alert = message => alerts.push(message)
    try {
      // The script is an async function call; indirect eval runs it in global scope and returns its promise
      // biome-ignore lint/security/noGlobalEval: the bookmarklet is a javascript: URL that has to be evaluated
      // biome-ignore lint/complexity/noCommaOperator: (0, eval) makes the eval indirect (global scope)
      await (0, eval)(scriptOf(bookmarkletUrl('https://chordless.app')))
    } finally {
      window.alert = realAlert
    }
    expect(alerts).to.deep.equal(['Please navigate to a SongSelect song page first.'])
  })
})

/** What the lead sheet request gets: nothing (SongSelect says no), the PDF, the PDF as JSON, or what is no PDF */
type LeadSheet = 'none' | 'pdf' | 'json' | 'html' | 'error'

/** What the song details request gets: nothing, a failure, or the song's details */
type SongDetailsReply = 'none' | 'error' | { defaultKey?: string[]; lyrics?: unknown[] }

const PDF = '%PDF-1.4 a lead sheet'
const bytesOf = (text: string) => new TextEncoder().encode(text)

describe('importFromSongSelect', () => {
  const CHORDLESS = 'https://chordless.app'

  /**
   * A stand-in for the SongSelect page's window. Records what happens, in order,
   * in `log`; `ready()` plays the import page saying it's ready.
   */
  function fakePage({
    download = { ok: true, payload: '{title: Test}\n{key: G}' } as
      | { ok: boolean; payload?: string }
      | Error,
    popupBlocked = false,
    leadSheet = 'none' as LeadSheet,
    details = 'none' as SongDetailsReply,
  } = {}) {
    const log: any[][] = []
    const listeners = new Set<(event: any) => void>()
    const tab = { postMessage: (message, origin) => log.push(['post', message, origin]) }
    const page = {
      log,
      keySelector: { textContent: null, value: 'G' } as {
        textContent: null
        value?: string
      } | null,
      location: { href: 'https://songselect.ccli.com/songs/1234567/test-song' },
      document: {
        // (the chord sheet page's key selector is there only on that page)
        querySelector: selector =>
          selector === '#ChordSheetTransposeKeySelectInput'
            ? page.keySelector
            : { textContent: ' Test Song ' },
      },
      alert: message => log.push(['alert', message]),
      open: (url, name) => {
        log.push(['open', url, name])
        return popupBlocked ? null : tab
      },
      fetch: async url => {
        log.push(['fetch', url])
        if (url.includes('GetSongLeadPdf')) {
          if (leadSheet === 'error') throw new Error('offline')
          const body = {
            none: '',
            pdf: PDF,
            json: JSON.stringify({ payload: btoa(PDF) }),
            html: '<html>Please sign in</html>',
          }[leadSheet]
          return {
            ok: leadSheet !== 'none',
            status: leadSheet === 'none' ? 403 : 200,
            json: async () => JSON.parse(body),
            arrayBuffer: async () => bytesOf(body).buffer,
          }
        }
        if (url.includes('GetSongDetails')) {
          if (details === 'error') throw new Error('offline')
          return {
            ok: details !== 'none',
            status: details === 'none' ? 403 : 200,
            json: async () => ({ payload: details }),
            arrayBuffer: async () => new ArrayBuffer(0),
          }
        }
        if (download instanceof Error) throw download
        return {
          ok: download.ok,
          status: 403,
          json: async () => ({ payload: download.payload }),
          arrayBuffer: async () => new ArrayBuffer(0),
        }
      },
      setTimeout: () => 0, // never times out
      addEventListener: (_type, listener) => listeners.add(listener),
      removeEventListener: (_type, listener) => listeners.delete(listener),
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
    expect(page.log.map(entry => entry[0])).to.deep.equal(['open', 'fetch', 'fetch', 'post'])
    expect(page.log[0].slice(1)).to.deep.equal([`${CHORDLESS}/import-song`, 'chordless'])
    expect(page.log[1][1]).to.equal(
      'https://songselect.ccli.com/api/GetSongChordPro?songNumber=1234567&key=G&style=Standard&columns=1'
    )
    expect(page.log[3][1]).to.deep.equal({
      type: 'CHORDLESS_IMPORT',
      data: {
        chordproText: '{title: Test}\n{key: G}',
        metadata: { ccliNumber: '1234567', title: 'Test Song', key: 'G' },
        source: 'songselect',
      },
    })
    expect(page.log[3][2]).to.equal(CHORDLESS)
    expect(page.listeners.size).to.equal(0)
  })

  describe('the lead sheet', () => {
    it("is asked for in the chart's key, after the ChordPro, and sent with the song", async () => {
      const page = fakePage({ leadSheet: 'pdf' })
      await run(page)
      expect(page.log[2][1]).to.equal(
        'https://songselect.ccli.com/api/GetSongLeadPdf?songNumber=1234567&transposeKey=G&octave=0&noteSize=0&orientation=portrait&paperSize=A4&activityType=downloaded&renderer=pipeline'
      )
      const { leadSheet } = page.log[3][1].data
      expect(leadSheet).to.be.instanceOf(ArrayBuffer)
      expect(new TextDecoder().decode(leadSheet)).to.equal(PDF)
    })

    it("is in the chart's key, not the one the page had picked", async () => {
      const page = fakePage({
        leadSheet: 'pdf',
        download: { ok: true, payload: '{title: Test}\n{key: Bb}' },
      })
      await run(page)
      expect(page.log[2][1]).to.contain('transposeKey=Bb&')
    })

    it('can come as JSON with the PDF in base64, as the ChordPro does', async () => {
      const page = fakePage({ leadSheet: 'json' })
      await run(page)
      expect(new TextDecoder().decode(page.log[3][1].data.leadSheet)).to.equal(PDF)
    })

    for (const leadSheet of ['none', 'html', 'error'] as const) {
      it(`does not stop the song when it is not to be had (${leadSheet})`, async () => {
        const page = fakePage({ leadSheet })
        await run(page)
        const message = must(page.log.at(-1))[1]
        expect(message.type).to.equal('CHORDLESS_IMPORT')
        expect(message.data.chordproText).to.equal('{title: Test}\n{key: G}')
        expect(message.data).to.not.have.property('leadSheet')
      })
    }

    it('is not asked for when the chart has no key to put its notes in', async () => {
      const page = fakePage({
        leadSheet: 'pdf',
        download: { ok: true, payload: '{title: Test}\n[G]x' },
      })
      await run(page)
      expect(page.log.map(entry => entry[0])).to.deep.equal(['open', 'fetch', 'post'])
    })
  })

  it('sends the song when Chordless was ready before the download finished', async () => {
    const page = fakePage()
    const realFetch = page.fetch
    page.fetch = async url => {
      page.ready()
      return realFetch(url)
    }
    await importFromSongSelect(CHORDLESS, page)
    expect(page.log.map(entry => entry[0])).to.deep.equal(['open', 'fetch', 'fetch', 'post'])
  })

  it('ignores ready messages from other sites', async () => {
    const page = fakePage()
    const done = importFromSongSelect(CHORDLESS, page)
    await new Promise(resolve => setTimeout(resolve))
    page.ready('https://evil.example')
    await new Promise(resolve => setTimeout(resolve))
    expect(page.log.map(entry => entry[0])).to.deep.equal(['open', 'fetch', 'fetch'])
    page.ready()
    await done
    expect(must(page.log.at(-1))[0]).to.equal('post')
  })

  it('tells Chordless when the download fails', async () => {
    const page = fakePage({ download: { ok: false } })
    await run(page)
    expect(must(page.log.at(-1))[1]).to.deep.equal({
      type: 'CHORDLESS_IMPORT_FAILED',
      data: { message: 'SongSelect download failed: 403' },
    })
  })

  it("tells Chordless when the user can't access the chart", async () => {
    const page = fakePage({ download: { ok: true, payload: '  ' } })
    await run(page)
    expect(must(page.log.at(-1))[1].type).to.equal('CHORDLESS_IMPORT_FAILED')
  })

  it('tells Chordless when SongSelect has no ChordPro for the song, rather than importing its sentence', async () => {
    const page = fakePage({ download: { ok: true, payload: 'no chordPro for this song' } })
    await run(page)
    const sent = must(page.log.at(-1))[1]
    expect(sent.type).to.equal('CHORDLESS_IMPORT_FAILED')
    expect(sent.data.message).to.contain('no ChordPro chart')
    expect(sent.data.message).to.contain('no chordPro for this song')
  })

  it('sends the lyrics for Chordless to make a chart of, when SongSelect has no ChordPro for the song', async () => {
    const lyrics = [{ partLabel: 'Verse 1', lyrics: 'Words | More' }]
    const page = fakePage({
      download: { ok: true, payload: 'no chordPro for this song' },
      details: { defaultKey: ['Bb'], lyrics },
      leadSheet: 'pdf',
    })
    await run(page)
    expect(
      page.log.map(entry => entry[1]).filter(url => String(url).includes('GetSongDetails'))
    ).to.deep.equal([
      'https://songselect.ccli.com/api/GetSongDetails?songNumber=1234567&slug=test-song',
    ])
    // and the lead sheet is asked for in the default key, for the melody's range
    expect(page.log.some(entry => String(entry[1]).includes('transposeKey=Bb'))).to.equal(true)
    const sent = must(page.log.at(-1))[1]
    expect(sent.type).to.equal('CHORDLESS_IMPORT')
    expect(sent.data.chordproText).to.equal('')
    expect(sent.data.songDetails).to.deep.equal({ defaultKey: ['Bb'], lyrics })
    expect(sent.data.metadata).to.include({ ccliNumber: '1234567', key: 'Bb' })
  })

  it('asks for the details without a slug when the address has none', async () => {
    const page = fakePage({
      download: { ok: true, payload: 'no chordPro for this song' },
      details: { lyrics: [{}] },
    })
    page.location.href = 'https://songselect.ccli.com/songs/1234567'
    await run(page)
    expect(page.log.map(entry => entry[1])).to.include(
      'https://songselect.ccli.com/api/GetSongDetails?songNumber=1234567&slug='
    )
  })

  it('fails as before when there are no lyrics either', async () => {
    for (const details of ['none', 'error', {}] as SongDetailsReply[]) {
      const page = fakePage({
        download: { ok: true, payload: 'no chordPro for this song' },
        details,
      })
      await run(page)
      expect(must(page.log.at(-1))[1].type).to.equal('CHORDLESS_IMPORT_FAILED')
    }
  })

  it('asks for a SongSelect page when run on another site, and opens nothing', async () => {
    const page = fakePage()
    page.location.href = 'https://example.com/songs/1234567'
    await importFromSongSelect(CHORDLESS, page)
    expect(page.log).to.deep.equal([['alert', 'Please navigate to a SongSelect song page first.']])
  })

  it('says so when the page is a SongSelect one with no song number', async () => {
    const page = fakePage()
    page.location.href = 'https://songselect.ccli.com/search?q=grace'
    await importFromSongSelect(CHORDLESS, page)
    expect(page.log).to.deep.equal([['alert', '❌ Could not extract song number from URL']])
  })

  it('asks for letter chords, not numbers, in no key of its own when the page has no key selector', async () => {
    const page = fakePage()
    page.keySelector = null
    await run(page)
    expect(page.log[1][1]).to.equal(
      'https://songselect.ccli.com/api/GetSongChordPro?songNumber=1234567&style=Standard&columns=1'
    )
  })

  it('takes the key from the chart it was given, and none if the chart has none', async () => {
    const page = fakePage({ download: { ok: true, payload: '{title: Test}\n[G]No key line' } })
    await run(page)
    expect(page.log[2][1].data.metadata.key).to.equal(undefined)
  })

  it('tells Chordless the text of a failure that is not an Error', async () => {
    const page = fakePage()
    page.fetch = async () => {
      throw 'offline'
    }
    await run(page)
    expect(must(page.log.at(-1))[1]).to.deep.equal({
      type: 'CHORDLESS_IMPORT_FAILED',
      data: { message: 'offline' },
    })
  })

  it('gives up with a message when Chordless never says it is ready', async () => {
    const page = fakePage()
    page.setTimeout = ((handler: () => void) => {
      handler()
      return 0
    }) as unknown as () => number
    await importFromSongSelect(CHORDLESS, page)
    expect(must(page.log.at(-1))).to.deep.equal(['alert', '⚠️ Timeout waiting for Chordless'])
    expect(page.log.some(entry => entry[0] === 'post')).to.equal(false)
    expect(page.listeners.size).to.equal(0)
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
    let copied: string | null = null
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
      Reflect.deleteProperty(navigator, 'clipboard')
      if (realClipboard) Object.defineProperty(Navigator.prototype, 'clipboard', realClipboard)
    }
    expect(copied).to.equal(bookmarkletUrl(window.location.origin))
    expect($('[role="status"]').textContent).to.contain('Copied')
  })

  it('selects the code, and says to copy it from there, when copying is blocked', async () => {
    await makeInstaller()
    const realWarn = console.warn
    console.warn = () => {}
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async () => {
          throw new DOMException('blocked', 'NotAllowedError')
        },
      },
    })
    try {
      $('.copy').click()
      await new Promise(resolve => setTimeout(resolve))
      await installer.updateComplete
    } finally {
      Reflect.deleteProperty(navigator, 'clipboard')
      console.warn = realWarn
    }
    expect($('[role="status"]').textContent).to.contain('Copying was blocked')
    const code = $('textarea')
    expect(code.selectionStart).to.equal(0)
    expect(code.selectionEnd).to.equal(code.value.length)
  })

  it('is accessible', async () => {
    await makeInstaller()
    await expect(installer).to.be.accessible(A11Y)
  })
})
