import { expect } from '@open-wc/testing'
import { listenForLongPress } from '../src/js/annotations/long-press.ts'
import { installFakeTimers } from './test-helpers.ts'

const { describe, it, beforeEach, afterEach } = window

describe('a long press', () => {
  // (the hold is timed: the clock is the test's, so it is never too slow)
  let clock: ReturnType<typeof installFakeTimers>
  beforeEach(() => {
    clock = installFakeTimers({ date: true })
  })
  afterEach(() => clock.uninstall())

  function setup(enabled = true) {
    const root = document.createElement('div')
    root.innerHTML = '<span data-t id="word">grace</span><span id="plain">no</span>'
    document.body.append(root)
    const pressed: string[] = []
    const abort = new AbortController()
    listenForLongPress(root, {
      enabled: () => enabled,
      targetOf: event => (event.target as HTMLElement).closest<HTMLElement>('[data-t]'),
      onPress: element => pressed.push(element.id),
      holdMs: 30,
      slop: 8,
      signal: abort.signal,
    })
    return {
      root,
      pressed,
      word: root.querySelector('#word') as HTMLElement,
      plain: root.querySelector('#plain') as HTMLElement,
      done: () => {
        abort.abort()
        root.remove()
      },
    }
  }

  const pointer = (type: string, init: PointerEventInit = {}) =>
    new PointerEvent(type, {
      bubbles: true,
      composed: true,
      cancelable: true,
      isPrimary: true,
      pointerId: 1,
      pointerType: 'touch',
      clientX: 10,
      clientY: 10,
      ...init,
    })

  it('opens on what is held for long enough', async () => {
    const { word, pressed, done } = setup()
    word.dispatchEvent(pointer('pointerdown'))
    await clock.tick(60)
    expect(pressed).to.deep.equal(['word'])
    done()
  })

  it('is not a press if let go early, moved, or on something that is not a target', async () => {
    const { word, plain, pressed, done } = setup()
    word.dispatchEvent(pointer('pointerdown'))
    word.dispatchEvent(pointer('pointerup'))
    await clock.tick(60)
    word.dispatchEvent(pointer('pointerdown'))
    word.dispatchEvent(pointer('pointermove', { clientX: 40 }))
    await clock.tick(60)
    plain.dispatchEvent(pointer('pointerdown'))
    await clock.tick(60)
    expect(pressed).to.deep.equal([])
    done()
  })

  it('does nothing when not enabled, and ignores a second finger and the mouse’s other buttons', async () => {
    const off = setup(false)
    off.word.dispatchEvent(pointer('pointerdown'))
    await clock.tick(60)
    expect(off.pressed).to.deep.equal([])
    off.done()

    const on = setup()
    on.word.dispatchEvent(pointer('pointerdown', { isPrimary: false }))
    on.word.dispatchEvent(pointer('pointerdown', { pointerType: 'mouse', button: 2 }))
    await clock.tick(60)
    expect(on.pressed).to.deep.equal([])
    on.done()
  })

  it('swallows the click that ends a hold, but not a later one', async () => {
    const { root, word, done } = setup()
    const clicks: number[] = []
    root.addEventListener('click', () => clicks.push(1))
    word.dispatchEvent(pointer('pointerdown'))
    await clock.tick(60)
    word.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(clicks).to.deep.equal([])
    await clock.tick(750)
    word.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(clicks).to.deep.equal([1])
    done()
  })

  it('opens on a right click and on the context-menu key, once for a touch that asks for both', async () => {
    const { word, pressed, done } = setup()
    word.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    expect(pressed).to.deep.equal(['word'])
    await clock.tick(750)
    word.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ContextMenu', bubbles: true, cancelable: true })
    )
    word.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true, cancelable: true })
    )
    word.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'F10', bubbles: true, cancelable: true })
    )
    expect(pressed).to.deep.equal(['word', 'word', 'word'])
    // a long touch: the timer, then the context menu the browser asks for after it
    word.dispatchEvent(pointer('pointerdown'))
    await clock.tick(60)
    word.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    expect(pressed).to.have.length(4)
    done()
  })
})
