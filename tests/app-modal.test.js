import { expect } from '@esm-bundle/chai'
import { sendKeys, sendMouse } from '@web/test-runner-commands'
import '../public/components/app-modal.js'

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
})
