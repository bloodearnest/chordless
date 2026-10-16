import { SetlistPage } from '../setlist-page.ts'

/**
 * What a view that shows a setlist (SetlistView, ShareView) does with its SetlistPage: start
 * it, tell it when the route moves within the setlist, ask it for the view state, and dispose
 * of it when the view is left.
 */
export class SetlistPageHost {
  #page: SetlistPage | null = null

  /**
   * Start a page. `currentRoute` is asked once it has loaded, because the route may have moved
   * on while it was loading.
   */
  start(
    options: ConstructorParameters<typeof SetlistPage>[0],
    currentRoute: () => { songIndex: number }
  ): void {
    const page = new SetlistPage(options)
    this.#page = page
    page
      .start()
      .then(() => this.#page?.routeChanged(currentRoute()))
      .catch(error => console.error('[SetlistPage] Failed to start:', error))
  }

  /** The route moved within this setlist */
  routeChanged(route: { songIndex: number }): void {
    this.#page?.routeChanged(route)
  }

  captureViewState() {
    return this.#page?.captureViewState()
  }

  dispose(): void {
    this.#page?.dispose()
    this.#page = null
  }
}
