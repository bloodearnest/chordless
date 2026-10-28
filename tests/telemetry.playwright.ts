// The page's usage reports (docs/OBSERVABILITY.md): what it sends to our Worker, with nothing
// going further (the route is answered here, as the Worker would, 204)
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures.ts'

interface Batch {
  resourceSpans: {
    resource: { attributes: { key: string; value: { stringValue?: string } }[] }
    scopeSpans: {
      spans: { name: string; attributes: { key: string; value: Record<string, unknown> }[] }[]
    }[]
  }[]
}

// (no service worker: it would answer for the page, and the route below would not see the request)
test.use({ serviceWorkers: 'block' })

/** An error in the page, and the page leaving, which sends what is waiting */
async function throwAndLeave(page: Page) {
  await page.evaluate(() => {
    window.dispatchEvent(
      new ErrorEvent('error', { error: new Error('a test error'), message: 'a test error' })
    )
    window.dispatchEvent(new Event('pagehide'))
  })
}

test('an error in the page is reported, with the device and the page it was on', async ({
  page,
}) => {
  const batches: Batch[] = []
  await page.route('**/api/otlp/v1/traces', async route => {
    expect(route.request().method()).toBe('POST')
    expect(route.request().headers()['content-type']).toContain('application/json')
    batches.push(route.request().postDataJSON() as Batch)
    await route.fulfill({ status: 204 })
  })
  await page.goto('/')
  await page.waitForFunction(() => document.querySelector('nav-menu'))

  // (the reports start when the page is idle: an error is thrown until one is heard. The page
  // flushes when it is left, and the tests' clock is not running, so they leave it)
  await expect
    .poll(
      async () => {
        await throwAndLeave(page)
        return batches.length
      },
      { timeout: 30_000, intervals: [500] }
    )
    .toBeGreaterThan(0)

  const [batch] = batches
  const resource = Object.fromEntries(
    batch.resourceSpans[0].resource.attributes.map(a => [a.key, a.value.stringValue])
  )
  expect(resource['service.name']).toBe('chordless-web')
  expect(resource['user_agent.original']).toContain('Mozilla')
  const span = batch.resourceSpans[0].scopeSpans[0].spans.find(s => s.name === 'chordless.error')
  expect(span).toBeTruthy()
  const attributes = Object.fromEntries(span?.attributes.map(a => [a.key, a.value]) ?? [])
  expect(attributes['chordless.route']).toEqual({ stringValue: expect.any(String) })
  expect(attributes['chordless.online']).toEqual({ boolValue: true })
  const device = (attributes['device.id'] as { stringValue: string }).stringValue
  expect(device).toMatch(/^[0-9a-f-]{36}$/)
  // The id is the one kept on this device, which Preferences' switch forgets when it is turned off
  expect(await page.evaluate(() => localStorage.getItem('telemetry-device-id'))).toBe(device)
})

test('turning the reports off in Preferences forgets this device’s id', async ({ page }) => {
  await page.route('**/api/otlp/v1/traces', route => route.fulfill({ status: 204 }))
  await page.goto('/')
  await page.waitForFunction(() => document.querySelector('nav-menu'))
  // (the id is made when the first span starts: an error is thrown until there is one)
  await expect
    .poll(
      async () => {
        await throwAndLeave(page)
        return page.evaluate(() => localStorage.getItem('telemetry-device-id'))
      },
      { timeout: 30_000, intervals: [500] }
    )
    .not.toBeNull()
  await page.evaluate(async () => {
    const { setTelemetryPreference } = await import('/js/preferences.ts')
    setTelemetryPreference(false)
  })
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('telemetry-device-id')))
    .toBeNull()
})

test('a setlist session: opened, then left, with the same session id on both and what happened between', async ({
  page,
}) => {
  const spans: { name: string; attributes: Record<string, Record<string, unknown>> }[] = []
  await page.route('**/api/otlp/v1/traces', async route => {
    const batch = route.request().postDataJSON() as Batch
    for (const { scopeSpans } of batch.resourceSpans) {
      for (const span of scopeSpans.flatMap(scope => scope.spans)) {
        spans.push({
          name: span.name,
          attributes: Object.fromEntries(span.attributes.map(a => [a.key, a.value])),
        })
      }
    }
    await route.fulfill({ status: 204 })
  })
  await page.goto('/')
  await page.waitForFunction(() => document.querySelector('nav-menu'))

  // (a setlist opened before the reports have started is not reported: wait for them with an error)
  await expect
    .poll(
      async () => {
        await throwAndLeave(page)
        return spans.length
      },
      { timeout: 30_000, intervals: [500] }
    )
    .toBeGreaterThan(0)

  await page.locator('welcome-card').getByRole('button', { name: 'Add a sample setlist' }).click()
  await expect(page.locator('setlist-overview song-card')).toHaveCount(4)
  await page.locator('setlist-overview song-card').nth(1).click()
  await expect(page).toHaveURL(/\/song\/1$/)

  // The tab closed: the session ends, and what is waiting is sent
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')))
  await expect
    .poll(() => spans.filter(span => span.name.startsWith('chordless.setlist.')).length, {
      timeout: 15_000,
    })
    .toBe(2)

  const open = spans.find(span => span.name === 'chordless.setlist.open')
  const leave = spans.find(span => span.name === 'chordless.setlist.leave')
  expect(open?.attributes['chordless.setlist.songs']).toEqual({ intValue: 4 })
  expect(open?.attributes['chordless.setlist.source']).toEqual({ stringValue: 'library' })
  expect(leave?.attributes['chordless.setlist.songs_viewed']).toEqual({ intValue: 1 })
  expect(leave?.attributes['chordless.setlist.song_changes']).toEqual({ intValue: 1 })
  // (the id is on every span of the session, and the open span began it)
  const session = open?.attributes['session.id']
  expect(session).toEqual({ stringValue: expect.any(String) })
  expect(leave?.attributes['session.id']).toEqual(session)
  expect(leave?.attributes['chordless.setlist.id']).toEqual(
    open?.attributes['chordless.setlist.id']
  )
})
