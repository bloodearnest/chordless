import { expect } from '@esm-bundle/chai'
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
