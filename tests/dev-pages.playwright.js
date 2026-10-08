// Smoke tests for the component playgrounds in public/dev/.
// They aren't exercised by the app, so without this they silently rot.
import { readdirSync, readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'

const DEV_DIR = new URL('../public/dev/', import.meta.url)
const pages = readdirSync(DEV_DIR).filter(f => f.endsWith('.html') && f !== 'index.html')

test('dev index links to every dev page', () => {
  const index = readFileSync(new URL('index.html', DEV_DIR), 'utf8')
  for (const page of pages) {
    expect(index, `public/dev/index.html should link to ${page}`).toContain(`href="/dev/${page}"`)
  }
})

for (const page of pages) {
  test(`dev page loads cleanly: ${page}`, async ({ page: browserPage }) => {
    const problems = []
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

test('dev pages load when the service worker controls the page', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null)

  await page.goto('/dev/components.html')
  await expect(page).toHaveTitle('Components Test - Chordless')
})
