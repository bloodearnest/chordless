import { expect } from '@esm-bundle/chai'
import '../public/components/bookmarklet-installer.js'
import { bookmarkletUrl } from '../public/js/songselect-bookmarklet.js'

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
