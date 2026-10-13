// A setlist's song settings and the media player's settings

import type { MusicalMetadataDisplay } from '../src/components/musical-metadata-display.ts'
import type { SongSettingsPopover } from '../src/components/song-settings-popover.ts'
import type { ChordProRecord } from '../src/js/data-types.ts'
import { expect, fromDB, seedSong, test } from './fixtures.ts'
import { must } from './must.ts'

test.describe('Song settings', () => {
  test("this user's click and pad choices for a song stay on this device, and reach the player", async ({
    page,
  }) => {
    await seedSong(page, { setlistId: 'media-prefs-setlist' })
    const openSong = async () => {
      await page.goto('/setlist/media-prefs-setlist')
      await page.locator('setlist-overview song-card').first().click()
      await expect(page.locator('#app-header')).toContainText('Info Test Song')
    }
    await openSong()
    // Not here: it is on the player, which edits the song being viewed
    await expect(page.locator('song-settings-popover').getByLabel('Click:')).toHaveCount(0)
    const player = page.locator('#media-player')
    await player.evaluate(element => {
      ;(element as unknown as { _collapsed: boolean })._collapsed = false
    })
    const speed = player.getByRole('button', { name: 'Double-speed click for this song' })
    await expect(speed).toHaveAttribute('aria-pressed', 'false')
    await speed.click()

    // The player is told
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              document.getElementById('media-player') as unknown as {
                _currentDoubleClick?: boolean
              }
            )._currentDoubleClick
        )
      )
      .toBe(true)

    // It is this user's, on this device: nothing in the setlist
    const setlist = await fromDB(page, 'getSetlist', 'media-prefs-setlist')
    expect(JSON.stringify(setlist)).not.toContain('doubleClick')

    await openSong()
    await player.evaluate(element => {
      ;(element as unknown as { _collapsed: boolean })._collapsed = false
    })
    await expect(
      player.getByRole('button', { name: 'Double-speed click for this song' })
    ).toHaveAttribute('aria-pressed', 'true')
  })

  test("the setlist's BPM survives a reload, over the library song's own", async ({ page }) => {
    await seedSong(page, { setlistId: 'bpm-test-setlist' })
    // Give the library song a tempo of its own
    await page.evaluate(async () => {
      const { getCurrentDB } = await import('/js/db.ts')
      const db = await getCurrentDB()
      const chart = (await db.getChordPro('chordpro-info-test')) as ChordProRecord
      await db.saveChordPro({
        ...chart,
        content: chart.content.replace('{key: G}', '{key: G}\n{tempo: 72}'),
      })
    })
    const metadata = page.locator('#musical-metadata')
    const openSong = async () => {
      await page.goto('/setlist/bpm-test-setlist')
      await page.locator('setlist-overview song-card').first().click()
      await expect(page.locator('#app-header')).toContainText('Info Test Song')
    }

    await openSong()
    await expect
      .poll(() => metadata.evaluate(element => (element as MusicalMetadataDisplay).bpm))
      .toBe(72)
    await page.locator('#app-header').getByRole('button', { name: 'Toggle edit mode' }).click()
    await expect(metadata).toHaveAttribute('edit-mode')
    await metadata.click()
    const popover = page.locator('song-settings-popover')
    await popover.getByRole('button', { name: 'Increase BPM' }).click()
    await expect(popover.locator('.bpm-value')).toHaveText('73')
    await expect
      .poll(() => metadata.evaluate(element => (element as MusicalMetadataDisplay).bpm))
      .toBe(73)
    const setlist = await fromDB(page, 'getSetlist', 'bpm-test-setlist')
    expect(setlist.songs[0].tempo).toBe(73)

    await openSong()
    await expect
      .poll(() => metadata.evaluate(element => (element as MusicalMetadataDisplay).bpm))
      .toBe(73)
  })

  test('the song settings show no capo, label or value, while the capo is off', async ({
    page,
  }) => {
    await seedSong(page, { setlistId: 'no-capo-setlist' })
    await page.goto('/setlist/no-capo-setlist')
    await page.locator('setlist-overview song-card').first().click()
    await expect(page.locator('#app-header')).toContainText('Info Test Song')
    await page.locator('#app-header').getByRole('button', { name: 'Toggle edit mode' }).click()
    await page.locator('#musical-metadata').click()

    const popover = page.locator('song-settings-popover')
    await expect(popover.getByRole('button', { name: /^Key/ })).toBeVisible()
    await expect(popover.getByRole('button', { name: /^Capo/ })).toBeHidden()
    await expect(popover.locator('#capo-selector')).toBeHidden()

    // The BPM row is still a row of its own, under the key
    const key = await popover.getByRole('button', { name: /^Key/ }).boundingBox()
    const bpm = await popover.getByRole('button', { name: 'Decrease BPM' }).boundingBox()
    expect(must(bpm).y).toBeGreaterThan(must(key).y + must(key).height - 1)
  })

  test('choosing a capo in the song settings changes it, and keeps it', async ({ page }) => {
    await seedSong(page, { setlistId: 'capo-test-setlist' })
    await page.evaluate(() => localStorage.setItem('enable_capo', 'true'))
    await page.goto('/setlist/capo-test-setlist')
    await page.locator('setlist-overview song-card').first().click()
    await expect(page.locator('#app-header')).toContainText('Info Test Song')
    await page.locator('#app-header').getByRole('button', { name: 'Toggle edit mode' }).click()
    await page.locator('#musical-metadata').click()

    const capo = page.locator('#capo-selector')
    await capo.getByRole('button', { name: /^Capo/ }).click()
    await capo.getByRole('option', { name: /^2\b/ }).click()
    await expect(capo.getByRole('button', { name: /^Capo/ })).toHaveText('2')
    const capoShown = () =>
      page.locator('#musical-metadata').evaluate(m => (m as MusicalMetadataDisplay).capoValue)
    await expect.poll(capoShown).toBe(2)

    // ...and after a reload
    await page.reload()
    await expect(page.locator('#app-header')).toContainText('Info Test Song')
    await expect.poll(capoShown).toBe(2)
  })

  test('asking to reset a song closes the settings popover, which would cover the question', async ({
    page,
  }) => {
    await seedSong(page, { setlistId: 'reset-test-setlist' })
    await page.goto('/setlist/reset-test-setlist')
    await page.locator('setlist-overview song-card').first().click()
    await expect(page.locator('#app-header')).toContainText('Info Test Song')
    await page.locator('#app-header').getByRole('button', { name: 'Toggle edit mode' }).click()
    await expect(page.locator('#musical-metadata')).toHaveAttribute('edit-mode')
    await page.locator('#musical-metadata').click()
    const popover = page.locator('song-settings-popover')
    await expect
      .poll(() => popover.evaluate(element => (element as SongSettingsPopover).isOpen()))
      .toBe(true)

    await popover.getByRole('button', { name: 'Reset song' }).click()
    const modal = page.locator('#reset-confirm-modal')
    await expect(modal).toHaveAttribute('open', '')
    expect(await popover.evaluate(element => (element as SongSettingsPopover).isOpen())).toBe(false)

    await modal.getByRole('button', { name: 'Cancel' }).click()
    await expect(modal).not.toHaveAttribute('open', '')
  })
})

test.describe('Media player settings', () => {
  test("the player's settings open in a modal, which Esc closes", async ({ page }) => {
    await seedSong(page, { setlistId: 'player-modal-setlist' })
    await page.goto('/setlist/player-modal-setlist')
    const player = page.locator('media-player')
    await player.getByRole('button', { name: 'Expand player' }).click()
    await player.getByRole('button', { name: 'Settings' }).click()

    const modal = player.locator('app-modal')
    await expect(modal).toHaveAttribute('open', '')
    await expect(modal.getByRole('switch', { name: 'Enable Pads' })).toBeVisible()
    // Esc still closes it after a click inside
    await modal.getByText('Background pad audio playback').click()
    await page.keyboard.press('Escape')
    await expect(modal).not.toHaveAttribute('open', '')
    await expect(modal.locator('media-player-settings')).toHaveCount(0)
  })

  test('its switches work from the keyboard, and are off limits while the player is off', async ({
    page,
  }) => {
    await page.goto('/preferences')
    const settings = page.locator('media-player-settings')
    const player = settings.getByRole('switch', { name: 'Enable Media Player' })
    const pads = settings.getByRole('switch', { name: 'Enable Pads' })
    await expect(player).toHaveAttribute('aria-checked', 'true')

    const padsWere = await pads.getAttribute('aria-checked')
    await pads.focus()
    await page.keyboard.press('Space')
    await expect(pads).not.toHaveAttribute('aria-checked', must(padsWere))

    await player.focus()
    await page.keyboard.press('Enter')
    await expect(player).toHaveAttribute('aria-checked', 'false')
    await expect(pads).toBeDisabled()
    await expect(settings.getByRole('switch', { name: 'Stereo Split (L/R)' })).toBeDisabled()
  })

  test('turning the media player off in preferences hides it on setlists', async ({ page }) => {
    await seedSong(page, { setlistId: 'player-test-setlist' })

    await page.goto('/setlist/player-test-setlist')
    await expect(page.locator('media-player')).toBeVisible()

    await page.goto('/preferences')
    const masterToggle = page.getByRole('switch', { name: 'Enable Media Player' })
    await masterToggle.click()
    await expect(masterToggle).toHaveAttribute('aria-checked', 'false')

    await page.goto('/setlist/player-test-setlist')
    await expect(page.locator('#app-header')).toContainText(/Sun,? 11 Oct/)
    await expect(page.locator('media-player')).toBeHidden()
  })
})

test.describe('Popups in the song settings', () => {
  test('a tap outside the key picker, or Esc, closes it and leaves the settings open', async ({
    page,
  }) => {
    await seedSong(page, { setlistId: 'popup-test-setlist' })
    await page.goto('/setlist/popup-test-setlist')
    await page.locator('setlist-overview song-card').first().click()
    await expect(page.locator('#app-header')).toContainText('Info Test Song')
    await page.locator('#app-header').getByRole('button', { name: 'Toggle edit mode' }).click()
    await expect(page.locator('#musical-metadata')).toHaveAttribute('edit-mode')
    await page.locator('#musical-metadata').click()
    const settings = page.locator('song-settings-popover')
    await expect
      .poll(() => settings.evaluate(element => (element as SongSettingsPopover).isOpen()))
      .toBe(true)

    const key = page.locator('#key-selector')
    const options = key.getByRole('listbox')
    const keyButton = key.getByRole('button', { name: /^Key/ })
    await keyButton.click()
    await expect(options).toBeVisible()
    await expect(keyButton).toHaveAttribute('aria-expanded', 'true')

    // A tap outside. (iPadOS before 18.3 left a popover open for this.)
    await page.mouse.click(5, 300)
    await expect(options).toBeHidden()
    await expect(keyButton).toHaveAttribute('aria-expanded', 'false')
    expect(await settings.evaluate(element => (element as SongSettingsPopover).isOpen())).toBe(true)

    await keyButton.click()
    await expect(options).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(options).toBeHidden()
    expect(await settings.evaluate(element => (element as SongSettingsPopover).isOpen())).toBe(true)

    // The next Esc is the settings'
    await page.keyboard.press('Escape')
    await expect
      .poll(() => settings.evaluate(element => (element as SongSettingsPopover).isOpen()))
      .toBe(false)
  })
})
