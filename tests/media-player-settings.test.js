import { expect } from '@esm-bundle/chai'
import '../public/components/media-player-settings.js'

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

    settings.padSets = [
      { id: 'builtin', name: 'Built-in Pads' },
      { id: 'drive-warm', name: 'Warm Pads' },
    ]
    settings.selectedPadSetId = 'drive-warm'
    await settings.updateComplete

    const select = settings.shadowRoot.querySelector('select')
    expect(select.value).to.equal('drive-warm')
  })
})
