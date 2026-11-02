/**
 * A long press (or a right click, or the context-menu key) on a target, to open the note editor
 * (docs/NOTES.md). Made so that scrolling and swiping still work: the hold is cancelled by moving
 * more than a few pixels, a second finger, or lifting early; the press itself does nothing else,
 * and the click that follows it is swallowed so a title does not collapse as the finger lifts.
 */

export interface LongPressOptions {
  /** Whether presses count right now (edit mode) */
  enabled: () => boolean
  /** What a press at this event is on, if anything */
  targetOf: (event: Event) => HTMLElement | null
  onPress: (target: HTMLElement) => void
  /** How long to hold, in ms */
  holdMs?: number
  /** How far the pointer may move and still be a hold, in pixels */
  slop?: number
  signal?: AbortSignal
}

export const HOLD_MS = 500
export const SLOP_PX = 8

export function listenForLongPress(root: EventTarget, options: LongPressOptions): void {
  const { enabled, targetOf, onPress, holdMs = HOLD_MS, slop = SLOP_PX, signal } = options
  let timer: ReturnType<typeof setTimeout> | undefined
  let start: { x: number; y: number; id: number } | null = null
  let pressedAt = 0

  const cancel = () => {
    clearTimeout(timer)
    timer = undefined
    start = null
  }
  const press = (target: HTMLElement) => {
    pressedAt = Date.now()
    cancel()
    navigator.vibrate?.(20)
    onPress(target)
  }

  root.addEventListener(
    'pointerdown',
    event => {
      const down = event as PointerEvent
      // A second finger is a pinch or a swipe, not a hold; and a mouse presses with its right button
      if (!enabled() || start || !down.isPrimary || (down.pointerType === 'mouse' && down.button !== 0)) {
        cancel()
        return
      }
      const target = targetOf(event)
      if (!target) return
      start = { x: down.clientX, y: down.clientY, id: down.pointerId }
      timer = setTimeout(() => press(target), holdMs)
    },
    { signal }
  )

  root.addEventListener(
    'pointermove',
    event => {
      const move = event as PointerEvent
      if (!start || move.pointerId !== start.id) return
      if (Math.hypot(move.clientX - start.x, move.clientY - start.y) > slop) cancel()
    },
    { signal }
  )
  for (const type of ['pointerup', 'pointercancel', 'pointerleave']) {
    root.addEventListener(type, cancel, { signal })
  }

  // The click that ends a hold is not a click on the title or the word
  root.addEventListener(
    'click',
    event => {
      if (Date.now() - pressedAt > 700) return
      event.stopPropagation()
      event.preventDefault()
      pressedAt = 0
    },
    { capture: true, signal }
  )

  // A right click, a long touch on Android (which both ask for a context menu), and the menu key
  root.addEventListener(
    'contextmenu',
    event => {
      if (!enabled()) return
      const target = targetOf(event)
      if (!target) return
      event.preventDefault()
      // (a long touch has been handled by the timer a moment ago)
      if (Date.now() - pressedAt > 700) press(target)
    },
    { signal }
  )
  root.addEventListener(
    'keydown',
    event => {
      const key = event as KeyboardEvent
      if (!enabled() || !(key.key === 'ContextMenu' || (key.key === 'F10' && key.shiftKey))) return
      const target = targetOf(event)
      if (!target) return
      event.preventDefault()
      press(target)
    },
    { signal }
  )
}
