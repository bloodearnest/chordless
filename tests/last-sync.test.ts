import { expect } from '@open-wc/testing'
import { forgetSync, formatSyncTime, lastSyncOf, recordSync } from '../src/js/last-sync.ts'
import { getCurrentSpace } from '../src/js/space.ts'
import { spaceKind, spaceRole } from '../src/js/space-label.ts'

const { describe, it, afterEach } = window

describe('when a space last synced', () => {
  const id = `space-${crypto.randomUUID()}`
  afterEach(() => {
    forgetSync(id)
    localStorage.removeItem('last-sync-time')
  })

  it('is noted for each space, and forgotten with it', () => {
    expect(lastSyncOf(id)).to.equal(null)
    const at = recordSync(id)
    expect(lastSyncOf(id)).to.equal(at)
    expect(lastSyncOf(`${id}-other`)).to.equal(null)
    forgetSync(id)
    expect(lastSyncOf(id)).to.equal(null)
  })

  it('falls back to the one time kept before there were several, for the space in use only', () => {
    localStorage.setItem('last-sync-time', '2026-01-01T00:00:00.000Z')
    expect(lastSyncOf(id)).to.equal(null)
    const current = getCurrentSpace().id
    if (current) expect(lastSyncOf(current)).to.equal('2026-01-01T00:00:00.000Z')
  })

  it('reads as how long ago, and as a date after a week', () => {
    const now = new Date('2026-10-22T12:00:00Z')
    const ago = (ms: number) => new Date(now.getTime() - ms).toISOString()
    expect(formatSyncTime(ago(10_000), now)).to.equal('Just now')
    expect(formatSyncTime(ago(60_000), now)).to.equal('1 minute ago')
    expect(formatSyncTime(ago(5 * 60_000), now)).to.equal('5 minutes ago')
    expect(formatSyncTime(ago(3_600_000), now)).to.equal('1 hour ago')
    expect(formatSyncTime(ago(5 * 3_600_000), now)).to.equal('5 hours ago')
    expect(formatSyncTime(ago(86_400_000), now)).to.equal('1 day ago')
    expect(formatSyncTime(ago(3 * 86_400_000), now)).to.equal('3 days ago')
    expect(formatSyncTime(ago(30 * 86_400_000), now)).to.equal(
      new Date(ago(30 * 86_400_000)).toLocaleDateString()
    )
  })
})

describe('how a space is labelled to people', () => {
  it('is Personal for a space of one’s own, with no label while it is still called Personal', () => {
    expect(spaceKind({ name: 'Bea Singer' })).to.equal('Personal')
    expect(spaceKind({ name: 'Personal' })).to.equal(null)
  })

  it('is Team for a Team, whatever it is called', () => {
    expect(spaceKind({ name: 'Gateway Church', team: { id: 't', role: 'owner' } })).to.equal('Team')
    expect(spaceKind({ name: 'Personal', team: { id: 't', role: 'writer' } })).to.equal('Team')
  })

  it('says what the person is in a Team, or that a space is view-only, and nothing for their own', () => {
    expect(spaceRole({ team: { id: 't', role: 'writer' } })).to.equal('worship leader')
    expect(spaceRole({ team: { id: 't', role: 'reader' } })).to.equal('team member')
    expect(spaceRole({ team: { id: 't', role: 'owner' } })).to.equal('owner')
    expect(spaceRole({ readOnly: true })).to.equal('view only')
    expect(spaceRole({})).to.equal(null)
  })
})
