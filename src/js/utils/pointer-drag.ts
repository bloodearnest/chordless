/** Where a mouse or touch is, whichever it is */
export function pointerPosition(e: MouseEvent | TouchEvent): { clientX: number; clientY: number } {
  return 'touches' in e ? e.touches[0] : e
}

/**
 * Follow the mouse or finger anywhere on the page, from a press until it is let go: `onMove` for
 * each move, then `onEnd` once.
 */
export function trackPointer(onMove: (e: MouseEvent | TouchEvent) => void, onEnd: () => void) {
  const end = () => {
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', end)
    document.removeEventListener('touchmove', onMove)
    document.removeEventListener('touchend', end)
    onEnd()
  }
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', end)
  document.addEventListener('touchmove', onMove)
  document.addEventListener('touchend', end)
}
