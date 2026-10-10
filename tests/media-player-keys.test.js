import { expect } from '@open-wc/testing'
import '../public/components/media-player.js'
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

  it('takes Space and Esc while it is showing', () => {
    expect(player.getClientRects().length).to.be.greaterThan(0)
    expect(press('Space')).to.equal(true)
    expect(press('Escape')).to.equal(true)
  })

  it('leaves Space to the button that has it while it is hidden', () => {
    player.style.display = 'none'
    expect(press('Space')).to.equal(false)
    expect(press('Escape')).to.equal(false)
  })

  it('leaves the keys alone when it is turned off in the settings', () => {
    // as _showIfEnabled hides it
    player.style.display = 'none'
    expect(press('Space')).to.equal(false)
  })

  it('takes them again when it shows again', () => {
    player.style.display = 'none'
    expect(press('Space')).to.equal(false)
    player.style.display = ''
    expect(press('Space')).to.equal(true)
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
})
