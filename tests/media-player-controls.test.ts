/**
 * The media player's own controls: what it does with the settings, dragging it about, the volume
 * knobs, and what it shows. (Starting and stopping songs is in media-player-playback.test.ts.)
 */
import { expect } from '@open-wc/testing'
import '../src/components/media-player.ts'
import type { MediaPlayer } from '../src/components/media-player.ts'
import { MediaSettingsChangeEvent } from '../src/components/media-player-settings.ts'
import { SongChangeEvent } from '../src/js/app-events.ts'
import { RouteChangeEvent } from '../src/js/app-router.ts'
import { ensurePadSetFolder } from '../src/js/drive-api.ts'
import { normalizeTempoNote } from '../src/js/metronome-controller.ts'
import { PadAudioController } from '../src/js/pad-audio-controller.ts'
import { listPadSets, PadSetChangedEvent } from '../src/js/pad-set-service.ts'
import { installFakeDrive } from './fake-drive.ts'
import { suppressConsoleLogs, wait } from './test-helpers.ts'

const { describe, it, afterEach } = window

suppressConsoleLogs()

class FakePads {
  log: string[] = []
  isPlaying = false
  loadFailed = false
  isLoading = false
  volumes: number[] = []
  modes: string[] = []
  async loadPad(key: string) {
    this.log.push(`load ${key}`)
    return true
  }
  async play() {
    this.isPlaying = true
  }
  async stop() {
    this.isPlaying = false
  }
  async crossfadeTo() {}
  setVolume(volume: number) {
    this.volumes.push(volume)
  }
  setStereoMode(mode: string) {
    this.modes.push(mode)
  }
  cleanup() {
    this.log.push('cleanup')
  }
}

class FakeMetronome {
  log: string[] = []
  volumes: number[] = []
  emphasis: boolean[] = []
  start() {
    this.log.push('start')
    return true
  }
  stop() {
    this.log.push('stop')
  }
  setVolume(volume: number) {
    this.volumes.push(volume)
  }
  setEmphasiseDownbeat(on: boolean) {
    this.emphasis.push(on)
  }
  cleanup() {
    this.log.push('cleanup')
  }
}

const STORAGE = [
  'media-player-pads-on',
  'media-player-click-on',
  'media-player-collapsed',
  'media-player-position',
  'pad-volume',
  'click-volume',
  'padset-selection',
  'media-settings',
]

describe('the media player', () => {
  let player: MediaPlayer
  let pads: FakePads
  let click: FakeMetronome

  const settings = (over: Record<string, unknown> = {}) =>
    new MediaSettingsChangeEvent({
      mediaPlayerEnabled: true,
      padsEnabled: true,
      metronomeEnabled: true,
      stereoSplitEnabled: false,
      autoDoubleClick: true,
      doubleClickBelowBpm: 72,
      emphasiseDownbeat: true,
      ...over,
    } as never)

  async function show({ collapsed = false } = {}) {
    for (const key of STORAGE) localStorage.removeItem(key)
    localStorage.setItem('media-player-collapsed', String(collapsed))
    player = document.createElement('media-player')
    document.body.append(player)
    await player.updateComplete
    pads = new FakePads()
    click = new FakeMetronome()
    // (the audio context is the real one, which the click's routing is made in)
    player._padController = pads as never
    player._metronomeController = click as never
    return player
  }
  const $ = (selector: string) => player.shadowRoot?.querySelector<HTMLElement>(selector) ?? null

  afterEach(() => {
    player?.remove()
    for (const key of STORAGE) localStorage.removeItem(key)
  })

  describe('the settings', () => {
    it('hides the whole player while it is turned off, and shows it again', async () => {
      await show()
      document.dispatchEvent(settings({ mediaPlayerEnabled: false }))
      expect(player.style.display).to.equal('none')
      document.dispatchEvent(settings())
      expect(player.style.display).to.equal('')
    })

    it('keeps the one thing that is left on, on', async () => {
      await show()
      player._clickOn = false
      document.dispatchEvent(settings({ padsEnabled: false }))
      expect(player._clickOn).to.equal(true)
      player._padsOn = false
      document.dispatchEvent(settings({ metronomeEnabled: false }))
      expect(player._padsOn).to.equal(true)
    })

    it('passes the downbeat choice on, and the stereo split', async () => {
      await show()
      document.dispatchEvent(settings({ emphasiseDownbeat: false, stereoSplitEnabled: true }))
      expect(click.emphasis.at(-1)).to.equal(false)
      expect(pads.modes.at(-1)).to.equal('left')
      document.dispatchEvent(settings({ stereoSplitEnabled: false }))
      expect(pads.modes.at(-1)).to.equal('both')
    })

    it('stops a click that is running when it is turned off in the settings', async () => {
      await show()
      player._metronomeRunning = true
      document.dispatchEvent(settings({ metronomeEnabled: false }))
      expect(click.log).to.include('stop')
      expect(player._metronomeRunning).to.equal(false)
    })

    it('restarts a running click when the tempo threshold changes how it is doubled', async () => {
      await show()
      player._metronomeRunning = true
      player._activeSongBpm = 90
      player._activeDoubleClick = false
      let restarts = 0
      player._startSong = async () => {
        restarts++
      }
      document.dispatchEvent(settings({ doubleClickBelowBpm: 100 }))
      expect(restarts).to.equal(1)
    })

    it('says so when restarting the click fails', async () => {
      await show()
      player._metronomeRunning = true
      player._activeSongBpm = 90
      player._activeDoubleClick = false
      player._startSong = async () => {
        throw new Error('no audio')
      }
      document.dispatchEvent(settings({ doubleClickBelowBpm: 100 }))
      await wait(10)
    })

    it('is opened, and closed by its own close and not one from inside it', async () => {
      await show()
      $('.title-bar-button[title="Settings"]')?.click()
      await player.updateComplete
      expect(player._showingSettings).to.equal(true)
      expect($('media-player-settings')).to.not.equal(null)
      const modal = $('app-modal') as HTMLElement
      modal.dispatchEvent(new CustomEvent('app-modal:close', { bubbles: true }))
      expect(player._showingSettings).to.equal(false)
      player._showingSettings = true
      player._closeSettings({ target: {}, currentTarget: modal } as unknown as Event)
      expect(player._showingSettings).to.equal(true)
    })
  })

  describe('the pad set', () => {
    it('is looked up again when it changes, and the pads get ready if they are off', async () => {
      await show()
      player._padsOn = false
      player.currentKey = 'G'
      player._padLoadFailed = true
      window.dispatchEvent(new PadSetChangedEvent({ id: 'drive-pads', name: 'Pads' }))
      await wait(20)
      expect(player._padLoadFailed).to.equal(false)
      expect(pads.log).to.include('load G')
    })

    it('is left alone when the pads are on', async () => {
      await show()
      player._padsOn = true
      await player._handlePadSetChange()
      expect(pads.log).to.deep.equal([])
    })

    it('says so when the pad source cannot be got ready', async () => {
      await show()
      player._padsOn = false
      player._updateAudioSource = async () => {
        throw new Error('no pad')
      }
      await player._handlePadSetChange()
      await wait(10)
    })
  })

  describe('the song it is shown', () => {
    it('keeps the tempo, its note and the time of the song, whatever it says', async () => {
      await show()
      await player._handleSongChange(
        new SongChangeEvent({
          songId: 'a',
          title: 'A',
          metadata: { key: 'G', tempo: 0, tempoNote: '', timeSignature: '' },
        } as never)
      )
      expect(player._currentBpm).to.equal(null)
      expect(player._currentTempoNote).to.equal('1/4')
      expect(player._currentTimeSignature).to.equal(null)
      await player._handleSongChange(new SongChangeEvent(null as never))
      expect(player.currentKey).to.equal(null)
    })

    it('restarts what plays when the song that plays changes under it', async () => {
      await show()
      player._activeSongId = 'a'
      player._activeSongKey = 'G'
      pads.isPlaying = true
      player._padsOn = true
      let restarts = 0
      player._startSong = async () => {
        restarts++
      }
      await player._handleSongChange(
        new SongChangeEvent({
          songId: 'a',
          title: 'A',
          metadata: { key: 'D', tempo: 100 },
        } as never)
      )
      expect(restarts).to.equal(1)
    })

    it('says so when restarting fails', async () => {
      await show()
      player._activeSongId = 'a'
      player._activeSongKey = 'G'
      pads.isPlaying = true
      player._padsOn = true
      player._startSong = async () => {
        throw new Error('no audio')
      }
      await player._handleSongChange(
        new SongChangeEvent({
          songId: 'a',
          title: 'A',
          metadata: { key: 'D', tempo: 100 },
        } as never)
      )
      await wait(10)
    })

    it('draws again when the page changes, as that decides what it offers', async () => {
      await show()
      let renders = 0
      const render = player.render.bind(player)
      player.render = () => {
        renders++
        return render()
      }
      document.dispatchEvent(new RouteChangeEvent({ name: 'storage' } as never, null))
      await player.updateComplete
      expect(renders).to.equal(1)
    })
  })

  describe('the pill and the full player', () => {
    it('is collapsed or expanded, and remembers which', async () => {
      await show({ collapsed: true })
      expect($('.collapsed-pill')).to.not.equal(null)
      ;($('[aria-label="Expand player"]') as HTMLButtonElement).click()
      await player.updateComplete
      expect($('.player')).to.not.equal(null)
      expect(localStorage.getItem('media-player-collapsed')).to.equal('false')
      $('.title-bar-button[title="Minimize"]')?.click()
      await player.updateComplete
      expect(localStorage.getItem('media-player-collapsed')).to.equal('true')
    })

    it('has pads on and off, remembered', async () => {
      await show()
      $('.led-button[title="Toggle pads on/off"]')?.click()
      expect(player._padsOn).to.equal(false)
      expect(localStorage.getItem('media-player-pads-on')).to.equal('false')
    })

    it('has the click on and off', async () => {
      await show()
      const was = player._clickOn
      $('.led-button[title="Toggle click on/off"]')?.click()
      expect(player._clickOn).to.equal(!was)
    })
  })

  describe('being moved', () => {
    const mouse = (type: string, x: number, y: number) =>
      new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true })
    const touch = (type: string, x: number, y: number) =>
      new TouchEvent(type, {
        touches: [new Touch({ identifier: 1, target: document.body, clientX: x, clientY: y })],
        bubbles: true,
        cancelable: true,
      })

    it('follows the mouse by its title bar, and remembers where it was left', async () => {
      await show()
      $('.title-bar')?.dispatchEvent(mouse('mousedown', 100, 100))
      document.dispatchEvent(mouse('mousemove', 130, 90))
      await player.updateComplete
      expect($('.player')?.getAttribute('style')).to.contain('translate(30px, -10px)')
      document.dispatchEvent(mouse('mouseup', 130, 90))
      expect(JSON.parse(localStorage.getItem('media-player-position') ?? '')).to.deep.equal({
        x: 30,
        y: -10,
      })
      document.dispatchEvent(mouse('mousemove', 500, 500))
      expect(player._dragOffsetX).to.equal(30)
    })

    it('follows a finger, too', async () => {
      await show()
      $('.title-bar')?.dispatchEvent(touch('touchstart', 50, 50))
      document.dispatchEvent(touch('touchmove', 60, 70))
      expect(player._dragOffsetX).to.equal(10)
      expect(player._dragOffsetY).to.equal(20)
      document.dispatchEvent(touch('touchend', 60, 70))
    })

    it('is not dragged by pressing one of its buttons', async () => {
      await show()
      $('.title-bar-button')?.dispatchEvent(mouse('mousedown', 10, 10))
      document.dispatchEvent(mouse('mousemove', 40, 40))
      expect(player._dragOffsetX).to.equal(0)
    })

    it('starts where it was left', async () => {
      localStorage.setItem('media-player-position', JSON.stringify({ x: 12, y: 34 }))
      player = document.createElement('media-player')
      expect(player._dragOffsetX).to.equal(12)
      expect(player._dragOffsetY).to.equal(34)
    })
  })

  describe('the volume knobs', () => {
    const mouse = (type: string, y: number) =>
      new MouseEvent(type, { clientX: 5, clientY: y, bubbles: true, cancelable: true })

    it('turn with the mouse going up and down, and keep the volume', async () => {
      await show()
      const padKnob = $('.volume-knob[title="Pad Volume"]') as HTMLElement
      padKnob.dispatchEvent(mouse('mousedown', 300))
      await player.updateComplete
      expect(padKnob.classList.contains('dragging')).to.equal(true)
      document.dispatchEvent(mouse('mousemove', 200))
      expect(player._padVolume).to.be.closeTo(1, 0.001)
      document.dispatchEvent(mouse('mousemove', 800))
      expect(player._padVolume).to.equal(0)
      expect(pads.volumes.at(-1)).to.equal(0)
      expect(localStorage.getItem('pad-volume')).to.equal('0')
      document.dispatchEvent(mouse('mouseup', 800))
      await player.updateComplete
      expect(player._showingVolumeSlider).to.equal(false)
      expect(player._activeVolumeControl).to.equal(null)
    })

    it('turn the click’s too, and a finger does as well', async () => {
      await show()
      const clickKnob = $('.volume-knob[title="Click Volume"]') as HTMLElement
      clickKnob.dispatchEvent(
        new TouchEvent('touchstart', {
          touches: [new Touch({ identifier: 1, target: clickKnob, clientX: 5, clientY: 100 })],
          bubbles: true,
          cancelable: true,
        })
      )
      document.dispatchEvent(
        new TouchEvent('touchmove', {
          touches: [new Touch({ identifier: 1, target: clickKnob, clientX: 5, clientY: 160 })],
          bubbles: true,
          cancelable: true,
        })
      )
      expect(player._clickVolume).to.be.lessThan(0.8)
      expect(click.volumes.at(-1)).to.equal(player._clickVolume)
      expect(localStorage.getItem('click-volume')).to.be.a('string')
      await player.updateComplete
      expect(clickKnob.classList.contains('dragging')).to.equal(true)
      document.dispatchEvent(new TouchEvent('touchend', { bubbles: true }))
    })

    it('are not turned by a mouse that is not on one', async () => {
      await show()
      const event = mouse('mousemove', 10)
      player._handleVolumeMove(event)
      expect(event.defaultPrevented).to.equal(false)
    })

    it('start where the player kept them', async () => {
      localStorage.setItem('pad-volume', '0.25')
      localStorage.setItem('click-volume', '0.6')
      player = document.createElement('media-player')
      expect(player._padVolume).to.equal(0.25)
      expect(player._clickVolume).to.equal(0.6)
    })
  })

  describe('what it shows', () => {
    it('says it is downloading, and a pad it could not load for the key it plays', async () => {
      await show()
      player._isPadLoading = true
      player._padLoadFailed = true
      player._activeSongKey = 'G'
      player._activePadSet = { id: 'drive-pads', name: 'Pads' }
      await player.updateComplete
      expect($('.led-header')?.textContent).to.contain('DOWNLOAD')
      expect($('help-tooltip')?.getAttribute('message')).to.contain('Could not load pad sound')
      expect($('help-tooltip')).to.not.equal(null)
      expect($('.led-value.pad-error')).to.not.equal(null)
    })

    it('says there is no pad set, rather than a pad that failed, when none has been uploaded', async () => {
      await show()
      player._activePadSet = null
      player._padLoadFailed = true
      player._activeSongKey = 'G'
      await player.updateComplete
      expect($('help-tooltip')?.getAttribute('message')).to.contain('No pad set yet')
    })

    it('shows what is playing, and what is next', async () => {
      await show()
      await player._handleSongChange(
        new SongChangeEvent({
          songId: 'b',
          title: 'B',
          metadata: { key: 'D', tempo: 100, timeSignature: '3/4' },
        } as never)
      )
      player._activeSongId = 'a'
      player._activeSongKey = 'G'
      player._activeSongBpm = 90
      player._activeSongTimeSignature = '4/4'
      player._activeSongTitle = 'A'
      await player.updateComplete
      const values = [...(player.shadowRoot?.querySelectorAll('.led-value') ?? [])].map(el =>
        el.textContent?.trim()
      )
      expect(values).to.include.members(['G', 'D', '90', '100', '4/4', '3/4'])
      expect($('.title-bar-content')?.textContent?.trim()).to.equal('A')
    })

    it('has only what is on: no knobs, switches or display with the pads and click both off', async () => {
      await show()
      document.dispatchEvent(settings({ padsEnabled: false, metronomeEnabled: false }))
      player._padsEnabled = false
      player._metronomeGlobalEnabled = false
      await player.updateComplete
      expect($('.led-display-section')).to.equal(null)
      expect($('.knobs-section')).to.equal(null)
      expect($('.toggles-section')).to.equal(null)
      expect($('.speed-button')).to.equal(null)
    })

    it('offers the double-speed click only on a setlist with a song', async () => {
      await show()
      document.body.dataset.view = 'setlist'
      try {
        await player._handleSongChange(
          new SongChangeEvent({
            songId: 'a',
            title: 'A',
            metadata: { key: 'G', tempo: 60 },
          } as never)
        )
        await player.updateComplete
        const button = $('.speed-button') as HTMLButtonElement
        expect(button.disabled).to.equal(false)
        expect(button.getAttribute('aria-pressed')).to.equal('true')
        document.body.dataset.view = 'storage'
        player.requestUpdate()
        await player.updateComplete
        expect(($('.speed-button') as HTMLButtonElement).disabled).to.equal(true)
      } finally {
        delete document.body.dataset.view
      }
    })

    it('is told how many it has on', async () => {
      await show()
      expect(player.isActive).to.equal(false)
      player._metronomeRunning = true
      expect(player.isActive).to.equal(true)
    })
  })

  describe('its tempo note', () => {
    it('is read from a number, a fraction, or words, and is a quarter note when it is nothing', async () => {
      await show()
      expect(normalizeTempoNote(null)).to.equal('1/4')
      expect(normalizeTempoNote(8)).to.equal('1/8')
      expect(normalizeTempoNote('1/8')).to.equal('1/8')
      expect(normalizeTempoNote('3 / 8')).to.equal('3/8')
      expect(normalizeTempoNote('120 (1/8)')).to.equal('1/8')
      expect(normalizeTempoNote('16')).to.equal('1/16')
      expect(normalizeTempoNote('0')).to.equal('1/4')
      expect(normalizeTempoNote('0/4')).to.equal('1/4')
      expect(normalizeTempoNote('quarter')).to.equal('1/4')
    })
  })

  describe('making its audio', () => {
    it('gives up where there is no Web Audio', async () => {
      await show()
      player._audioContext = null
      const real = Object.getOwnPropertyDescriptor(window, 'AudioContext')
      Object.defineProperty(window, 'AudioContext', { value: undefined, configurable: true })
      try {
        expect(() => player._initAudio()).to.throw('Web Audio is not available')
      } finally {
        if (real) Object.defineProperty(window, 'AudioContext', real)
      }
    })

    it('says so when it cannot get a pad ready or a click started without controllers', async () => {
      await show()
      player._padController = null
      player._audioContext = {} as AudioContext
      player.currentKey = 'G'
      expect(await player._updateAudioSource()).to.equal(false)
      player._metronomeController = null
      player._currentBpm = 100
      player._startMetronome()
      expect(player._metronomeRunning).to.equal(false)
      player._stopMetronome()
      expect(await player._crossfadeToNewSong()).to.equal(undefined)
    })
  })

  describe('being taken away', () => {
    it('stops its audio', async () => {
      await show()
      player.remove()
      expect(pads.log).to.include('cleanup')
      expect(click.log).to.include('cleanup')
    })
  })

  describe('when pads cannot be got ready', () => {
    it('says so, rather than failing, when the pad of a key it was given cannot be preloaded', async () => {
      await show()
      player._padsOn = false
      player._updateAudioSource = async () => {
        throw new Error('no pad')
      }
      player.currentKey = 'D'
      await player.updateComplete
      await wait(10)
    })

    it('says so when the pad cannot be loaded as it starts up', async () => {
      const real = PadAudioController.prototype.loadPad
      PadAudioController.prototype.loadPad = () => Promise.reject(new Error('no pad'))
      try {
        const late = document.createElement('media-player')
        late.setAttribute('current-key', 'G')
        document.body.append(late)
        await late.updateComplete
        await wait(10)
        late.remove()
      } finally {
        PadAudioController.prototype.loadPad = real
      }
    })

    it('says so when the pad cannot be preloaded for a song that starts with the pads off', async () => {
      await show()
      player._padsOn = false
      player._updateAudioSource = async () => {
        throw new Error('no pad')
      }
      await player._handleSongChange(
        new SongChangeEvent({
          songId: 'a',
          title: 'A',
          metadata: { key: 'G', tempo: 100 },
        } as never)
      )
      await player._startSong()
      await wait(10)
    })

    it('cannot fade in with no pads to fade', async () => {
      await show()
      player._padController = null
      await player._fadeIn()
      await player._fadeOut()
      expect(player._fadingIn).to.equal(false)
    })

    it('stops the click that is running when it is stopped', async () => {
      await show()
      player._metronomeRunning = true
      await player._stop()
      expect(click.log).to.include('stop')
    })

    it('has no pad knob or pad switch with the pads off, only the click’s', async () => {
      await show()
      player._padsEnabled = false
      player._metronomeGlobalEnabled = true
      await player.updateComplete
      expect($('.volume-knob[title="Pad Volume"]')).to.equal(null)
      expect($('.led-button[title="Toggle pads on/off"]')).to.equal(null)
      expect($('.volume-knob[title="Click Volume"]')).to.not.equal(null)
    })
  })

  describe('what it remembers', () => {
    it('has the pads and click on or off as they were left', async () => {
      localStorage.setItem('media-player-pads-on', 'false')
      localStorage.setItem('media-player-click-on', 'false')
      const remembered = document.createElement('media-player')
      expect(remembered._padsOn).to.equal(false)
      expect(remembered._clickOn).to.equal(false)
    })
  })

  describe('the pad set of a song', () => {
    it('is the song’s own when it is a set on this device', async () => {
      const drive = installFakeDrive()
      try {
        await show()
        const folderId = await ensurePadSetFolder('Warm')
        await listPadSets(true)
        player._currentPadSetId = folderId
        await player._updatePadSetForSong()
        expect(player._activePadSet?.id).to.equal(folderId)
      } finally {
        drive.uninstall()
        localStorage.removeItem('padset-selection')
      }
    })
  })

  describe('guarding itself', () => {
    it('has no pad to load for no key', async () => {
      await show()
      player.currentKey = ''
      expect(await player._updateAudioSource()).to.equal(false)
    })

    it('does nothing to the audio routing before there is any audio', async () => {
      await show()
      player._padController = null
      player._updateStereoMode()
      player._audioContext = null
      player._updateClickRouting()
      expect(pads.modes).to.deep.equal([])
    })
  })
})
