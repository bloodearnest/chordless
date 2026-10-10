// @ts-nocheck: not typed yet (remove this line when converting)
import { ContextProvider, createContext } from '@lit/context'

/**
 * The route being shown (see router.js), as a Lit context. Null before the
 * router has started.
 *
 * Provided for the whole page from <html>, and kept current by the router.
 * Consume it with
 *
 *   new ContextConsumer(this, { context: routeContext, subscribe: true })
 */
export const routeContext = createContext(Symbol('route'))

const provider = new ContextProvider(document.documentElement, {
  context: routeContext,
  initialValue: null,
})

/** Called by the router when the route changes */
export function provideRoute(route) {
  provider.setValue(route)
}
