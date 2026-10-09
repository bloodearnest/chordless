import { expect } from '@open-wc/testing'
import '../public/components/media-player-settings.js'
import { A11Y } from './test-helpers.js'

const { describe, it, afterEach } = window

describe('media-player-settings', () => {
  let settings

  afterEach(() => settings?.remove())

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
