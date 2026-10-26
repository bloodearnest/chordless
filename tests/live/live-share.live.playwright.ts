/**
 * Live sync of a share, in two real browsers (docs/LIVE_SYNC.md): the sharer signed in as the test
 * Google account, with a real Drive folder, and a recipient with no account who opens the link. Both
 * go live. When the sharer adds a song to the setlist, the app syncs it to Drive and updates the
 * share, tells the room, and the recipient's page fetches the share and shows the song: the whole
 * path, in the app's own code, with the time it took.
 *
 * `just test-live`. Needs the test account's credentials; see tests/live/signed-in.ts.
 */
import { expect, type Page, test } from '@playwright/test'
import { cleanUpDrive } from './drive-cleanup.ts'
import { liveEnvironment, signIn } from './signed-in.ts'

const found = liveEnvironment()
test.skip('missing' in found, `needs ${'missing' in found ? found.missing.join(', ') : ''}`)

/** LIVE_DEBUG=1 prints what each page logs, says on its sockets and asks of the share route, with the time */
function watch(page: Page, who: string) {
  if (!process.env.LIVE_DEBUG) return () => {}
  const t0 = Date.now()
  const say = (what: string) =>
    console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s ${who}] ${what}`)
  page.on('console', message => {
    if (/Lit is in dev mode/.test(message.text())) return
    say(`console.${message.type()}: ${message.text().slice(0, 200)}`)
  })
  page.on('pageerror', error => say(`pageerror: ${error.message.slice(0, 200)}`))
  page.on('websocket', socket => {
    say(`websocket ${socket.url().replace(/\?.*/, '')}`)
    socket.on('framesent', frame => say(`  sent ${String(frame.payload).slice(0, 80)}`))
    socket.on('framereceived', frame => say(`  got ${String(frame.payload).slice(0, 80)}`))
    socket.on('close', () => say('  closed'))
  })
  page.on('response', response => {
    if (/\/api\/share\/|googleapis\.com\/upload/.test(response.url())) {
      say(
        `${response.request().method()} ${response
          .url()
          .replace(/^https?:\/\/[^/]+/, '')
          .slice(0, 90)} -> ${response.status()}`
      )
    }
  })
  return say
}

/** The space the running test made in Drive, to be put away whatever happens to it */
let madeSpace: string | undefined
test.afterEach(async () => {
  if (madeSpace) await cleanUpDrive(madeSpace)
  madeSpace = undefined
})

test('a song added by the sharer reaches a recipient who has no account', async ({
  page,
  browser,
}, testInfo) => {
  const stamp = crypto.randomUUID().slice(0, 8)
  const spaceName = `chordless-drive-test live ${stamp}`
  madeSpace = spaceName
  await page.context().addInitScript(() => localStorage.setItem('setup-done', '1'))
  const sharerSays = watch(page, 'sharer')
  await signIn(page)

  {
    // The sharer's library: three songs and a setlist of the first two, in a space of its own, synced
    // so that it has a Drive folder
    const { setlistId, gamma } = await page.evaluate(async name => {
      const { getCurrentDB, createSetlist } = await import('/js/db.ts')
      const { addChart } = await import('/js/song-utils.ts')
      const { getCurrentSpace, updateSpace } = await import('/js/space.ts')
      const { createSyncOrchestrator } = await import('/js/sync-orchestrator.ts')

      const db = await getCurrentDB()
      const songs = []
      for (const title of ['Live Alpha', 'Live Beta', 'Live Gamma']) {
        songs.push(await addChart(db, `{title: ${title}}\n{key: G}\n\n[G]${title} line`, {}))
      }
      const entry = (song: (typeof songs)[number], order: number) => ({
        order,
        songId: song.id,
        songUuid: song.uuid,
        key: 'G',
        tempo: null,
        notes: '',
      })
      const setlist = {
        ...createSetlist({ owner: 'Live Test' }),
        songs: [entry(songs[0], 0), entry(songs[1], 1)],
      }
      await db.saveSetlist(setlist)
      const current = getCurrentSpace()
      await updateSpace(current.id, { name })
      await (await createSyncOrchestrator(name, current.id)).sync()
      return { setlistId: setlist.id, gamma: entry(songs[2], 2) }
    }, spaceName)

    // The sharer shares it, as a person does
    await page.goto(`/setlist/${setlistId}`)
    await page.locator('#share-button').click()
    await page.getByRole('button', { name: 'Create share link' }).click()
    await expect(page.getByRole('button', { name: 'Copy link' })).toBeVisible({ timeout: 60_000 })
    const link = await page.evaluate(async id => {
      const { getCurrentDB } = await import('/js/db.ts')
      const { shareUrl } = await import('/js/share-crypto.ts')
      const share = (await (await getCurrentDB()).getSetlist(id))?.share
      if (!share) throw new Error('the setlist has no share')
      return shareUrl(location.origin, share.fileId, share.key, id)
    }, setlistId)
    await page.getByRole('button', { name: /close/i }).click()
    await expect(page.getByRole('dialog')).toBeHidden()

    // The recipient has never seen the app and has no account
    const recipientContext = await browser.newContext({ locale: 'en-GB' })
    await recipientContext.addInitScript(() => localStorage.setItem('setup-done', '1'))
    const recipient = await recipientContext.newPage()
    const recipientSays = watch(recipient, 'recipient')
    await recipient.goto(link)
    await expect(recipient.locator('setlist-overview')).toContainText('Live Alpha', {
      timeout: 60_000,
    })
    await expect(recipient.locator('setlist-overview')).not.toContainText('Live Gamma')

    // Both go live, and each says its channel is up
    await page.locator('#live-button').click()
    await recipient.locator('#live-button').click()
    await expect(page.locator('#live-button')).toHaveAttribute('data-sync', 'connected', {
      timeout: 30_000,
    })
    await expect(recipient.locator('#live-button')).toHaveAttribute('data-sync', 'connected', {
      timeout: 30_000,
    })

    // The sharer adds the song, as a late song is added: the app syncs it, updates the share and tells
    const started = Date.now()
    sharerSays('EDIT: the song is added')
    await page.evaluate(
      async ({ id, entry }) => {
        const { getCurrentDB } = await import('/js/db.ts')
        await (await getCurrentDB()).updateSetlist(id, stored => {
          stored.songs.push(entry)
          stored.modifiedDate = new Date().toISOString()
        })
      },
      { id: setlistId, entry: gamma }
    )

    await expect(recipient.locator('setlist-overview')).toContainText('Live Gamma', {
      timeout: 60_000,
    })
    const took = Date.now() - started
    recipientSays('the page shows the song')
    testInfo.annotations.push({
      type: 'took',
      description: `${took} ms from the edit to the recipient's page`,
    })
    console.log(`the recipient saw the song ${took} ms after the sharer's edit`)
    await recipientContext.close()
  }
})
