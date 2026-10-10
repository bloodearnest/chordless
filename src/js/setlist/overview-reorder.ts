/**
 * Reordering the songs of a setlist overview by dragging a song card's handle.
 *
 * OverviewReorder owns the pointer handling and the look of a drag; when a card is
 * dropped somewhere new it tells its owner (onMove), which changes the setlist.
 * Where a card lands is worked out by nextDropIndex(), a pure function.
 */

/** A card in the overview: its song index and where it is on screen */
export interface CardPlace {
  index: number
  top: number
  bottom: number
}

/** The state of a drag (idle when nothing is being dragged) */
interface DragState {
  active: boolean
  button: HTMLElement | null
  startIndex: number | null
  currentIndex: number | null
  lastAcceptedIndex: number | null
  startY: number
  currentY: number
  buttonHeight: number
  startTop: number
  startBottom: number
  rafId: number | null
  pointerId: number | null
  pointerType: string | null
}

/** px a drag must pass a position before the drop target switches to it */
const POSITION_THRESHOLD = 20

const INDICATOR_CLASSES = ['drag-over-above', 'drag-over-below', 'will-move-up', 'will-move-down']

/**
 * Where a dragged card would land: the position in the list it would be inserted
 * before (0 is the top; cards.length, the end). A change from the last accepted
 * position is only taken once the pointer is clearly past it, so the target does
 * not flicker between two cards.
 *
 * @param cards every card in the overview in order, with its song index and where it is on
 *   screen. For the dragged card, where it was before the drag: it follows the pointer, so
 *   where it is now says nothing about how far the drag has got.
 * @param drag.dragged the position in `cards` of the card being dragged
 * @param drag.clientY where the pointer is
 * @param drag.lastAccepted the position accepted so far
 * @returns the position to drop at
 */
export function nextDropIndex(
  cards: CardPlace[],
  { dragged, clientY, lastAccepted }: { dragged: number; clientY: number; lastAccepted: number }
): number {
  let proposed: number | null = null

  // The card the pointer is over: above its middle inserts before it, below, after
  for (let i = 0; i < cards.length; i++) {
    if (i === dragged) continue
    const { top, bottom, index } = cards[i]
    const middle = top + (bottom - top) / 2
    if (clientY < middle && clientY >= top) {
      proposed = index
      break
    }
    if (clientY >= middle && clientY < bottom) {
      proposed = index + 1
      break
    }
  }

  // Over none: above them all, below them all, or in a gap (where it was)
  if (proposed === null) {
    const first = cards[0]
    const last = cards[cards.length - 1]
    if (first && clientY < first.top) proposed = 0
    else if (last && clientY > last.bottom) proposed = cards.length
    else proposed = lastAccepted
  }

  if (proposed === lastAccepted) return lastAccepted

  // Only switch once the pointer has moved past where the accepted position is
  let acceptedY: number
  if (lastAccepted === 0) acceptedY = cards[0]?.top || 0
  else if (lastAccepted >= cards.length) acceptedY = cards[cards.length - 1]?.bottom || clientY
  else acceptedY = cards[lastAccepted]?.top || clientY

  return Math.abs(clientY - acceptedY) > POSITION_THRESHOLD ? proposed : lastAccepted
}

export class OverviewReorder {
  #root: Element
  #isEnabled: () => boolean
  #onMove: (from: number, to: number) => Promise<void> | void

  #drag: DragState = OverviewReorder.#idle()
  #cardHandlers = new Map<HTMLElement, (event: PointerEvent) => void>()
  #pointerHandlers: Record<string, (event: PointerEvent) => void> | null = null

  /**
   * @param options.root where the overview is
   * @param options.isEnabled whether the overview is being edited, the only time cards can be
   *   dragged
   * @param options.onMove a card was dropped in a new place: it is now at index `to`, from
   *   index `from`
   */
  constructor({
    root,
    isEnabled,
    onMove,
  }: {
    root: Element
    isEnabled: () => boolean
    onMove: (from: number, to: number) => Promise<void> | void
  }) {
    this.#root = root
    this.#isEnabled = isEnabled
    this.#onMove = onMove
  }

  static #idle(): DragState {
    return {
      active: false,
      button: null,
      startIndex: null,
      currentIndex: null,
      lastAcceptedIndex: null,
      startY: 0,
      currentY: 0,
      buttonHeight: 0,
      // Where the dragged card was before it left: it follows the pointer, so its
      // place now says nothing about where in the list the drag has got to
      startTop: 0,
      startBottom: 0,
      rafId: null,
      pointerId: null,
      pointerType: null,
    }
  }

  get #list(): Element | null {
    return this.#root.querySelector('.overview-songs')
  }

  #cards(): HTMLElement[] {
    return Array.from(this.#root.querySelectorAll<HTMLElement>('.overview-song-card'))
  }

  /** Whether a card is being dragged */
  get isDragging(): boolean {
    return this.#drag.active
  }

  /**
   * Listen for drags on the overview's cards as they are now. Safe to call again,
   * e.g. when the overview has been drawn anew.
   */
  enable(): void {
    const list = this.#list
    const cards = this.#cards()
    if (!list || cards.length === 0) return

    this.#removeListeners()

    for (const card of cards) {
      const handler = (event: PointerEvent) => this.#onCardPointerDown(event, card)
      card.addEventListener('pointerdown', handler)
      this.#cardHandlers.set(card, handler)
    }

    // Global pointer handlers, for smooth dragging
    this.#pointerHandlers = {
      pointermove: event => {
        // Only handle the pointer we're tracking
        if (event.pointerId !== this.#drag.pointerId) return
        if (this.#drag.active) {
          event.preventDefault() // Prevent scrolling while dragging
          this.#updateDrag(event.clientY)
        }
      },
      pointerup: event => {
        if (event.pointerId !== this.#drag.pointerId) return
        if (this.#drag.active) {
          event.preventDefault() // Prevent click event
          this.#endDrag()
        }
        this.#drag.pointerId = null
        this.#drag.button = null
      },
      pointercancel: event => {
        if (event.pointerId !== this.#drag.pointerId) return
        // For touch/pen, pointercancel fires when global handlers take over - ignore it
        // For mouse, cancel the drag
        if (event.pointerType === 'mouse') this.#cancelDrag()
      },
    }
    for (const [type, handler] of Object.entries(this.#pointerHandlers)) {
      document.addEventListener(type, handler as EventListener)
    }
  }

  /** Stop listening, and put right a drag in progress */
  disable(): void {
    this.#removeListeners()
    if (this.#drag.active) this.#cancelDrag()
    document.body.style.userSelect = ''
  }

  #removeListeners(): void {
    if (this.#pointerHandlers) {
      for (const [type, handler] of Object.entries(this.#pointerHandlers)) {
        document.removeEventListener(type, handler as EventListener)
      }
      this.#pointerHandlers = null
    }
    for (const [card, handler] of this.#cardHandlers) {
      card.removeEventListener('pointerdown', handler)
    }
    this.#cardHandlers.clear()
  }

  #onCardPointerDown(event: PointerEvent, card: HTMLElement): void {
    // Don't start drag if not in edit mode
    if (!this.#isEnabled()) return

    // Don't start drag if already dragging
    if (this.#drag.active) return

    // Only handle primary pointer (left mouse button, primary touch)
    if (!event.isPrimary) return

    // Only drag from the handle, which is in the card's shadow DOM
    const handle = event
      .composedPath()
      .find(element => element instanceof Element && element.classList.contains('drag-handle'))
    if (!handle) return

    // Prevent the click from bubbling
    event.stopPropagation()

    // Store pointer info
    this.#drag.button = card
    this.#drag.startY = event.clientY
    this.#drag.pointerId = event.pointerId
    this.#drag.pointerType = event.pointerType

    // Start drag immediately when handle is grabbed
    this.#startDrag(card, event.clientY)
  }

  #startDrag(card: HTMLElement, clientY: number): void {
    const drag = this.#drag
    drag.active = true
    drag.button = card
    drag.startIndex = Number.parseInt(card.dataset.songIndex ?? '', 10)
    drag.currentIndex = drag.startIndex
    drag.lastAcceptedIndex = drag.startIndex
    drag.startY = clientY
    drag.currentY = clientY
    const rect = card.getBoundingClientRect()
    drag.buttonHeight = rect.height
    drag.startTop = rect.top
    drag.startBottom = rect.bottom

    // Add visual feedback
    card.classList.add('dragging')
    this.#list?.classList.add('reordering')

    // Prevent text selection during drag
    document.body.style.userSelect = 'none'

    // Show initial drop indicator at original position
    this.#performDragUpdate()
  }

  #updateDrag(clientY: number): void {
    const drag = this.#drag
    if (!drag.active) return

    drag.currentY = clientY

    // Update dragged button position IMMEDIATELY (no throttling for smooth following)
    if (drag.button) {
      drag.button.style.transform = `scale(1.05) translateY(${clientY - drag.startY}px)`
    }

    // Throttle drop target calculations with requestAnimationFrame
    if (drag.rafId) return
    drag.rafId = requestAnimationFrame(() => {
      drag.rafId = null
      this.#performDragUpdate()
    })
  }

  #performDragUpdate(): void {
    const drag = this.#drag
    if (!drag.active) return

    const buttons = this.#cards()
    const target = nextDropIndex(
      buttons.map(card => {
        const index = Number.parseInt(card.dataset.songIndex ?? '', 10)
        if (card === drag.button) return { index, top: drag.startTop, bottom: drag.startBottom }
        const { top, bottom } = card.getBoundingClientRect()
        return { index, top, bottom }
      }),
      {
        dragged: drag.button ? buttons.indexOf(drag.button) : -1,
        clientY: drag.currentY,
        lastAccepted: drag.lastAcceptedIndex ?? 0,
      }
    )
    drag.lastAcceptedIndex = target

    this.#clearIndicators(buttons)
    this.#showDropIndicator(buttons, target)
    drag.currentIndex = target
  }

  /** Mark where the card will land, and the cards that will move out of its way */
  #showDropIndicator(buttons: HTMLElement[], target: number | null): void {
    const drag = this.#drag
    if (target === null || drag.startIndex === null) return

    // Determine which button to show the indicator on
    let indicatorButton: HTMLElement | null = null
    let indicatorClass: string | null = null

    if (target === drag.startIndex || target === drag.startIndex + 1) {
      // At (or beside) the original position: show the placeholder where it was,
      // above the next button, or below the previous if it was the last
      if (drag.startIndex < buttons.length - 1) {
        indicatorButton = buttons[drag.startIndex + 1]
        indicatorClass = 'drag-over-above'
      } else if (drag.startIndex > 0) {
        indicatorButton = buttons[drag.startIndex - 1]
        indicatorClass = 'drag-over-below'
      }
    } else if (target < drag.startIndex) {
      // Moving up - show above the target position
      indicatorButton = buttons[target]
      indicatorClass = 'drag-over-above'
    } else {
      // Moving down - show below the button before the target
      indicatorButton = buttons[target - 1]
      indicatorClass = 'drag-over-below'
    }

    // Apply the indicator class (never on the dragged button)
    if (indicatorButton && indicatorClass && indicatorButton !== drag.button) {
      indicatorButton.classList.add(indicatorClass)
      // Set the drop indicator height to match the dragged card
      indicatorButton.style.setProperty('--drag-card-height', `${drag.buttonHeight}px`)
    }

    // Apply preview animations only if position actually changes
    if (target !== drag.startIndex && target !== drag.startIndex + 1) {
      for (const button of buttons) {
        const index = Number.parseInt(button.dataset.songIndex ?? '', 10)
        if (index === drag.startIndex) continue // Skip dragged item

        if (target < drag.startIndex) {
          // Moving up in list
          if (index >= target && index < drag.startIndex) button.classList.add('will-move-down')
        } else {
          // Moving down in list
          if (index > drag.startIndex && index < target) button.classList.add('will-move-up')
        }
      }
    }
  }

  #clearIndicators(buttons: HTMLElement[]): void {
    for (const button of buttons) {
      button.classList.remove(...INDICATOR_CLASSES)
      button.style.removeProperty('--drag-card-height')
    }
  }

  async #endDrag(): Promise<void> {
    const drag = this.#drag
    if (!drag.active) return

    const button = drag.button
    const startIndex = drag.startIndex
    const targetIndex = drag.currentIndex
    let moved = false

    // Clean up visual state
    button?.classList.remove('dragging')
    if (button) button.style.transform = ''
    this.#list?.classList.remove('reordering')
    document.body.style.userSelect = ''
    this.#clearIndicators(this.#cards())

    // Reorder if position changed
    if (
      startIndex !== null &&
      targetIndex !== null &&
      targetIndex !== startIndex &&
      targetIndex !== startIndex + 1
    ) {
      // The index it ends up at, once it has left its old place
      const newIndex = targetIndex > startIndex ? targetIndex - 1 : targetIndex
      await this.#onMove(startIndex, newIndex)
      moved = true
    }

    // Cancel any pending animation frame
    if (drag.rafId) cancelAnimationFrame(drag.rafId)

    this.#drag = OverviewReorder.#idle()

    // The overview was drawn anew with the new order: listen to its cards
    if (moved && this.#isEnabled()) this.enable()
  }

  #cancelDrag(): void {
    const drag = this.#drag
    if (drag.rafId) cancelAnimationFrame(drag.rafId)

    if (drag.active) {
      // Clean up visual state without reordering
      if (drag.button) {
        drag.button.classList.remove('dragging')
        drag.button.style.transform = ''
      }
      this.#list?.classList.remove('reordering')
      document.body.style.userSelect = ''
      this.#clearIndicators(this.#cards())
    }

    this.#drag = OverviewReorder.#idle()
  }
}
