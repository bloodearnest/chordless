import '../../components/status-message.js'

/**
 * Replace what is in a container with a <status-message>: centred feedback for
 * loading, empty, info and error states.
 * @param {Element | null} container
 * @param {{message?: string, detail?: string, state?: string}} [options]
 * @returns {Element | null} the message, or null if there is no container
 */
export function showStatusMessage(container, { message = '', detail = '', state = 'info' } = {}) {
  if (!container) return null
  const element = document.createElement('status-message')
  if (message) element.message = message
  if (detail) element.detail = detail
  element.state = state
  container.textContent = ''
  container.appendChild(element)
  return element
}
