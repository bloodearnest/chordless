/**
 * Whether a key event comes from somewhere the user is typing: a text field,
 * select or contenteditable element. Page-wide shortcuts (space, arrows...)
 * should leave those alone.
 *
 * Looks at the event's original target via composedPath(): for a field inside
 * a component's shadow DOM, event.target outside the component is the
 * component itself, not the field.
 */
export function isTypingInField(event) {
  const target = event.composedPath?.()[0] ?? event.target
  if (!(target instanceof Element)) return false
  if (target.isContentEditable) return true
  if (target.matches('textarea, select')) return true
  // Inputs you type into (not checkboxes, buttons, ranges...)
  return target.matches(
    'input:not([type]), input[type="text"], input[type="search"], input[type="email"], ' +
      'input[type="url"], input[type="tel"], input[type="password"], input[type="number"], ' +
      'input[type="date"], input[type="time"], input[type="datetime-local"]'
  )
}
