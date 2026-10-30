// The text size setting (--font-scale, saved on the device) multiplies what the device picks, at
// either end of the clamp, and leaves the spacing built on the device's size alone.
import { expect, openApp, test } from './fixtures.ts'

/** --font-base and --song-margin in pixels, with the scale set as given */
const sizes = (page: import('@playwright/test').Page, scale: number) =>
  page.evaluate(scale => {
    document.documentElement.style.setProperty('--font-scale', String(scale))
    const probe = document.createElement('div')
    document.body.append(probe)
    const px = (value: string) => {
      probe.style.width = `calc(${value})`
      return probe.getBoundingClientRect().width
    }
    const out = { base: px('var(--font-base)'), margin: px('var(--song-margin)') }
    probe.remove()
    return out
  }, scale)

for (const [name, viewport] of [
  ['a phone, at the small end of the clamp', { width: 390, height: 800 }],
  ['a desktop, at the large end of the clamp', { width: 1400, height: 900 }],
] as const) {
  test.describe(`on ${name}`, () => {
    test.use({ viewport })

    test('the scale multiplies the text size, and not the margin', async ({ page }) => {
      await openApp(page, '/')
      const normal = await sizes(page, 1)
      const larger = await sizes(page, 1.5)
      expect(larger.base / normal.base).toBeCloseTo(1.5, 2)
      expect(larger.margin).toBeCloseTo(normal.margin, 2)
    })
  })
}
