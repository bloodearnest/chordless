/**
 * The words the app says to people. They are not in the code that shows them: they are in
 * `src/text/en.ts` (a Fluent file, docs/COPY.md), each under a name, and the code says which:
 *
 *   toast(t('toast-setlist-delete-failed'), { kind: 'error', details: errorMessage(error) })
 *   t('toast-setlist-moved', { title, space: target.name })
 *
 * so that they can be reworded without reading any code, by hand, or in the running app in dev
 * (Alt + right click on a message: js/copy-editor.ts).
 */
import { FluentBundle, FluentResource, type FluentVariable } from '@fluent/bundle'
import catalogue from '../text/en.ts'

/** The values a message is given: `{ $name }` in the message is `name` here */
export type TextArgs = Record<string, FluentVariable>

/** Sees every message as it is said, and may change it: the dev editor knows which is which from it */
export type TextTap = (key: string, text: string, args: TextArgs | undefined) => string

let tap: TextTap | null = null

function bundleOf(source: string): FluentBundle {
  // (no marks around the values: they would be in the text a test, or a person selecting it, sees)
  const bundle = new FluentBundle('en', { useIsolating: false })
  /* v8 ignore start -- tests/text.node.test.ts fails on a catalogue that is not valid, so none gets here */
  for (const error of bundle.addResource(new FluentResource(source))) {
    console.error('[text] A message in the catalogue is not valid:', error)
  }
  /* v8 ignore stop */
  return bundle
}

let bundle = bundleOf(catalogue)

/**
 * A message, with its values in. A name with no message is shown as itself (and said on the
 * console), so that a mistake is seen and the page still works.
 */
export function t(key: string, args?: TextArgs): string {
  const message = bundle.getMessage(key)
  let text = key
  if (message?.value) {
    const errors: Error[] = []
    text = bundle.formatPattern(message.value, args, errors)
    for (const error of errors) console.error(`[text] "${key}":`, error)
  } else {
    console.error(`[text] There is no message "${key}"`)
  }
  return tap ? tap(key, text, args) : text
}

/** Dev only: see (and change) every message as it is said */
export function setTextTap(next: TextTap | null): void {
  tap = next
}

/** Told when the catalogue was rewritten while the page is open (dev only: the page is not reloaded) */
export const TEXT_CHANGED = 'chordless-text-changed'

/**
 * Dev only: take a new catalogue (the editor, js/copy-editor.ts, gets it from the dev server when
 * src/text/en.ts is written, by it or by hand), and say so. Nothing in the app's own modules is
 * Vite's, so that a service worker with nothing cached ahead (the dev server's) still finds them offline.
 */
export function setCatalogue(source: string): void {
  bundle = bundleOf(source)
  globalThis.dispatchEvent(new Event(TEXT_CHANGED))
}
