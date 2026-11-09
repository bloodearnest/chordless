/** What the tests of the import page (song-import.ts) share: songs to import, the page, and reading it */
import { fixture, html, waitUntil } from '@open-wc/testing'
import '../src/components/song-import.ts'
import { ChordlessDB } from '../src/js/db.ts'

/** A title no other test uses: the tests share this browser's database */
export const unique = (name: string) => `${name} ${crypto.randomUUID().slice(0, 8)}`

/** A chart in C, with a line of words */
export const chart = (title: string, body = '[C]Hello') => `{title: ${title}}\n{key: C}\n\n${body}`

/** A new import page. The tests drive its private parts too, so it is typed loosely */
export const importer = async (): Promise<any> => fixture(html`<song-import></song-import>`)

/** An element in the page */
export const $ = (element: any, selector: string): any => element.shadowRoot.querySelector(selector)

/** What the page says now, as a person reads it */
export const text = (element: any): string => element.shadowRoot.textContent.replace(/\s+/g, ' ')

/** What the page says once it has drawn what it has */
export async function said(element: any): Promise<string> {
  await element.updateComplete
  return text(element)
}

/** Wait until check() is truthy: the page's database work takes a moment */
export const waitFor = (check: () => unknown, timeout = 2000) =>
  waitUntil(check, 'Timed out waiting', { interval: 10, timeout })

/** Run with saving a melody failing, as a full disk would make it */
export async function whileScoresCannotBeSaved(run: () => Promise<unknown>): Promise<void> {
  const db = ChordlessDB.prototype
  const saveScore = db.saveScore
  db.saveScore = async () => {
    throw new Error('disk full')
  }
  try {
    await run()
  } finally {
    db.saveScore = saveScore
  }
}
