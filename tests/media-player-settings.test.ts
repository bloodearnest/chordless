import { expect } from '@open-wc/testing'
import '../src/components/media-player-settings.ts'
import { A11Y } from './test-helpers.ts'

const { describe, it, afterEach } = window

describe('media-player-settings', () => {
  let settings

  afterEach(() => settings?.remove())

  it('saves the click settings, and says so', async () => {
    localStorage.removeItem('media-settings')
    settings = document.createElement('media-player-settings')
    document.body.appendChild(settings)
    await settings.updateComplete
    const heard: unknown[] = []
    document.addEventListener('media-player-settings:change', event =>
      heard.push((event as Event & { settings: unknown }).settings)
    )

    const downbeat = settings.shadowRoot.querySelector('[aria-label="Emphasise downbeat"]')
    expect(downbeat.getAttribute('aria-checked')).to.equal('true')
    downbeat.click()
    await settings.updateComplete
    expect(downbeat.getAttribute('aria-checked')).to.equal('false')

    const below = settings.shadowRoot.querySelector('#double-click-below-bpm')
    expect(below.value).to.equal('72')
    below.value = '75'
    below.dispatchEvent(new Event('input'))
    // A half-typed number is left alone
    below.value = '7'
    below.dispatchEvent(new Event('input'))

    const saved = JSON.parse(localStorage.getItem('media-settings') ?? '{}')
    expect(saved).to.include({ emphasiseDownbeat: false, doubleClickBelowBpm: 75 })
    expect(heard).to.have.length(2)
    localStorage.removeItem('media-settings')
  })

  it('shows the chosen pad set when the list of pad sets arrives with it', async () => {
    settings = document.createElement('media-player-settings')
    document.body.appendChild(settings)
    await settings.updateComplete
    // Let its own loading of the pad sets finish first
    await new Promise(resolve => setTimeout(resolve, 50))

    // As if the pad sets just loaded, with Warm Pads the active one
    settings._padSets.list = [
      { id: 'builtin', name: 'Built-in Pads' },
      { id: 'drive-warm', name: 'Warm Pads' },
    ]
    settings._padSets.activeId = 'drive-warm'
    settings.requestUpdate()
    await settings.updateComplete

    const select = settings.shadowRoot.querySelector('select')
    expect(select.value).to.equal('drive-warm')
  })

  it('is accessible', async () => {
    settings = document.createElement('media-player-settings')
    document.body.appendChild(settings)
    await settings.updateComplete
    await expect(settings).to.be.accessible(A11Y)
  })
})
