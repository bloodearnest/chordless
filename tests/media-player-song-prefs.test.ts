import { expect } from '@open-wc/testing'
import '../src/components/media-player.ts'
import { SongChangeEvent } from '../src/js/app-events.ts'
import { suppressConsoleLogs } from './test-helpers.ts'

const { describe, it, beforeEach, afterEach } = window

describe("the media player and this user's choices for a song", () => {
  let player

  suppressConsoleLogs()

  beforeEach(async () => {
    localStorage.removeItem('padset-selection')
    player = document.createElement('media-player')
    document.body.append(player)
    await player.updateComplete
  })

  afterEach(() => {
    player.remove()
    localStorage.removeItem('padset-selection')
  })

  const song = (tempo: number) =>
    ({
      songId: 'ccli-1',
      title: 'A song',
      metadata: { key: 'G', tempo, tempoNote: '1/4', timeSignature: '4/4' },
    }) as never

  describe('the double click', () => {
    it('is on for a slow song, by default', () => {
      expect(player._doubleClickFor(60, undefined)).to.equal(true)
      expect(player._doubleClickFor(72, undefined)).to.equal(true)
      expect(player._doubleClickFor(73, undefined)).to.equal(false)
    })

    it("goes by the song's own choice, if it has one", () => {
      expect(player._doubleClickFor(120, true)).to.equal(true)
      expect(player._doubleClickFor(50, false)).to.equal(false)
    })

    it("is left to the song's choice when the automatic one is switched off", () => {
      player._autoDoubleClick = false
      expect(player._doubleClickFor(50, undefined)).to.equal(false)
      expect(player._doubleClickFor(50, true)).to.equal(true)
    })

    it('follows the threshold that is set', () => {
      player._doubleClickBelowBpm = 90
      expect(player._doubleClickFor(85, undefined)).to.equal(true)
    })

    it("takes the song's choice from the song change", async () => {
      await player._handleSongChange(new SongChangeEvent(song(120), { doubleClick: true }))
      expect(player._currentDoubleClick).to.equal(true)
      await player._handleSongChange(new SongChangeEvent(song(120)))
      expect(player._currentDoubleClick).to.equal(undefined)
    })

    it('makes a song that plays at the other speed not the current one', () => {
      player.currentKey = 'G'
      player._currentBpm = 60
      player._activeSongKey = 'G'
      player._activeSongBpm = 60
      player._activeSongTempoNote = '1/4'
      player._currentTempoNote = '1/4'
      player._activeSongTimeSignature = '3/4'
      player._currentTimeSignature = '3/4'
      player._activeDoubleClick = true
      expect(player._isCurrentSongActive()).to.equal(true)
      player._currentDoubleClick = false
      expect(player._isCurrentSongActive()).to.equal(false)
    })

    it('knows the song it plays is the one being viewed, whatever its tempo and time', () => {
      player.currentKey = 'D'
      player._currentBpm = 92
      player._currentTempoNote = '1/8'
      player._currentTimeSignature = '6/8'
      player._activeSongKey = 'D'
      player._activeSongBpm = 92
      player._activeSongTempoNote = '1/8'
      player._activeSongTimeSignature = '6/8'
      player._activeDoubleClick = false
      expect(player._isCurrentSongActive()).to.equal(true)
      // ...and another song, if its tempo is not the same
      player._currentBpm = 70
      expect(player._isCurrentSongActive()).to.equal(false)
    })

    it("toggles the song to the other speed, keeping a choice only when it is not the tempo's", async () => {
      const heard: (boolean | undefined)[] = []
      const listen = (event: Event) => heard.push((event as Event & { value?: boolean }).value)
      document.addEventListener('media-player:double-click-toggle', listen)
      // A fast song: doubling is a choice; undoing it goes back to going by tempo
      player._currentBpm = 120
      player._toggleDoubleClick()
      player._currentDoubleClick = true
      player._toggleDoubleClick()
      // A slow song doubles by itself: halving it is a choice
      player._currentBpm = 60
      player._currentDoubleClick = undefined
      player._toggleDoubleClick()
      player._currentDoubleClick = false
      player._toggleDoubleClick()
      document.removeEventListener('media-player:double-click-toggle', listen)
      expect(heard).to.deep.equal([true, undefined, false, undefined])
    })
  })

  describe('the pad set', () => {
    it("is the device's own unless the song has one", async () => {
      await player._handleSongChange(new SongChangeEvent(song(100)))
      expect(player._activePadSet.id).to.equal('builtin')
    })

    it("falls back to the device's own when the song's is not on this device", async () => {
      await player._handleSongChange(
        new SongChangeEvent(song(100), { padSetId: 'drive-gone-missing' })
      )
      expect(player._activePadSet.id).to.equal('builtin')
    })

    it("does not change a song's pad set when the device's changes", async () => {
      await player._handleSongChange(new SongChangeEvent(song(100), { padSetId: 'builtin' }))
      expect(player._currentPadSetId).to.equal('builtin')
    })
  })
})
