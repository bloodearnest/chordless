import { expect } from '@open-wc/testing'
import {
  canPlayAudio,
  loadMediaPlayer,
  startMediaPlayer,
  wantsMediaPlayer,
  wantsPads,
} from '../src/js/media-player-loader.ts'
import { preloadPadKeys } from '../src/js/pad-set-service.ts'
import { makePadSet } from './builders.ts'
import { suppressConsoleLogs } from './test-helpers.ts'

const { describe, it, afterEach } = window

/** A Storage with the media settings in it */
const storageWith = (settings: object | null) => ({
  getItem: (key: string) =>
    key === 'media-settings' && settings ? JSON.stringify(settings) : null,
})
const withAudio = { AudioContext: class {} }
const withOldAudio = { webkitAudioContext: class {} }
const withoutAudio = {}

describe('canPlayAudio', () => {
  it('needs Web Audio, standard or prefixed', () => {
    expect(canPlayAudio(withAudio)).to.equal(true)
    expect(canPlayAudio(withOldAudio)).to.equal(true)
    expect(canPlayAudio(withoutAudio)).to.equal(false)
  })
})

describe('wantsMediaPlayer and wantsPads', () => {
  // [what, the device, the saved settings, wants the player, wants pads]
  const cases: [string, object, object | null, boolean, boolean][] = [
    ['audio and no settings saved: both on', withAudio, null, true, true],
    ['the player switched off', withAudio, { mediaPlayerEnabled: false }, false, false],
    ['pads switched off, the player on', withAudio, { padsEnabled: false }, true, false],
    ['no Web Audio: neither, whatever the settings', withoutAudio, null, false, false],
    ['prefixed Web Audio is enough', withOldAudio, null, true, true],
  ]
  for (const [what, win, settings, player, pads] of cases) {
    it(what, () => {
      const options = { win, storage: storageWith(settings) }
      expect(wantsMediaPlayer(options)).to.equal(player)
      expect(wantsPads(options)).to.equal(pads)
    })
  }
})

describe('loadMediaPlayer', () => {
  suppressConsoleLogs()

  it('says it loaded', async () => {
    expect(await loadMediaPlayer(async () => {})).to.equal(true)
  })

  it('loads the player itself by default, which defines its element', async () => {
    expect(await loadMediaPlayer()).to.equal(true)
    expect(customElements.get('media-player')).to.be.ok
  })

  it('carries on if the module cannot be loaded, saying so', async () => {
    const warnings: unknown[][] = []
    const original = console.warn
    console.warn = (...args) => warnings.push(args)
    try {
      expect(
        await loadMediaPlayer(async () => {
          throw new SyntaxError('Unexpected token')
        })
      ).to.equal(false)
    } finally {
      console.warn = original
    }
    expect(warnings).to.have.length(1)
  })
})

describe('startMediaPlayer', () => {
  let loads
  const load = async () => {
    loads++
  }
  const start = options => {
    loads = 0
    return startMediaPlayer({ load, doc: document.createElement('div'), ...options })
  }

  it('loads the player when it is wanted', async () => {
    expect(await start({ win: withAudio, storage: storageWith(null) })).to.equal(true)
    expect(loads).to.equal(1)
  })

  it('does not load it when it is switched off, nor on a device without Web Audio', async () => {
    expect(
      await start({ win: withAudio, storage: storageWith({ mediaPlayerEnabled: false }) })
    ).to.equal(false)
    expect(await start({ win: withoutAudio, storage: storageWith(null) })).to.equal(false)
    expect(loads).to.equal(0)
  })

  it('loads it when it is switched on later, once', async () => {
    const doc = document.createElement('div')
    let settings = { mediaPlayerEnabled: false }
    const storage = { getItem: () => JSON.stringify(settings) }
    await start({ win: withAudio, storage, doc })
    expect(loads).to.equal(0)

    // Another setting changes: still off
    doc.dispatchEvent(new Event('media-player-settings:change'))
    expect(loads).to.equal(0)

    settings = { mediaPlayerEnabled: true }
    doc.dispatchEvent(new Event('media-player-settings:change'))
    doc.dispatchEvent(new Event('media-player-settings:change'))
    await Promise.resolve()
    expect(loads).to.equal(1)
  })

  it('does not wait for the switch on a device that could not use it anyway', async () => {
    const doc = document.createElement('div')
    await start({ win: withoutAudio, storage: storageWith(null), doc })
    doc.dispatchEvent(new Event('media-player-settings:change'))
    expect(loads).to.equal(0)
  })
})

describe('preloading pads', () => {
  const drive = makePadSet({ id: 'a-pad-set' })
  let originalSetTimeout
  let originalSettings

  afterEach(() => {
    window.setTimeout = originalSetTimeout ?? window.setTimeout
    if (originalSettings === null) localStorage.removeItem('media-settings')
    else if (originalSettings !== undefined)
      localStorage.setItem('media-settings', originalSettings)
  })

  /** Run with these settings saved and timers held back, so no fetching starts */
  function preload(settings, keys = ['C', 'G'], padSet = drive) {
    originalSettings = localStorage.getItem('media-settings')
    originalSetTimeout = window.setTimeout
    ;(window as { setTimeout: unknown }).setTimeout = () => 0
    if (settings) localStorage.setItem('media-settings', JSON.stringify(settings))
    else localStorage.removeItem('media-settings')
    return preloadPadKeys(keys, padSet)
  }

  it('sets about fetching each key of a Drive pad set when the player and pads are on', () => {
    expect(preload(null)).to.equal(2)
  })

  it('does nothing when the player is switched off', () => {
    expect(preload({ mediaPlayerEnabled: false })).to.equal(0)
  })

  it('does nothing when pads are switched off', () => {
    expect(preload({ padsEnabled: false })).to.equal(0)
  })

  it('does nothing for a pad set that is not on Drive', () => {
    expect(preload(null, ['C'], makePadSet({ id: 'built-in', type: 'builtin' }))).to.equal(0)
  })

  it('does nothing without keys', () => {
    expect(preload(null, [])).to.equal(0)
  })
})
