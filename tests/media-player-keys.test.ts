import { expect } from '@open-wc/testing'
import '../src/components/media-player.ts'
import { SongChangeEvent } from '../src/js/app-events.ts'
import type { RuntimeSong } from '../src/js/setlist/runtime-songs.ts'
import { suppressConsoleLogs } from './test-helpers.ts'

const { describe, it, beforeEach, afterEach } = window

describe('the media player and the keyboard', () => {
  let player
  let button

  suppressConsoleLogs()

  beforeEach(async () => {
    button = document.createElement('button')
    button.textContent = 'A switch'
    player = document.createElement('media-player')
    document.body.append(button, player)
    await player.updateComplete
  })

  afterEach(() => {
    player.remove()
    button.remove()
  })

  /** Press a key on the button, and say whether anything cancelled it */
  function press(code) {
    const event = new KeyboardEvent('keydown', {
      code,
      key: code === 'Space' ? ' ' : code,
      bubbles: true,
      composed: true,
      cancelable: true,
    })
    button.dispatchEvent(event)
    return event.defaultPrevented
  }

  // Showing, the player takes Space and Esc. Hidden (off a setlist with nothing playing, or turned
  // off in the settings: both set display none), the keys are the focused button's
  for (const [state, display, taken] of [
    ['showing', '', true],
    ['hidden', 'none', false],
  ]) {
    for (const code of ['Space', 'Escape']) {
      it(`${code} while the player is ${state}: ${taken ? 'taken' : 'left alone'}`, () => {
        player.style.display = display
        expect(press(code)).to.equal(taken)
      })
    }
  }

  it('leaves the keys to a modal dialog that is open', () => {
    const dialog = document.createElement('dialog')
    const inside = document.createElement('button')
    dialog.append(inside)
    document.body.append(dialog)
    dialog.showModal()
    try {
      for (const code of ['Space', 'Escape']) {
        const event = new KeyboardEvent('keydown', {
          code,
          bubbles: true,
          composed: true,
          cancelable: true,
        })
        inside.dispatchEvent(event)
        expect(event.defaultPrevented, code).to.equal(false)
        expect(press(code), `${code} outside it`).to.equal(true)
      }
    } finally {
      dialog.close()
      dialog.remove()
    }
  })

  describe('Space', () => {
    let started
    let stopped

    beforeEach(() => {
      started = 0
      stopped = 0
      player._startSong = async () => {
        started++
      }
      player._stop = async () => {
        stopped++
      }
    })

    it('starts the song being viewed when nothing is playing', () => {
      press('Space')
      expect([started, stopped]).to.deep.equal([1, 0])
    })

    it('stops it while it plays', () => {
      player._isCurrentSongActive = () => true
      player._metronomeRunning = true
      press('Space')
      expect([started, stopped]).to.deep.equal([0, 1])
    })

    it('starts the song being viewed, rather than stopping, while another one plays', () => {
      player._isCurrentSongActive = () => false
      player._metronomeRunning = true
      press('Space')
      expect([started, stopped]).to.deep.equal([1, 0])
    })
  })

  describe('off a setlist', () => {
    let started
    let stopped

    beforeEach(() => {
      started = 0
      stopped = 0
      player._startSong = async () => {
        started++
      }
      player._stop = async () => {
        stopped++
      }
      document.body.dataset.view = 'songs'
    })

    afterEach(() => {
      delete document.body.dataset.view
    })

    it('Space stops what plays, even when the song it was started for is not the current one', () => {
      player._isCurrentSongActive = () => false
      player._metronomeRunning = true
      expect(press('Space')).to.equal(true)
      expect([started, stopped]).to.deep.equal([0, 1])
    })

    it('Space does not start anything', () => {
      press('Space')
      expect([started, stopped]).to.deep.equal([0, 0])
    })

    it('keeps the collapsed or expanded state it was in while something plays', async () => {
      player._activeSongId = 'a-song'
      for (const collapsed of [true, false]) {
        player._collapsed = collapsed
        await player.updateComplete
        expect(player.hasAttribute('active')).to.equal(true)
        expect(!!player.shadowRoot.querySelector('.collapsed-pill')).to.equal(collapsed)
      }
    })
  })

  describe('the collapsed pill', () => {
    let started
    let stopped

    beforeEach(async () => {
      started = 0
      stopped = 0
      player._startSong = async () => {
        started++
      }
      player._stop = async () => {
        stopped++
      }
      player.currentKey = 'G'
      player._collapsed = true
      await player.updateComplete
    })

    const buttons = () => [...player.shadowRoot.querySelectorAll('.pill-button')]

    it('has play, stop and expand; play starts the song without expanding', async () => {
      expect(buttons()).to.have.length(3)
      expect(buttons()[0].disabled).to.equal(false)
      buttons()[0].click()
      expect(started).to.equal(1)
      expect(player._collapsed).to.equal(true)
    })

    it('stop is disabled until something plays, then stops', async () => {
      expect(buttons()[1].disabled).to.equal(true)
      player._metronomeRunning = true
      await player.updateComplete
      buttons()[1].click()
      expect(stopped).to.equal(1)
    })

    it('expand opens the full player', async () => {
      buttons()[2].click()
      expect(player._collapsed).to.equal(false)
    })
  })

  it('catches up with the song the page already showed when it is loaded late', async () => {
    const song = { songId: 's1', title: 'A song', metadata: { key: 'G' } }
    const before = SongChangeEvent.latest
    SongChangeEvent.latest = new SongChangeEvent(song as unknown as RuntimeSong)
    const late = document.createElement('media-player')
    document.body.append(late)
    await late.updateComplete
    expect(late.currentKey).to.equal('G')
    expect(late._currentSongId).to.equal('s1')
    late.remove()
    SongChangeEvent.latest = before
  })

  it('has an active attribute only while a song is started', async () => {
    expect(player.isActive).to.equal(false)
    expect(player.hasAttribute('active')).to.equal(false)
    player._activeSongId = 'a-song'
    await player.updateComplete
    expect(player.isActive).to.equal(true)
    expect(player.hasAttribute('active')).to.equal(true)
    player._activeSongId = null
    await player.updateComplete
    expect(player.hasAttribute('active')).to.equal(false)
  })

  describe('the page under it', () => {
    let page

    // (Chai would try to print a DOM element that did not match, which is very slow)
    const describeHit = (element: Element | null) => element?.localName ?? 'nothing'

    afterEach(() => page?.remove())

    // The player is moved with a transform, which leaves its box where it was by default
    it('can be clicked where the player is by default, once it has been dragged away', async () => {
      page = document.createElement('button')
      page.textContent = 'Page'
      page.style.cssText = 'position: fixed; inset: 0; width: 100%; height: 100%; z-index: 1'
      document.body.append(page)
      player.style.cssText = 'position: fixed; bottom: 1rem; right: 1rem; z-index: 1000'
      player._collapsed = false
      await player.updateComplete
      const box = player.getBoundingClientRect()
      const x = box.left + box.width / 2
      const y = box.top + box.height / 2

      // Where it is, it is what is hit
      expect(describeHit(document.elementFromPoint(x, y))).to.equal('media-player')

      player._dragOffsetX = -Math.round(box.width + 40)
      player._dragOffsetY = -Math.round(box.height + 40)
      await player.updateComplete
      expect(describeHit(document.elementFromPoint(x, y))).to.equal('button')

      // And the player is still there to be used, where it was dragged to
      const moved = player.shadowRoot.querySelector('.player').getBoundingClientRect()
      const hit = document.elementFromPoint(moved.left + moved.width / 2, moved.top + 5)
      expect(describeHit(hit)).to.equal('media-player')
    })
  })
})
