import { expect } from '@open-wc/testing'
import '../public/components/app-header.js'
import '../public/components/nav-menu.js'
import { provideRoute } from '../public/js/route-context.js'
import { A11Y } from './test-helpers.js'

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
  const settle = () => new Promise(resolve => setTimeout(resolve))

  afterEach(() => container?.remove())

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

    menu.shadowRoot.querySelector('.nav-menu-item:not(a)').click()
    await menu.updateComplete
    expect(menu.shadowRoot.querySelector('app-preferences')).to.not.equal(null)
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
})
