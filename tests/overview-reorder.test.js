import { expect } from '@open-wc/testing'
import { nextDropIndex, OverviewReorder } from '../public/js/setlist/overview-reorder.js'

const { describe, it, beforeEach, afterEach } = window

// Four cards, each 50px tall with a 10px gap: 0-50, 60-110, 120-170, 180-230
const cardsAt = () => [0, 60, 120, 180].map((top, index) => ({ index, top, bottom: top + 50 }))

describe('nextDropIndex', () => {
  const drop = (clientY, dragged, lastAccepted) =>
    nextDropIndex(cardsAt(), { dragged, clientY, lastAccepted })

  it('drops before a card when the pointer is over its top half', () => {
    expect(drop(125, 0, 0)).to.equal(2) // top half of card 2 (middle 145)
  })

  it('drops after a card when the pointer is over its bottom half', () => {
    expect(drop(165, 0, 0)).to.equal(3) // bottom half of card 2
  })

  it('drops at the top when the pointer is above every card', () => {
    expect(drop(-30, 2, 2)).to.equal(0)
  })

  it('drops at the end when the pointer is below every card', () => {
    expect(drop(300, 1, 1)).to.equal(4)
  })

  it('stays where it was while the pointer is in a gap', () => {
    expect(drop(115, 0, 2)).to.equal(2)
  })

  it('ignores the card being dragged', () => {
    // Over its own place: nothing else is under the pointer, so it keeps its target
    expect(drop(25, 0, 0)).to.equal(0)
  })

  it('does not switch to a new target until the pointer is clearly past the old one', () => {
    // Cards 30px tall with no gap: 0-30, 30-60, 60-90, 90-120. Accepted: 2 (top 60).
    const small = [0, 30, 60, 90].map((top, index) => ({ index, top, bottom: top + 30 }))
    const drop = clientY => nextDropIndex(small, { dragged: 3, clientY, lastAccepted: 2 })
    // The top half of card 1 proposes 1, but 40 is only 20px from 60: it holds
    expect(drop(40)).to.equal(2)
    // 39 is 21px away: it switches
    expect(drop(39)).to.equal(1)
  })

  it('measures from the end of the list when the accepted target is the end', () => {
    // Accepted: 4 (after the last card, bottom 230). Going up into the last card's top half
    expect(drop(195, 0, 4)).to.equal(3) // 35px from 230: switches
    expect(drop(215, 0, 4)).to.equal(4) // that's in its bottom half: proposes 4: unchanged
  })

  it('has nothing to do with no cards', () => {
    expect(nextDropIndex([], { dragged: 0, clientY: 10, lastAccepted: 0 })).to.equal(0)
  })
})

describe('OverviewReorder', () => {
  let root
  let moves
  let enabled
  let reorder

  /** Cards in the light DOM, each with a drag handle, like the overview's */
  function build(count = 4) {
    root = document.createElement('div')
    root.style.cssText = 'position: fixed; top: 0; left: 0; width: 300px'
    root.innerHTML = `<div class="overview-songs">${Array.from(
      { length: count },
      (_, index) =>
        `<div class="overview-song-card" data-song-index="${index}" style="height: 50px; margin-bottom: 10px"><span class="drag-handle" style="display: block; height: 20px">grip</span></div>`
    ).join('')}</div>`
    document.body.append(root)
  }

  const card = index => root.querySelectorAll('.overview-song-card')[index]
  const handle = index => card(index).querySelector('.drag-handle')
  const pointer = (type, init) =>
    new PointerEvent(type, {
      bubbles: true,
      composed: true,
      cancelable: true,
      isPrimary: true,
      pointerId: 1,
      pointerType: 'mouse',
      ...init,
    })
  const nextFrame = () => new Promise(resolve => requestAnimationFrame(() => resolve()))

  /** Drag a card by its handle to a height, and let go */
  async function drag(from, toY, { release = true } = {}) {
    const start = handle(from).getBoundingClientRect()
    handle(from).dispatchEvent(pointer('pointerdown', { clientY: start.top + 5 }))
    document.dispatchEvent(pointer('pointermove', { clientY: toY }))
    await nextFrame()
    if (release) {
      document.dispatchEvent(pointer('pointerup', { clientY: toY }))
      await nextFrame()
    }
  }

  beforeEach(() => {
    build()
    moves = []
    enabled = true
    reorder = new OverviewReorder({
      root,
      isEnabled: () => enabled,
      onMove: (from, to) => moves.push([from, to]),
    })
    reorder.enable()
  })

  afterEach(() => {
    reorder.disable()
    root.remove()
  })

  it('moves a card dragged below another: reported as from and to', async () => {
    // Drop below the last card (pointer past it)
    await drag(0, 400)
    expect(moves).to.deep.equal([[0, 3]])
  })

  it('moves the first card however near its top the handle is grabbed', async () => {
    // The distance to move is from where the card was, not from where it follows the pointer
    const grab = handle(0).getBoundingClientRect().top + 2
    handle(0).dispatchEvent(pointer('pointerdown', { clientY: grab }))
    document.dispatchEvent(pointer('pointermove', { clientY: 400 }))
    await nextFrame()
    document.dispatchEvent(pointer('pointerup', { clientY: 400 }))
    await nextFrame()
    expect(moves).to.deep.equal([[0, 3]])
  })

  it('moves a card up', async () => {
    await drag(3, -50)
    expect(moves).to.deep.equal([[3, 0]])
  })

  it('does nothing if the card is dropped where it was, or next to it', async () => {
    await drag(1, handle(1).getBoundingClientRect().top + 5)
    expect(moves).to.deep.equal([])
  })

  it('shows the drag while it lasts, and tidies up when it ends', async () => {
    await drag(0, 400, { release: false })
    expect(reorder.isDragging).to.equal(true)
    expect(card(0).classList.contains('dragging')).to.equal(true)
    expect(root.querySelector('.overview-songs').classList.contains('reordering')).to.equal(true)
    expect(document.body.style.userSelect).to.equal('none')
    expect(card(0).style.transform).to.contain('translateY')
    expect(root.querySelector('.drag-over-below')).to.not.equal(null)

    document.dispatchEvent(pointer('pointerup', { clientY: 400 }))
    await nextFrame()
    expect(reorder.isDragging).to.equal(false)
    expect(card(0).classList.contains('dragging')).to.equal(false)
    expect(root.querySelector('.overview-songs').classList.contains('reordering')).to.equal(false)
    expect(document.body.style.userSelect).to.equal('')
    expect(card(0).style.transform).to.equal('')
    expect(root.querySelector('.drag-over-below, .drag-over-above, .will-move-up')).to.equal(null)
  })

  it('only drags by the handle', async () => {
    card(0).dispatchEvent(pointer('pointerdown', { clientY: 5 }))
    expect(reorder.isDragging).to.equal(false)
  })

  it('does not drag unless the overview is being edited', async () => {
    enabled = false
    await drag(0, 400)
    expect(reorder.isDragging).to.equal(false)
    expect(moves).to.deep.equal([])
  })

  it('ignores a second pointer, and a pointer that is not the primary one', async () => {
    handle(0).dispatchEvent(pointer('pointerdown', { isPrimary: false, clientY: 5 }))
    expect(reorder.isDragging).to.equal(false)
  })

  it('cancels a mouse drag on pointercancel, without moving anything', async () => {
    await drag(0, 400, { release: false })
    document.dispatchEvent(pointer('pointercancel', { clientY: 400 }))
    expect(reorder.isDragging).to.equal(false)
    expect(card(0).classList.contains('dragging')).to.equal(false)
    document.dispatchEvent(pointer('pointerup', { clientY: 400 }))
    await nextFrame()
    expect(moves).to.deep.equal([])
  })

  it('disable puts a drag in progress right, and stops listening', async () => {
    await drag(0, 400, { release: false })
    reorder.disable()
    expect(reorder.isDragging).to.equal(false)
    expect(document.body.style.userSelect).to.equal('')
    expect(card(0).classList.contains('dragging')).to.equal(false)

    await drag(1, 400)
    expect(moves).to.deep.equal([])
  })

  it('listens to the cards again after enable() when the overview was drawn anew', async () => {
    root.querySelector('.overview-songs').innerHTML =
      `<div class="overview-song-card" data-song-index="0" style="height: 50px"><span class="drag-handle" style="display: block; height: 20px">grip</span></div><div class="overview-song-card" data-song-index="1" style="height: 50px"><span class="drag-handle" style="display: block; height: 20px">grip</span></div>`
    reorder.enable()
    await drag(0, 400)
    expect(moves).to.deep.equal([[0, 1]])
  })

  it('enables again by itself after a move, for the redrawn overview', async () => {
    await drag(0, 400)
    expect(moves).to.have.length(1)
    // Still listening: a second drag works
    await drag(3, -50)
    expect(moves).to.have.length(2)
  })

  it('does nothing without an overview or cards', () => {
    root.innerHTML = ''
    reorder.enable()
    reorder.disable()
  })
})
