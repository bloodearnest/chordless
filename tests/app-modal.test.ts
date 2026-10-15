import { expect } from '@open-wc/testing'
import { sendKeys, sendMouse } from '@web/test-runner-commands'
import '../src/components/app-modal.ts'
import { A11Y } from './test-helpers.ts'

const { describe, it, afterEach } = window

describe('app-modal ask()', () => {
  let modal

  async function makeConfirmModal() {
    modal = document.createElement('app-modal')
    modal.type = 'confirm'
    modal.heading = 'Reset?'
    document.body.appendChild(modal)
    await modal.updateComplete
    return modal
  }

  async function click(selector) {
    await modal.updateComplete
    modal.shadowRoot.querySelector(selector).click()
  }

  afterEach(() => {
    modal?.remove()
  })

  it('opens the modal', async () => {
    await makeConfirmModal()
    modal.ask()
    expect(modal.open).to.equal(true)
  })

  it('resolves true when confirmed', async () => {
    await makeConfirmModal()
    const answer = modal.ask()
    await click('.modal-btn-confirm')
    expect(await answer).to.equal(true)
    expect(modal.open).to.equal(false)
  })

  it('resolves false when cancelled', async () => {
    await makeConfirmModal()
    const answer = modal.ask()
    await click('.modal-btn-cancel')
    expect(await answer).to.equal(false)
  })

  it('resolves false when closed without answering', async () => {
    await makeConfirmModal()
    const answer = modal.ask()
    modal.close()
    expect(await answer).to.equal(false)
  })

  it('does not carry an answer over to the next ask', async () => {
    await makeConfirmModal()
    const first = modal.ask()
    await click('.modal-btn-confirm')
    await first
    const second = modal.ask()
    await click('.modal-btn-cancel')
    expect(await second).to.equal(false)
  })

  it('is accessible while asking', async () => {
    await makeConfirmModal()
    modal.ask()
    await modal.updateComplete
    await expect(modal).to.be.accessible(A11Y)
  })
})

describe('app-modal dialog', () => {
  let modal

  async function makeModal() {
    modal = document.createElement('app-modal')
    modal.heading = 'Song info'
    modal.innerHTML = '<p id="inside">Content</p>'
    document.body.appendChild(modal)
    await modal.updateComplete
    return modal
  }

  const dialog = () => modal.shadowRoot.querySelector('dialog')

  /** Open the modal and wait for it to be shown */
  async function show() {
    modal.show()
    await modal.updateComplete
  }

  afterEach(() => modal?.remove())

  it('opens as a modal dialog in the top layer', async () => {
    await makeModal()
    expect(dialog().open).to.equal(false)
    await show()
    expect(dialog().matches(':modal')).to.equal(true)
    expect(dialog().getAttribute('aria-labelledby')).to.equal('modal-title')
    expect(modal.shadowRoot.getElementById('modal-title').textContent).to.equal('Song info')
  })

  it('closes on Esc, firing close once', async () => {
    await makeModal()
    let closes = 0
    modal.addEventListener('app-modal:close', () => closes++)
    await show()
    await sendKeys({ press: 'Escape' })
    await modal.updateComplete
    expect(modal.open).to.equal(false)
    expect(dialog().open).to.equal(false)
    expect(closes).to.equal(1)
  })

  it('closes on a backdrop click, but not on a click inside', async () => {
    await makeModal()
    await show()
    const box = modal.querySelector('#inside').getBoundingClientRect()
    await sendMouse({
      type: 'click',
      position: [Math.round(box.left + 5), Math.round(box.top + 5)],
    })
    expect(modal.open).to.equal(true)

    await sendMouse({ type: 'click', position: [2, 2] })
    await modal.updateComplete
    expect(modal.open).to.equal(false)
    expect(dialog().open).to.equal(false)
  })

  it('closes from close(), firing close once', async () => {
    await makeModal()
    let closes = 0
    modal.addEventListener('app-modal:close', () => closes++)
    await show()
    modal.close()
    await modal.updateComplete
    expect(dialog().open).to.equal(false)
    expect(closes).to.equal(1)
  })

  it('is accessible when open', async () => {
    await makeModal()
    await show()
    await expect(modal).to.be.accessible(A11Y)
  })
})

describe('app-modal layout', () => {
  let modal: HTMLElementTagNameMap['app-modal']

  async function make(setup: (modal: HTMLElementTagNameMap['app-modal']) => void = () => {}) {
    modal = document.createElement('app-modal')
    setup(modal)
    document.body.appendChild(modal)
    await modal.updateComplete
    return modal
  }
  const root = () => modal.shadowRoot as ShadowRoot
  const dialog = () => root().querySelector('dialog') as HTMLDialogElement

  afterEach(() => modal?.remove())

  it('has a floating close button and no header when it has no heading or header', async () => {
    await make()
    expect(dialog().classList.contains('headerless')).to.equal(true)
    expect(root().querySelector('.modal-header')).to.equal(null)
    expect(root().querySelector('.modal-close.floating')).to.not.equal(null)
  })

  it('has a header with the heading and a close button when it has a heading', async () => {
    await make(m => {
      m.heading = 'Song info'
    })
    expect(dialog().classList.contains('headerless')).to.equal(false)
    expect(root().querySelector('.modal-header .modal-close')).to.not.equal(null)
    expect(root().querySelector('.modal-close.floating')).to.equal(null)
  })

  it('shows a header it is given in place of a heading', async () => {
    await make(m => {
      m.innerHTML = '<div slot="header">My header</div>'
    })
    expect(root().querySelector('.modal-header slot[name="header"]')).to.not.equal(null)
    expect(root().querySelector('#modal-title')).to.equal(null)
  })

  it('leaves the close button out when asked to', async () => {
    await make(m => {
      m.heading = 'Song info'
      m.hideCloseButton = true
    })
    expect(root().querySelector('.modal-close')).to.equal(null)
  })

  it('shows the actions it is given, and no buttons of its own for a plain modal', async () => {
    await make(m => {
      m.heading = 'Song info'
      m.innerHTML = '<button slot="actions">Do it</button>'
    })
    expect(root().querySelector('.modal-actions slot[name="actions"]')).to.not.equal(null)
    await make(m => {
      m.heading = 'Song info'
    })
    expect(root().querySelector('.modal-actions')).to.equal(null)
  })

  it('opens and closes by turns with toggle()', async () => {
    await make(m => {
      m.heading = 'Song info'
    })
    modal.toggle()
    await modal.updateComplete
    expect(modal.open).to.equal(true)
    modal.toggle()
    await modal.updateComplete
    expect(modal.open).to.equal(false)
  })

  it('closes only for a click on the backdrop: outside the box of the dialog on any side', async () => {
    await make(m => {
      m.heading = 'Song info'
    })
    modal.show()
    await modal.updateComplete
    const box = dialog().getBoundingClientRect()
    const clickAt = (x: number, y: number) => {
      modal.open = true
      dialog().dispatchEvent(new MouseEvent('click', { clientX: x, clientY: y }))
      return modal.open
    }
    const inside = clickAt(box.left + 5, box.top + 5)
    expect(inside, 'inside the box').to.equal(true)
    expect(clickAt(box.left - 5, box.top + 5), 'left of it').to.equal(false)
    expect(clickAt(box.right + 5, box.top + 5), 'right of it').to.equal(false)
    expect(clickAt(box.left + 5, box.top - 5), 'above it').to.equal(false)
    expect(clickAt(box.left + 5, box.bottom + 5), 'below it').to.equal(false)
  })
})
