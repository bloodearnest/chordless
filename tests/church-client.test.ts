import { expect } from '@open-wc/testing'
import { churchClient } from '../src/js/church-client.ts'
import { installFakeAuthWorker, sessionFor } from './fake-auth-worker.ts'

const { it } = window

it('sends church administration calls with the signed-in session', async () => {
  const { worker, uninstall } = installFakeAuthWorker()
  worker.stored = {
    blob: '',
    metadata: { session: sessionFor('access') },
    updated_at: new Date().toISOString(),
  }
  const original = window.fetch
  const calls: { path: string; method: string; body: unknown }[] = []
  window.fetch = async (input, init) => {
    calls.push({
      path: new URL(String(input)).pathname,
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(String(init.body)) : null,
    })
    if (init?.method === 'DELETE') return new Response(null, { status: 204 })
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  try {
    await churchClient.list()
    await churchClient.matches('123')
    await churchClient.create({
      name: 'Church',
      country: 'GB',
      city: 'York',
      postcode: null,
      ccliLicence: null,
      licences: {},
    })
    await churchClient.update('c', {
      name: 'Church',
      country: 'GB',
      city: 'York',
      postcode: null,
      ccliLicence: null,
      licences: {},
    })
    await churchClient.teams('c')
    await churchClient.members('c')
    await churchClient.addTeam('c', 'Morning')
    await churchClient.archiveTeam('c', 't')
    await churchClient.restoreTeam('c', 't')
    await churchClient.deleteTeam('c', 't')
    await churchClient.addToTeam('c', 't', 'a')
    await churchClient.removeFromTeam('c', 't', 'a')
    await churchClient.setRole('c', 'a', 'writer')
    await churchClient.removeMember('c', 'a')
    await churchClient.invite('c', 't', 'a@example.com', 'reader')
    await churchClient.adopt('c', 't')
    expect(calls.at(-1)).to.deep.include({ path: '/api/churches/c/teams/t/adopt', method: 'POST' })
    await churchClient.join('t', 'secret')
    expect(
      calls.find(call => call.path.endsWith('/members/a') && call.method === 'PUT')?.body
    ).to.deep.equal({ role: 'writer' })
    expect(calls.at(-1)?.body).to.deep.equal({ teamId: 't', code: 'secret' })
  } finally {
    window.fetch = original
    uninstall()
  }
})
