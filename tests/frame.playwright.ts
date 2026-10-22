// The tablet-sized frame the app takes on a desktop: a mouse, and a window wider than the frame.
// A touch device fills its screen, whatever its width or pixel density.
import { expect, openApp, test } from './fixtures.ts'

const FRAME = 56 * 16 // 56rem, in CSS pixels at the default root size

/** The app's body width, and the window's, in CSS pixels */
const widths = (page: import('@playwright/test').Page) =>
  page.evaluate(() => ({
    body: Math.round(document.body.getBoundingClientRect().width),
    window: window.innerWidth,
    fine: matchMedia('(hover: hover) and (pointer: fine)').matches,
  }))

test.describe('on a desktop', () => {
  test.use({ viewport: { width: 1400, height: 900 } })

  test('a window wider than the frame shows the frame, centred', async ({ page }) => {
    await openApp(page, '/')
    const { body, window, fine } = await widths(page)
    expect(fine).toBe(true)
    expect(body).toBe(FRAME)
    expect(window).toBe(1400)
    const left = await page.evaluate(() => Math.round(document.body.getBoundingClientRect().left))
    expect(left).toBe((1400 - FRAME) / 2)
  })

  test('a window narrower than the frame fills it', async ({ page }) => {
    await page.setViewportSize({ width: 700, height: 900 })
    await openApp(page, '/')
    expect((await widths(page)).body).toBe(700)
  })
})

test.describe('on a tablet in portrait, 1000 by 1500 CSS pixels (a Pixel Slate)', () => {
  test.use({ viewport: { width: 1000, height: 1500 }, hasTouch: true, deviceScaleFactor: 2 })

  test('fills the screen: wider than the frame, but not a desktop', async ({ page }) => {
    await openApp(page, '/')
    const { body, window, fine } = await widths(page)
    expect(fine).toBe(false)
    expect(window).toBe(1000)
    expect(body).toBe(1000)
  })

  test('has modals, and the media player, measured from the screen, not the frame', async ({
    page,
  }) => {
    await openApp(page, '/')
    const width = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--app-width').trim()
    )
    expect(width).toBe('100vw')
  })
})
