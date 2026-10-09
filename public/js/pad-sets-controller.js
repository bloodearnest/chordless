import {
  getActivePadSet,
  listPadSets,
  PadSetChangedEvent,
  PadSetListUpdatedEvent,
  selectPadSet,
} from './pad-set-service.js'

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
export class PadSetsController {
  constructor(host) {
    this.host = host
    this.list = []
    this.activeId = getActivePadSet().id
    this.loading = true
    this.switching = false
    this.error = ''
    this._onListUpdated = () => this.load(true)
    this._onChanged = event => {
      this.activeId = event.padSet?.id ?? getActivePadSet().id
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
  async load(force = false) {
    this.loading = true
    this.error = ''
    this.host.requestUpdate()
    try {
      this.list = await listPadSets(force)
      if (!this.list.some(set => set.id === this.activeId)) {
        this.activeId = getActivePadSet().id
      }
    } catch (error) {
      console.error('[PadSets] Failed to load pad sets:', error)
      this.error = error.message || 'Unable to load pad sets.'
    } finally {
      this.loading = false
      this.host.requestUpdate()
    }
  }

  /**
   * Make a pad set the active one. Shows it as active straight away, and
   * goes back to the previous one (and rethrows) if switching fails.
   */
  async select(id) {
    const previous = this.activeId
    this.activeId = id
    this.switching = true
    this.error = ''
    this.host.requestUpdate()
    try {
      await selectPadSet(id)
    } catch (error) {
      this.activeId = previous
      this.error = error.message || 'Unable to switch pad set.'
      throw error
    } finally {
      this.switching = false
      this.host.requestUpdate()
    }
  }
}
