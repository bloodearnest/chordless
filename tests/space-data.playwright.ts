import type { SpaceSetlist } from '../src/js/space-data-types.ts'
import { expect, seedSong, test } from './fixtures.ts'

test('D1 metadata sends after the local commit without a debounce and replays offline edits on reconnect', async ({
  page,
  context,
}) => {
  await seedSong(page, { setlistId: 'd1-service' })
  const initial: SpaceSetlist = {
    setlistId: 'd1-service',
    date: '2026-10-11',
    time: '10:30',
    type: 'Church Service',
    name: 'Initial',
    leaderId: null,
    createdBy: null,
    createdAt: '2026-10-11T10:00:00Z',
    body: {},
    songs: [],
    version: 1,
    modifiedAt: '2026-10-11T10:00:00Z',
  }
  await page.evaluate(async initial => {
    const { storeSignIn } = await import('/js/google-auth.ts')
    const { getCurrentSpace, updateSpace } = await import('/js/space.ts')
    const { syncSpaceDataFor } = await import('/js/space-data-runtime.ts')
    const server = { row: initial, writes: 0 }
    window.d1SpaceServer = server
    // The page is controlled by a service worker, so mock at the page's HTTP boundary, before it.
    const realFetch = window.fetch.bind(window)
    window.fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input), location.href)
      if (!url.pathname.startsWith('/api/space/wire-team/')) return realFetch(input, init)
      if (url.pathname.endsWith('/batch')) {
        const { ops } = JSON.parse(String(init?.body))
        const results = ops.map(op => {
          if (op.kind !== 'setlist') throw new Error(`Unexpected ${op.kind} write`)
          if (op.baseVersion !== server.row.version)
            return { status: 'conflict', current: server.row }
          server.row = { ...op.record, version: server.row.version + 1 }
          server.writes++
          return { status: 'ok', version: server.row.version }
        })
        return Response.json({ results })
      }
      const etag = `"${server.row.version}"`
      if (new Headers(init?.headers).get('If-None-Match') === etag)
        return new Response(null, { status: 304, headers: { ETag: etag } })
      return Response.json(
        { songs: [], setlists: [server.row], people: [], padSets: [], from: null },
        { headers: { ETag: etag } }
      )
    }
    await storeSignIn('', {
      drive: false,
      session: {
        access_token: 'account-token',
        refresh_token: 'refresh',
        expires_at: '2030-01-01T00:00:00Z',
      },
    })
    const id = getCurrentSpace().id
    if (!id) throw new Error('The fixture must have a current space')
    await updateSpace(id, { team: { id: 'wire-team', role: 'writer' } })
    await syncSpaceDataFor(id)
  }, initial)
  const serverName = () => page.evaluate(() => window.d1SpaceServer?.row.name)
  const writes = () => page.evaluate(() => window.d1SpaceServer?.writes)
  // With page timers paused, neither Drive's debounce nor a periodic tick can deliver these writes.
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 100))
  await page.evaluate(async () => {
    const { getCurrentDB } = await import('/js/db.ts')
    await (await getCurrentDB()).updateSetlist('d1-service', row => {
      row.name = 'Online edit'
    })
  })
  await expect.poll(serverName).toBe('Online edit')
  await expect.poll(writes).toBe(1)
  await context.setOffline(true)
  await page.evaluate(async () => {
    const { getCurrentDB } = await import('/js/db.ts')
    await (await getCurrentDB()).updateSetlist('d1-service', row => {
      row.name = 'Offline edit'
    })
  })
  expect(await serverName()).toBe('Online edit')
  await context.setOffline(false)
  await expect.poll(serverName).toBe('Offline edit')
  expect(await writes()).toBe(2)
})
