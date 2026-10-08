import { expect } from '@esm-bundle/chai'
import '../public/components/app-header.js'
import '../public/components/nav-menu.js'

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

  /** Wait for the popover's toggle event to have run */
  const settle = () => new Promise(resolve => setTimeout(resolve))

  afterEach(() => container?.remove())

  it('opens and closes from the button named by for', async () => {
    const menu = await setUp(`
      <button id="menu-button" style="position: fixed; top: 10px; left: 20px; height: 30px">Menu</button>
      <nav-menu for="menu-button"></nav-menu>
    `)
    const button = container.querySelector('#menu-button')

    button.click()
    await settle()
    expect(menu.isOpen()).to.equal(true)
    expect(menu.popover.style.top).to.equal('44px') // 4px below the button
    expect(menu.popover.style.left).to.equal('20px')

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
})
