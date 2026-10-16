import type { ReactiveController, ReactiveControllerHost } from 'lit'
import {
  getActivePadSet,
  listPadSets,
  type PadSet,
  PadSetChangedEvent,
  PadSetListUpdatedEvent,
  selectPadSet,
} from './pad-set-service.ts'
import { errorMessage } from './utils/errors.ts'

/**
 * PadSetsController: the pad sets and which one is active, for a component
 * showing a pad set picker. A Lit ReactiveController: add one in the
 * constructor,
 *
 *   this._padSets = new PadSetsController(this)
 *
 * and render from its list, activeId, loading, switching and error. It loads
 * the list when the host connects, reloads it when pad sets are added, follows
 * the active pad set when it's changed elsewhere, and updates the host as any
 * of these change.
 */
export class PadSetsController implements ReactiveController {
  host: ReactiveControllerHost
  list: PadSet[]
  /** The chosen pad set's id; '' if none is chosen */
  activeId: string
  loading: boolean
  switching: boolean
  error: string
  _onListUpdated: () => void
  _onChanged: (event: Event) => void

  constructor(host: ReactiveControllerHost) {
    this.host = host
    this.list = []
    this.activeId = getActivePadSet()?.id ?? ''
    this.loading = true
    this.switching = false
    this.error = ''
    this._onListUpdated = () => this.load(true)
    this._onChanged = event => {
      const padSet = event instanceof PadSetChangedEvent ? event.padSet : undefined
      this.activeId = padSet?.id ?? ''
      this.host.requestUpdate()
    }
    host.addController(this)
  }

  hostConnected() {
    window.addEventListener(PadSetListUpdatedEvent.type, this._onListUpdated)
    window.addEventListener(PadSetChangedEvent.type, this._onChanged)
    this.load()
  }

  hostDisconnected() {
    window.removeEventListener(PadSetListUpdatedEvent.type, this._onListUpdated)
    window.removeEventListener(PadSetChangedEvent.type, this._onChanged)
  }

  /** Load the list of pad sets; force skips the cached list */
  async load(force = false): Promise<void> {
    this.loading = true
    this.error = ''
    this.host.requestUpdate()
    // (listPadSets does not fail: a list it cannot get from Drive is just empty)
    this.list = await listPadSets(force)
    if (!this.list.some(set => set.id === this.activeId)) {
      this.activeId = getActivePadSet()?.id ?? ''
    }
    this.loading = false
    this.host.requestUpdate()
  }

  /**
   * Make a pad set the active one. Shows it as active straight away, and
   * goes back to the previous one (and rethrows) if switching fails.
   */
  async select(id: string): Promise<void> {
    const previous = this.activeId
    this.activeId = id
    this.switching = true
    this.error = ''
    this.host.requestUpdate()
    try {
      await selectPadSet(id)
    } catch (error) {
      this.activeId = previous
      this.error = errorMessage(error)
      throw error
    } finally {
      this.switching = false
      this.host.requestUpdate()
    }
  }
}
