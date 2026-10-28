// Smoke tests for the component playgrounds in src/dev/.
// They aren't exercised by the app, so without this they silently rot.
import { readdirSync, readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'

const DEV_DIR = new URL('../src/dev/', import.meta.url)
const pages = readdirSync(DEV_DIR).filter(f => f.endsWith('.html') && f !== 'index.html')

// The pages that draw, play or measure things run everywhere; the rest only wire up data
const LOGIC_PAGES = ['db-init.html', 'drive-audit.html', 'info-dialogs.html', 'library-repair.html']

test('dev index links to every dev page', { tag: '@logic' }, () => {
  const index = readFileSync(new URL('index.html', DEV_DIR), 'utf8')
  for (const page of pages) {
    expect(index, `src/dev/index.html should link to ${page}`).toContain(`href="/dev/${page}"`)
  }
})

for (const page of pages) {
  test(`dev page loads cleanly: ${page}`, {
    tag: LOGIC_PAGES.includes(page) ? '@logic' : [],
  }, async ({ page: browserPage }) => {
    const problems: string[] = []
    browserPage.on('pageerror', e => problems.push(`page error: ${e.message}`))
    browserPage.on('console', msg => {
      if (msg.type() === 'error') problems.push(`console error: ${msg.text()}`)
    })
    browserPage.on('response', resp => {
      if (resp.status() >= 400) problems.push(`HTTP ${resp.status()} ${resp.url()}`)
    })

    await browserPage.goto(`/dev/${page}`)
    await browserPage.waitForLoadState('networkidle')

    // Custom elements used on the page but never registered (e.g. a broken import)
    const undefinedElements = await browserPage.evaluate(() => [
      ...new Set(
        [...document.querySelectorAll('*')]
          .map(el => el.localName)
          .filter(name => name.includes('-') && !customElements.get(name))
      ),
    ])
    for (const name of undefinedElements) problems.push(`<${name}> is not defined`)

    expect(problems).toEqual([])
  })
}
