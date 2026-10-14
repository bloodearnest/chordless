import { expect } from '@open-wc/testing'
import '../src/components/first-use-setup.ts'
import { A11Y } from './test-helpers.ts'

const { describe, it, beforeEach, afterEach } = window

describe('first-use-setup', () => {
  let setup

  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    setup?.remove()
    localStorage.clear()
  })

  async function setUp() {
    setup = document.createElement('first-use-setup')
    document.body.appendChild(setup)
    await setup.updateComplete
    return setup
  }

  const root = () => setup.shadowRoot

  it('opens a modal with the choices', async () => {
    await setUp()
    expect(root().querySelector('app-modal').open).to.equal(true)
    expect(root().querySelectorAll('input[type="radio"]').length).to.equal(2)
    expect(root().querySelector('input[type="checkbox"]')).to.not.equal(null)
  })

  it('saves the choices as they are made', async () => {
    await setUp()
    const lyrics = root().querySelectorAll('input[type="radio"]')[1]
    lyrics.click()
    expect(localStorage.getItem('musician_type')).to.equal('singer')
    root().querySelector('input[type="checkbox"]').click()
    expect(localStorage.getItem('enable_capo')).to.equal('true')
  })

  it('marks the setup done and goes away when closed', async () => {
    await setUp()
    root().querySelector('.actions .primary').click()
    expect(localStorage.getItem('setup-done')).to.equal('1')
    expect(setup.isConnected).to.equal(false)
  })

  it('is accessible', async () => {
    await setUp()
    await expect(setup).to.be.accessible(A11Y)
  })
})
