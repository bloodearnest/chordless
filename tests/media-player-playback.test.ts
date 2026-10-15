import { expect } from '@open-wc/testing'
import '../src/components/media-player.ts'
import { SongChangeEvent } from '../src/js/app-events.ts'
import { suppressConsoleLogs } from './test-helpers.ts'

const { describe, it, beforeEach, afterEach } = window

/** The pads, as the player drives them: it keeps a log of what it is asked to do */
class FakePads {
  log: string[] = []
  isPlaying = false
  loadFailed = false
  isLoading = false
  /** What loading a pad or crossfading to one finds */
  padAvailable = true

  async loadPad(key: string, padSet: { id: string }) {
    this.log.push(`load ${key} (${padSet.id})`)
    this.loadFailed = !this.padAvailable
    return this.padAvailable
  }
  async play() {
    this.log.push('play')
    this.isPlaying = true
  }
  async stop() {
    this.log.push('stop')
    this.isPlaying = false
  }
  async crossfadeTo(key: string, padSet: { id: string }) {
    this.log.push(`crossfade ${key} (${padSet.id})`)
    this.loadFailed = !this.padAvailable
    if (this.padAvailable) this.isPlaying = true
  }
  setVolume() {}
  setStereoMode() {}
  cleanup() {}
}

class FakeMetronome {
  log: string[] = []
  start(bpm: number, timeSignature: string, note: string, options: { doubleClick: boolean }) {
    this.log.push(`start ${bpm} ${timeSignature} ${note}${options.doubleClick ? ' double' : ''}`)
    return true
  }
  stop() {
    this.log.push('stop')
  }
  setVolume() {}
  setEmphasiseDownbeat() {}
  cleanup() {}
}

describe('the media player starting a song', () => {
  let player
  let pads: FakePads
  let click: FakeMetronome

  suppressConsoleLogs()

  const song = (songId: string, key: string, tempo = 100) =>
    ({
      songId,
      title: `Song ${songId}`,
      metadata: { key, tempo, tempoNote: '1/4', timeSignature: '4/4' },
    }) as never

  /** Show a song in the player, as moving to it in the setlist does */
  const view = (songId: string, key: string, tempo?: number) =>
    player._handleSongChange(new SongChangeEvent(song(songId, key, tempo)))

  beforeEach(async () => {
    localStorage.removeItem('padset-selection')
    player = document.createElement('media-player')
    document.body.append(player)
    await player.updateComplete
    pads = new FakePads()
    click = new FakeMetronome()
    // An audio context is there, so the player makes none and uses these
    player._audioContext = {}
    player._padController = pads
    player._metronomeController = click
    player._padsOn = true
    player._clickOn = true
  })

  afterEach(() => {
    player.remove()
    localStorage.removeItem('padset-selection')
    localStorage.removeItem('media-player-pads-on')
    localStorage.removeItem('media-player-click-on')
  })

  describe('from nothing', () => {
    it('loads the pad for the key and fades it in, and starts the click at the song tempo', async () => {
      await view('a', 'G', 90)
      await player._startSong()
      expect(pads.log).to.deep.equal(['load G (builtin)', 'play'])
      expect(click.log).to.deep.equal(['start 90 4/4 1/4'])
      expect(player._activeSongKey).to.equal('G')
      expect(player._isCurrentSongActive()).to.equal(true)
    })

    it('does nothing with a song that has no key', async () => {
      await player._handleSongChange(new SongChangeEvent({ songId: 'x', metadata: {} } as never))
      await player._startSong()
      expect(pads.log).to.deep.equal([])
      expect(player._activeSongKey).to.not.be.ok
    })

    it('does not start again for the song that is already playing', async () => {
      await view('a', 'G')
      await player._startSong()
      pads.log.length = 0
      click.log.length = 0
      await player._startSong()
      expect(pads.log).to.deep.equal([])
      expect(click.log).to.deep.equal([])
    })

    it('with the pads off, only gets the pad ready for later', async () => {
      player._padsOn = false
      await view('a', 'G')
      await player._startSong()
      await Promise.resolve()
      expect(pads.log).to.not.include('play')
      expect(pads.log).to.include('load G (builtin)')
      expect(click.log).to.have.length(1)
    })

    it('with the click off, plays the pads alone', async () => {
      player._clickOn = false
      await view('a', 'G')
      await player._startSong()
      expect(pads.log).to.include('play')
      expect(click.log).to.deep.equal([])
    })

    it('does not play a pad it could not find', async () => {
      pads.padAvailable = false
      await view('a', 'G')
      await player._startSong()
      expect(pads.log).to.not.include('play')
      expect(player._padLoadFailed).to.equal(true)
    })
  })

  describe('the next song while one plays', () => {
    beforeEach(async () => {
      await view('a', 'G', 100)
      await player._startSong()
      pads.log.length = 0
      click.log.length = 0
    })

    it('crossfades the pad when the key is different, and retimes the click', async () => {
      await view('b', 'D', 120)
      await player._startSong()
      expect(pads.log).to.deep.equal(['crossfade D (builtin)'])
      expect(click.log).to.deep.equal(['stop', 'start 120 4/4 1/4'])
      expect(player._activeSongKey).to.equal('D')
    })

    it('leaves the pad alone in the same key, and retimes only the click', async () => {
      await view('b', 'G', 120)
      await player._startSong()
      expect(pads.log).to.deep.equal([])
      expect(click.log).to.deep.equal(['stop', 'start 120 4/4 1/4'])
    })

    it('does nothing at all for another song in the same key and tempo', async () => {
      await view('b', 'G', 100)
      await player._startSong()
      expect(pads.log).to.deep.equal([])
      expect(click.log).to.deep.equal([])
    })

    it('crossfades to the pad of another set, in the same key', async () => {
      player._activePadSet = { id: 'church-pads', name: 'Church', type: 'drive' }
      await view('b', 'G', 100)
      // (viewing it chose the device's set again: the song has one of its own)
      player._activePadSet = { id: 'church-pads', name: 'Church', type: 'drive' }
      await player._startSong()
      expect(pads.log).to.deep.equal(['crossfade G (church-pads)'])
    })

    it('switching the pads off fades them out at once, and the next song only gets its pad ready', async () => {
      player._togglePads()
      await Promise.resolve()
      expect(pads.log).to.deep.equal(['stop'])

      pads.log.length = 0
      await view('b', 'D', 100)
      await player._startSong()
      expect(pads.log).to.not.include('play')
      expect(pads.log).to.not.include('crossfade D (builtin)')
    })

    it('switching the click off stops it at once, and the next song does not start it', async () => {
      player._toggleClick()
      expect(click.log).to.deep.equal(['stop'])

      click.log.length = 0
      await view('b', 'G', 120)
      await player._startSong()
      expect(click.log).to.deep.equal([])
    })

    it('turns the pads off when the new key has no pad, so it does not look as if they play', async () => {
      pads.padAvailable = false
      await view('b', 'D', 100)
      await player._startSong()
      expect(player._padLoadFailed).to.equal(true)
      expect(player._padsOn).to.equal(false)
    })

    it('fades back in, rather than crossfading, when it was fading out', async () => {
      player._fadingOut = true
      await view('b', 'D', 100)
      await player._startSong()
      expect(pads.log).to.deep.equal(['play'])
      expect(player._fadingOut).to.equal(false)
    })
  })

  describe('changing the playing song itself', () => {
    it('crossfades to the new key when the key of the song that plays is changed', async () => {
      await view('a', 'G')
      await player._startSong()
      pads.log.length = 0

      // Transposing the song that is playing sends the same song with its new key
      await view('a', 'A')
      await Promise.resolve()
      await Promise.resolve()

      expect(pads.log).to.deep.equal(['crossfade A (builtin)'])
    })

    it('does nothing about another song changing while one plays', async () => {
      await view('a', 'G')
      await player._startSong()
      pads.log.length = 0
      await view('b', 'A')
      await Promise.resolve()
      expect(pads.log).to.deep.equal([])
    })
  })

  describe('play and stop', () => {
    it('needs a key', async () => {
      await player._togglePlay()
      expect(pads.log).to.deep.equal([])
    })

    it('fades the pads in when stopped, and out when on', async () => {
      await view('a', 'G')
      player._padsOn = false
      await player._togglePlay()
      expect(pads.log).to.deep.equal(['play'])
      expect(player._padsOn).to.equal(true)
      await player._togglePlay()
      expect(pads.log).to.deep.equal(['play', 'stop'])
    })

    it('turns a fade in around into a fade out, and a fade out into a fade in', async () => {
      await view('a', 'G')
      player._fadingIn = true
      await player._togglePlay()
      expect(pads.log).to.deep.equal(['stop'])

      pads.log.length = 0
      player._fadingOut = true
      await player._togglePlay()
      expect(pads.log).to.deep.equal(['play'])
    })
  })

  describe('the pads and click switches', () => {
    it('remember the choice, and leave a song that is not playing alone', () => {
      player._togglePads()
      expect(player._padsOn).to.equal(false)
      expect(JSON.parse(localStorage.getItem('media-player-pads-on') ?? 'null')).to.equal(false)
      player._toggleClick()
      expect(JSON.parse(localStorage.getItem('media-player-click-on') ?? 'null')).to.equal(false)
      expect(pads.log).to.deep.equal([])
      expect(click.log).to.deep.equal([])
    })

    it('fade the pads, and start and stop the click, of the song that plays', async () => {
      await view('a', 'G', 100)
      await player._startSong()
      pads.log.length = 0
      click.log.length = 0

      player._togglePads()
      await Promise.resolve()
      expect(pads.log).to.deep.equal(['stop'])
      player._togglePads()
      await Promise.resolve()
      expect(pads.log).to.deep.equal(['stop', 'play'])

      player._toggleClick()
      expect(click.log).to.deep.equal(['stop'])
      player._toggleClick()
      expect(click.log).to.deep.equal(['stop', 'start 100 4/4 1/4'])
    })
  })
})
