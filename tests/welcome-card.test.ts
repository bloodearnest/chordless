import { expect, waitUntil } from '@open-wc/testing'
import '../src/components/welcome-card.ts'
import { INSTALL_CHANGE_EVENT } from '../src/js/install.ts'
import { A11Y } from './test-helpers.ts'

const { describe, it, afterEach } = window

describe('welcome-card', () => {
  let card

  async function setUp() {
    card = document.createElement('welcome-card')
    document.body.appendChild(card)
    await card.updateComplete
    return card
  }

  afterEach(() => card?.remove())

  const root = () => card.shadowRoot

  it('says what Chordless is and offers the next steps', async () => {
    await setUp()
    expect(root().querySelector('h2').textContent).to.contain('Welcome to Chordless')
    expect(root().querySelector('#welcome-samples button').textContent).to.contain('sample setlist')
    expect(root().querySelector('#welcome-songs a[href="/import-song"]')).to.not.equal(null)
    expect(root().querySelector('#welcome-songs a[href="/bookmarklet"]')).to.not.equal(null)
    expect(root().querySelector('#welcome-sign-in a[href="/storage"]')).to.not.equal(null)
  })

  it('shows the install step only when there is a way to install, and says why', async () => {
    await setUp()
    // (The test browser is neither installed nor offered a prompt, so the card follows the mode)
    card._installMode = 'ios'
    await card.updateComplete
    const install = root().querySelector('#welcome-install')
    expect(install.textContent).to.contain('Add to Home Screen')
    expect(install.textContent).to.contain('clear the saved data')
    expect(install.textContent).to.contain('sign in again')

    card._installMode = 'prompt'
    await card.updateComplete
    expect(root().querySelector('#welcome-install button').textContent).to.contain('Install')
    expect(root().querySelector('#welcome-install').textContent).to.not.contain('sign in again')

    for (const mode of ['installed', 'none']) {
      card._installMode = mode
      await card.updateComplete
      expect(root().querySelector('#welcome-install'), mode).to.equal(null)
    }
  })

  it('follows the install state when the browser reports a change', async () => {
    await setUp()
    card._installMode = 'ios'
    await card.updateComplete
    window.dispatchEvent(new Event(INSTALL_CHANGE_EVENT))
    await waitUntil(() => card._installMode !== 'ios')
  })

  it('is accessible', async () => {
    await setUp()
    card._installMode = 'ios'
    await card.updateComplete
    await expect(card).to.be.accessible(A11Y)
  })
})
