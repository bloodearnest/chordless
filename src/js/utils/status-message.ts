import '../../components/status-message.js'
import type { StatusMessage } from '../../components/status-message.js'

/**
 * Replace what is in a container with a <status-message>: centred feedback for
 * loading, empty, info and error states.
 * @returns the message, or null if there is no container
 */
export function showStatusMessage(
  container: Element | null,
  {
    message = '',
    detail = '',
    state = 'info',
  }: { message?: string; detail?: string; state?: string } = {}
): StatusMessage | null {
  if (!container) return null
  const element = document.createElement('status-message') as StatusMessage
  if (message) element.message = message
  if (detail) element.detail = detail
  element.state = state
  container.textContent = ''
  container.appendChild(element)
  return element
}
