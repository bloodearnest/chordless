import { expect, waitUntil } from '@open-wc/testing'
import '../src/components/app-header.ts'
import '../src/components/nav-menu.ts'
import {
  MenuBackClickEvent,
  MenuOverviewClickEvent,
  MenuSongClickEvent,
} from '../src/components/nav-menu.ts'
import { AppUpdateChangeEvent, appUpdate } from '../src/js/app-update.ts'
import { provideRoute } from '../src/js/route-context.ts'
import { A11Y, settle } from './test-helpers.ts'

const { describe, it, afterEach } = window

describe('nav-menu', () => {
  let container

  async function setUp(markup) {
    container = document.createElement('div')
    container.innerHTML = markup
    document.body.appendChild(container)
    const menu = container.querySelector('nav-menu')
    await menu.updateComplete
    return menu
  }

  /** Let the dialog's close event, and the renders it causes, run */

  afterEach(() => container?.remove())

  it('has a Help item only on a page that has help, and it opens that help', async () => {
    const menu = await setUp(`
      <button id="menu-button">Menu</button>
      <nav-menu for="menu-button"></nav-menu>
    `)
    const helpItem = () =>
      [...menu.shadowRoot.querySelectorAll('.nav-menu-item')].find(item =>
        item.textContent.trim().startsWith('Help')
      )
    provideRoute({ name: 'about' })
    await settle()
    expect(helpItem()).to.equal(undefined)

    provideRoute({ name: 'songs' })
    await settle()
    container.querySelector('#menu-button').click()
    await settle()
    helpItem().click()
    await waitUntil(() =>
      menu.shadowRoot.querySelector('app-help')?.shadowRoot?.textContent.includes('Finding a song')
    )
    expect(menu.shadowRoot.querySelector('app-modal[heading="Song Library"]').open).to.equal(true)
    menu.shadowRoot.querySelector('app-modal[heading="Song Library"]').close()
    provideRoute(null)
  })

  it('follows a link in the help: Preferences opens over the page, other links go where they go', async () => {
    const menu = await setUp(`
      <button id="menu-button">Menu</button>
      <nav-menu for="menu-button"></nav-menu>
    `)
    provideRoute({ name: 'songs' })
    await settle()
    container.querySelector('#menu-button').click()
    await settle()
    const helpButton = [...menu.shadowRoot.querySelectorAll('.nav-menu-item')].find(item =>
      item.textContent.trim().startsWith('Help')
    )
    helpButton.click()
    const modal = () => menu.shadowRoot.querySelector('app-modal[heading="Song Library"]')
    await waitUntil(() => modal()?.open)
    const preferences = () => menu.shadowRoot.querySelector('app-modal[heading="Preferences"]')

    // Not a link: the help stays
    modal().querySelector('app-help').shadowRoot.querySelector('.text').click()
    expect(modal().open).to.equal(true)

    // A link to Preferences: the help gives way to the Preferences modal, and the page is not left
    const link = modal()
      .querySelector('app-help')
      .shadowRoot.querySelector('a[href="/preferences"]')
    const click = new MouseEvent('click', { bubbles: true, composed: true, cancelable: true })
    link.dispatchEvent(click)
    expect(click.defaultPrevented).to.equal(true)
    expect(modal().open).to.equal(false)
    await waitUntil(() => preferences()?.open)
    preferences().close()

    // Any other link is the router's: the help closes, and the click is left alone
    container.querySelector('#menu-button').click()
    await settle()
    ;[...menu.shadowRoot.querySelectorAll('.nav-menu-item')]
      .find(item => item.textContent.trim().startsWith('Help'))
      .click()
    await waitUntil(() => modal()?.open)
    const other = document.createElement('a')
    other.href = '/songs'
    other.addEventListener('click', event => event.preventDefault())
    modal().append(other)
    other.click()
    expect(modal().open).to.equal(false)
    provideRoute(null)
  })

  it('closes when the route changes, as it outlives the views', async () => {
    const menu = await setUp(`
      <button id="menu-button">Menu</button>
      <nav-menu for="menu-button"></nav-menu>
    `)
    container.querySelector('#menu-button').click()
    await settle()
    expect(menu.isOpen()).to.equal(true)

    provideRoute({ name: 'songs' })
    await settle()
    expect(menu.isOpen()).to.equal(false)
    provideRoute(null)
  })

  it('stays open for a move within the view, which the user may be in the middle of', async () => {
    const menu = await setUp(`
      <button id="menu-button">Menu</button>
      <nav-menu for="menu-button"></nav-menu>
    `)
    provideRoute({ name: 'songs' })
    container.querySelector('#menu-button').click()
    await settle()
    expect(menu.isOpen()).to.equal(true)

    provideRoute({ name: 'songs', search: 'grace' })
    await settle()
    expect(menu.isOpen()).to.equal(true)

    provideRoute({ name: 'storage' })
    await settle()
    expect(menu.isOpen()).to.equal(false)
    provideRoute(null)
  })

  it('closes when one of its links is chosen, even to where it already is', async () => {
    const menu = await setUp(`
      <button id="menu-button">Menu</button>
      <nav-menu for="menu-button"></nav-menu>
    `)
    container.querySelector('#menu-button').click()
    await settle()
    expect(menu.isOpen()).to.equal(true)

    const link = menu.shadowRoot.querySelector('a.nav-menu-item')
    link.addEventListener('click', event => event.preventDefault(), { once: true })
    link.click()
    await settle()
    expect(menu.isOpen()).to.equal(false)
  })

  it('opens and closes from the button named by for', async () => {
    const menu = await setUp(`
      <button id="menu-button" style="position: fixed; top: 10px; left: 20px; height: 30px">Menu</button>
      <nav-menu for="menu-button"></nav-menu>
    `)
    const button = container.querySelector('#menu-button')

    button.click()
    await settle()
    expect(menu.isOpen()).to.equal(true)
    expect(menu.dialog.style.top).to.equal('44px') // 4px below the button
    expect(menu.dialog.style.left).to.equal('20px')

    button.click()
    await settle()
    expect(menu.isOpen()).to.equal(false)
  })

  it('ignores clicks elsewhere while closed', async () => {
    const menu = await setUp(`
      <button id="menu-button">Menu</button>
      <button id="other">Other</button>
      <nav-menu for="menu-button"></nav-menu>
    `)
    container.querySelector('#other').click()
    await settle()
    expect(menu.isOpen()).to.equal(false)
  })

  it('renders the preferences only once they are opened', async () => {
    const menu = await setUp('<nav-menu></nav-menu>')
    expect(menu.shadowRoot.querySelector('app-preferences')).to.equal(null)

    // Its code is loaded when first asked for, so it appears a moment after the click
    menu.shadowRoot.querySelector('.nav-menu-item:not(a)').click()
    await waitUntil(() => menu.shadowRoot.querySelector('app-preferences'))
    expect(customElements.get('app-preferences')).to.not.equal(undefined)
  })

  it("opens from an app-header's menu button, positioned under it", async () => {
    const menu = await setUp(`
      <app-header title="Test"></app-header>
      <nav-menu></nav-menu>
    `)
    const header = container.querySelector('app-header')
    await header.updateComplete
    const button = header.shadowRoot.querySelector('.nav-menu-button')

    button.click()
    await settle()
    expect(menu.isOpen()).to.equal(true)
    expect(menu.triggerButton).to.equal(button)

    button.click()
    await settle()
    expect(menu.isOpen()).to.equal(false)
  })

  it('is accessible when open', async () => {
    const menu = await setUp(`
      <button id="menu-button">Menu</button>
      <nav-menu for="menu-button"></nav-menu>
    `)
    container.querySelector('#menu-button').click()
    await settle()
    expect(menu.isOpen()).to.equal(true)
    await expect(menu).to.be.accessible(A11Y)
  })

  describe('the setlist section and the back item', () => {
    it('says which of its items was chosen, and closes', async () => {
      const menu = await setUp(
        `<nav-menu show-back-button back-label="Back to setlists" show-overview-link setlist-title="Sunday"></nav-menu>`
      )
      menu.songs = [{ title: 'First' }, { title: 'Second' }]
      await menu.updateComplete
      const seen: string[] = []
      menu.addEventListener(MenuBackClickEvent.type, () => seen.push('back'))
      menu.addEventListener(MenuOverviewClickEvent.type, () => seen.push('overview'))
      menu.addEventListener(MenuSongClickEvent.type, event => seen.push(`song ${event.index}`))
      expect(menu.shadowRoot.querySelector('.section-title').textContent).to.equal('Sunday')

      for (const selector of ['.back-button, [part~="back-button"]', '[part~="overview-item"]']) {
        menu.show()
        await settle()
        menu.shadowRoot.querySelector(selector).click()
        await settle()
        expect(menu.isOpen()).to.equal(false)
      }
      menu.show()
      await settle()
      menu.shadowRoot.querySelectorAll('.song-item')[1].click()
      await settle()
      expect(seen).to.deep.equal(['back', 'overview', 'song 1'])
      expect(menu.isOpen()).to.equal(false)
    })

    it('has none of that by default', async () => {
      const menu = await setUp('<nav-menu></nav-menu>')
      expect(menu.shadowRoot.querySelector('.setlist-section')).to.equal(null)
      expect(menu.shadowRoot.querySelector('[part~="back-button"]')).to.equal(null)
    })
  })

  describe('an update waiting', () => {
    const realApply = appUpdate.apply
    afterEach(() => {
      appUpdate.apply = realApply
      window.dispatchEvent(new AppUpdateChangeEvent(false))
    })

    it('offers to reload for it', async () => {
      const menu = await setUp('<nav-menu></nav-menu>')
      expect(menu.shadowRoot.querySelector('.update-item')).to.equal(null)
      let applied = 0
      appUpdate.apply = (async () => {
        applied++
      }) as typeof appUpdate.apply
      window.dispatchEvent(new AppUpdateChangeEvent(true))
      await menu.updateComplete
      menu.shadowRoot.querySelector('.update-item').click()
      expect(applied).to.equal(1)
    })
  })

  it('is positioned under the button it is shown from', async () => {
    const menu = await setUp(
      `<button id="b" style="position: fixed; top: 10px; left: 20px; height: 30px">B</button><nav-menu></nav-menu>`
    )
    menu.show(container.querySelector('#b'))
    await settle()
    expect(menu.dialog.style.top).to.equal('44px')
  })

  it('keeps the ways of adding songs in a view-only organisation', async () => {
    localStorage.setItem('current-organisation-read-only', '1')
    try {
      const menu = await setUp('<nav-menu></nav-menu>')
      expect(menu.shadowRoot.querySelector('a[href="/import-song"]')).to.not.equal(null)
    } finally {
      localStorage.removeItem('current-organisation-read-only')
    }
  })
})
