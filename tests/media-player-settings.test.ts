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

  async function show() {
    localStorage.removeItem('media-settings')
    settings = document.createElement('media-player-settings')
    document.body.appendChild(settings)
    await settings.updateComplete
    await new Promise(resolve => setTimeout(resolve, 50))
    return settings
  }
  const switchFor = (label: string) =>
    settings.shadowRoot.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement
  const saved = () => JSON.parse(localStorage.getItem('media-settings') ?? '{}')

  it('saves each switch, and greys out what depends on the player being on', async () => {
    await show()
    const before = { ...saved() }
    for (const [label, key] of [
      ['Enable Pads', 'padsEnabled'],
      ['Enable Metronome', 'metronomeEnabled'],
      ['Stereo Split (L/R)', 'stereoSplitEnabled'],
      ['Double the click for slow songs', 'autoDoubleClick'],
    ] as const) {
      // Off and on again: a switch under one that is off cannot be pressed
      for (let press = 0; press < 2; press++) {
        const was = settings[key]
        switchFor(label).click()
        await settings.updateComplete
        expect(settings[key], label).to.equal(!was)
        expect(saved()[key], label).to.equal(!was)
      }
    }
    expect(before).to.not.equal(undefined)

    const player = settings.shadowRoot.querySelector(
      '[aria-label="Enable Media Player"]'
    ) as HTMLButtonElement
    const wasEnabled = settings.mediaPlayerEnabled
    player.click()
    await settings.updateComplete
    expect(saved().mediaPlayerEnabled).to.equal(!wasEnabled)
    const disabled = settings.shadowRoot.querySelectorAll('.setting-item.disabled').length
    player.click()
    await settings.updateComplete
    expect(settings.shadowRoot.querySelectorAll('.setting-item.disabled').length).to.not.equal(
      disabled
    )
    localStorage.removeItem('media-settings')
  })

  it('shows what the pad sets are doing: preparing, or an error', async () => {
    await show()
    settings._padSets.switching = true
    settings._padSets.error = 'Could not load'
    settings.requestUpdate()
    await settings.updateComplete
    expect(settings.shadowRoot.textContent).to.contain('Preparing pad set')
    expect(settings.shadowRoot.querySelector('.padset-message.error').textContent).to.contain(
      'Could not load'
    )
    localStorage.removeItem('media-settings')
  })

  it('puts the pad set selection back when a pad set cannot be switched to', async () => {
    await show()
    settings._padSets.list = [
      { id: 'builtin', name: 'Built-in Pads' },
      { id: 'drive-warm', name: 'Warm Pads' },
    ]
    settings._padSets.activeId = 'builtin'
    settings._padSets.select = async () => {
      throw new Error('no network')
    }
    settings.requestUpdate()
    await settings.updateComplete
    const select = settings.shadowRoot.querySelector('select') as HTMLSelectElement
    select.value = 'drive-warm'
    select.dispatchEvent(new Event('change'))
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(select.value).to.equal('builtin')
    localStorage.removeItem('media-settings')
  })
})
