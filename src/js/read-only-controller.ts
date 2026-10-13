import type { ReactiveController, ReactiveControllerHost } from 'lit'

/** Fired on the window when the current organisation turns read-only, or stops being */
export const READ_ONLY_CHANGE = 'organisation-read-only-change'

/**
 * Re-render a component when the current organisation's read-only state changes, for the
 * components that show or hide what edits according to isReadOnlyOrganisation().
 */
export class FollowsReadOnly implements ReactiveController {
  #host: ReactiveControllerHost
  #listener = () => this.#host.requestUpdate()

  constructor(host: ReactiveControllerHost) {
    this.#host = host
    host.addController(this)
  }

  hostConnected() {
    window.addEventListener(READ_ONLY_CHANGE, this.#listener)
  }

  hostDisconnected() {
    window.removeEventListener(READ_ONLY_CHANGE, this.#listener)
  }
}
