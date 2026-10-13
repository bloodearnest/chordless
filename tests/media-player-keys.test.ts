import { expect } from '@open-wc/testing'
import '../src/components/media-player.ts'
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
        expect(!!player.shadowRoot.querySelector('.collapsed-button')).to.equal(collapsed)
      }
    })
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
