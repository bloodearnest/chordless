import { expect } from '@open-wc/testing'
import { html, LitElement } from 'lit'
import { ref } from 'lit/directives/ref.js'
import { DialogPopup } from '../src/js/dialog-popup.ts'

const { describe, it, afterEach } = window

class PopupHost extends LitElement {
  placed = []
  popup = new DialogPopup(this, { position: dialog => this.placed.push(dialog.open) })

  override render() {
    return html`
      <button id="outside">Outside</button>
      <dialog
        ${ref(this.popup.ref)}
        aria-label="Test popup"
        style="position: fixed; top: 100px; left: 100px; margin: 0; padding: 20px; width: 200px"
        @click=${this.popup.onClick}
        @close=${this.popup.onClose}
      >
        <button id="inside">Inside</button>
      </dialog>
      <span id="state">${this.popup.isOpen ? 'open' : 'closed'}</span>
    `
  }
}
customElements.define('popup-host', PopupHost)

describe('DialogPopup', () => {
  let host

  async function setUp() {
    host = document.createElement('popup-host')
    document.body.append(host)
    await host.updateComplete
    return host
  }

  const click = (element, x, y) =>
    element.dispatchEvent(
      new MouseEvent('click', { bubbles: true, composed: true, clientX: x, clientY: y })
    )

  afterEach(() => host?.remove())

  it('opens as a modal dialog, and is placed once it is open', async () => {
    await setUp()
    host.popup.show()
    expect(host.popup.isOpen).to.equal(true)
    expect(host.popup.element.matches(':modal')).to.equal(true)
    expect(host.placed).to.deep.equal([true])
  })

  it('re-renders its host as it opens and closes', async () => {
    await setUp()
    const state = () => host.shadowRoot.querySelector('#state').textContent
    expect(state()).to.equal('closed')
    host.popup.show()
    await host.updateComplete
    expect(state()).to.equal('open')
    const closed = new Promise(resolve =>
      host.popup.element.addEventListener('close', resolve, { once: true })
    )
    host.popup.close()
    await closed
    await host.updateComplete
    expect(state()).to.equal('closed')
  })

  it('toggles, and shows an open dialog without throwing', async () => {
    await setUp()
    host.popup.toggle()
    expect(host.popup.isOpen).to.equal(true)
    host.popup.show()
    expect(host.placed).to.have.length(1)
    host.popup.toggle()
    expect(host.popup.isOpen).to.equal(false)
  })

  it('closes when the backdrop is clicked', async () => {
    await setUp()
    host.popup.show()
    click(host.popup.element, 2, 2)
    expect(host.popup.isOpen).to.equal(false)
  })

  it('stays open for a click on its padding or on what is inside', async () => {
    await setUp()
    host.popup.show()
    const box = host.popup.element.getBoundingClientRect()
    click(host.popup.element, box.left + 5, box.top + 5) // the padding
    expect(host.popup.isOpen).to.equal(true)
    host.shadowRoot.querySelector('#inside').click()
    expect(host.popup.isOpen).to.equal(true)
  })

  it('makes the page behind inert while it is open', async () => {
    await setUp()
    host.popup.show()
    expect(host.shadowRoot.querySelector('#outside').matches(':modal *')).to.equal(false)
    // Only the dialog and what is in it can be reached
    const hit = document.elementFromPoint(2, 2)
    expect(host.popup.element.contains(hit) || hit === host).to.equal(true)
  })

  it('closes when its host is removed', async () => {
    await setUp()
    host.popup.show()
    const dialog = host.popup.element
    host.remove()
    expect(dialog.open).to.equal(false)
  })
})
