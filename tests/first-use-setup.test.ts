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
    // (singer, guitarist, another instrument: Custom is for Preferences)
    expect(root().querySelectorAll('input[type="radio"]').length).to.equal(3)
    expect(root().querySelector('legend').textContent).to.equal('What do you play?')
  })

  it('saves the choice as it is made, with the switches it stands for', async () => {
    await setUp()
    const [singer, guitarist, other] = root().querySelectorAll('input[type="radio"]')
    singer.click()
    expect(localStorage.getItem('musician_type')).to.equal('singer')
    expect(JSON.parse(localStorage.getItem('section_defaults') ?? '')).to.deep.equal({
      all: 'lyrics',
    })
    guitarist.click()
    expect(localStorage.getItem('musician_type')).to.equal('guitarist')
    expect(localStorage.getItem('enable_capo')).to.equal('true')
    expect(JSON.parse(localStorage.getItem('section_defaults') ?? '')).to.deep.equal({ all: 'all' })
    other.click()
    expect(localStorage.getItem('musician_type')).to.equal('general')
    expect(localStorage.getItem('enable_capo')).to.equal('false')
  })

  it('shows what is already chosen', async () => {
    localStorage.setItem('enable_capo', 'true')
    await setUp()
    const [, guitarist] = root().querySelectorAll('input[type="radio"]')
    expect(guitarist.checked).to.equal(true)
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
