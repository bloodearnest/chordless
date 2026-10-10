import { expect } from '@open-wc/testing'
import '../src/components/media-player.ts'
import { suppressConsoleLogs } from './test-helpers.js'

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
})
