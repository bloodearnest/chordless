import { expect } from '@esm-bundle/chai'
import { suppressConsoleLogs } from './test-helpers.js'

const { describe, it } = window

suppressConsoleLogs()

import { reconcileSetlists, reconcileSongs } from '../js/sync/reconciler.js'

const now = (offset = 0) => new Date(Date.now() + offset).toISOString()

describe('sync: reconcile setlists', () => {
  it('uploads local-only records', () => {
    const plan = reconcileSetlists([{ id: '2024-01-01', updatedAt: now() }], [])
    expect(plan).to.have.lengthOf(1)
    expect(plan[0]).to.include({ action: 'upload', entityType: 'setlist', id: '2024-01-01' })
  })

  it('downloads remote-only records', () => {
    const plan = reconcileSetlists([], [{ id: '2024-01-01', updatedAt: now() }])
    expect(plan).to.have.lengthOf(1)
    expect(plan[0].action).to.equal('download')
  })

  it('prefers newer timestamps', () => {
    const local = { id: 'set1', updatedAt: '2024-01-01T00:00:00.000Z' }
    const remote = { id: 'set1', updatedAt: '2024-02-01T00:00:00.000Z' }
    const plan = reconcileSetlists([local], [remote])
    expect(plan[0].action).to.equal('download')
  })

  it('prefers remote when timestamps tie', () => {
    const updatedAt = '2024-01-01T00:00:00.000Z'
    const plan = reconcileSetlists([{ id: 'set1', updatedAt }], [{ id: 'set1', updatedAt }])
    expect(plan[0].action).to.equal('download')
  })

  it('deletes remote when removed locally', () => {
    const plan = reconcileSetlists(
      [{ id: 'set1', updatedAt: now(), deletedAt: now() }],
      [{ id: 'set1', updatedAt: now() }]
    )
    expect(plan[0].action).to.equal('deleteRemote')
  })
})

describe('sync: reconcile songs', () => {
  it('deletes local when removed remotely', () => {
    const plan = reconcileSongs(
      [{ id: 'song1', updatedAt: now() }],
      [{ id: 'song1', updatedAt: now(), deletedAt: now() }]
    )
    expect(plan[0].action).to.equal('deleteLocal')
  })

  it('produces upload and download operations for distinct entries', () => {
    const plan = reconcileSongs(
      [{ id: 'song-local', updatedAt: now() }],
      [{ id: 'song-remote', updatedAt: now() }]
    )
    expect(plan).to.have.lengthOf(2)
    expect(plan.some(entry => entry.action === 'upload')).to.be.true
    expect(plan.some(entry => entry.action === 'download')).to.be.true
  })
})
