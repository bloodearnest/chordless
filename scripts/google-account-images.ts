/**
 * Takes the pictures on the page that shows how to make a Google account with an address that is
 * not Gmail's (src/google-account.html): Google's own sign-up pages, in `public/google-account/`.
 *
 *   just google-account-images
 *
 * A command to run by hand, not part of `just test` or CI: it goes to Google's real sign-up
 * pages, which change their look and wording now and then (so does a step that no longer finds its
 * button: the script stops and says which). Commit the pictures that change. It fills in an
 * invented name and birthday, and an invented address that it types but never submits, so no
 * account is made and nothing is sent to that address. The steps after it (the emailed code, the
 * password) need a real mailbox, so they have no pictures.
 */
import { mkdirSync } from 'node:fs'
import { chromium, type Page } from '@playwright/test'

const OUT = 'public/google-account'
// A phone's width, at twice the pixels, shown at half the size: sharp, and what a person will see
const VIEWPORT = { width: 360, height: 700 }
const HIGHLIGHT = '0 0 0 3px #ff6d00, 0 0 0 7px rgba(255, 109, 0, 0.3)'

/** Outlines the control, so that the picture shows where to tap */
async function mark(page: Page, name: string, role: 'button' | 'textbox'): Promise<void> {
  const control = page.getByRole(role, { name })
  await control.waitFor({ timeout: 15_000 })
  await control.evaluate((element, shadow) => {
    ;(element as HTMLElement).style.boxShadow = shadow
    ;(element as HTMLElement).style.borderRadius = '8px'
  }, HIGHLIGHT)
}

async function shoot(page: Page, name: string): Promise<void> {
  // (Google's pages animate in)
  await page.waitForTimeout(1500)
  await page.screenshot({ path: `${OUT}/${name}.png`, animations: 'disabled' })
  console.log(`  ${OUT}/${name}.png`)
}

mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch()
try {
  const context = await browser.newContext({
    locale: 'en-GB',
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
    colorScheme: 'light',
  })
  const page = await context.newPage()

  await page.goto('https://accounts.google.com/signup?hl=en-GB')
  await page.getByLabel('First name').fill('Alex')
  await page.getByLabel('Surname (optional)').fill('Example')
  await shoot(page, 'step-1-name')
  await page.getByRole('button', { name: 'Next' }).click()

  await page.getByLabel('Day').fill('14')
  await page.getByRole('combobox', { name: 'Month' }).click()
  await page.getByRole('option', { name: 'March' }).click()
  await page.getByLabel('Year').fill('1985')
  await page.getByRole('combobox', { name: 'Gender' }).click()
  await page.getByRole('option', { name: 'Rather not say' }).click()
  await shoot(page, 'step-2-birthday')
  await page.getByRole('button', { name: 'Next' }).click()

  await mark(page, 'Use your existing email', 'button')
  await shoot(page, 'step-3-existing')
  await page.getByRole('button', { name: 'Use your existing email' }).click()

  await page.getByRole('textbox', { name: 'Email address' }).fill('alex.example@hotmail.com')
  await shoot(page, 'step-4-address')
  // (not submitted: nothing more is sent to Google, and no code goes to anyone)
} finally {
  await browser.close()
}
