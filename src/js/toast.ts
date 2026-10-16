/**
 * A short message over the page that does not stop anything: toast('Saved'), or for a failure
 *
 *   toast("Couldn't save the setlist.", { kind: 'error', details: errorMessage(error) })
 *
 * An error stays until it is dismissed; any other message goes by itself. See
 * components/app-toast.ts. This is for what a page has no place for: use the page's own status
 * where it has one (a form's error under its field).
 */
import type { AppToast, ToastOptions } from '../components/app-toast.ts'
import '../components/app-toast.ts'

let element: AppToast | null = null

export function toast(message: string, options: ToastOptions = {}): void {
  if (!element?.isConnected) {
    element = document.createElement('app-toast')
    document.body.append(element)
  }
  element.show(message, options)
}
