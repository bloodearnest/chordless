import { expect } from '@esm-bundle/chai'
import { reconcileRecords, reconcileSetlists, reconcileSongs } from '../js/sync/reconciler.js'

/**
 * Advanced conflict resolution tests for Drive sync
 * Tests various scenarios where local and remote have diverged
 */

describe('Drive Sync Conflict Resolution', () => {
  const now = Date.now()
  const oneHourAgo = now - 60 * 60 * 1000
  const twoHoursAgo = now - 2 * 60 * 60 * 1000
  const yesterday = now - 24 * 60 * 60 * 1000

  const toISO = ms => new Date(ms).toISOString()

  describe('Song Variant Conflicts', () => {
    it('should download remote when both changed but remote is newer', () => {
      const local = {
        id: 'amazing-grace',
        uuid: 'variant-1',
        modifiedDate: toISO(twoHoursAgo),
        isDefault: true,
        variantOf: null,
        contentHash: 'local-hash-123',
        lastSyncedAt: toISO(yesterday),
      }

      const remote = {
        id: 'amazing-grace',
        uuid: 'variant-1',
        modifiedDate: toISO(oneHourAgo),
        isDefault: false, // Remote changed this
        variantOf: null,
        contentHash: 'remote-hash-456',
      }

      const plan = reconcileSongs([local], [remote])
      expect(plan).to.have.lengthOf(1)
      expect(plan[0].action).to.equal('download')
      expect(plan[0].record.isDefault).to.equal(false)
      expect(plan[0].record.contentHash).to.equal('remote-hash-456')
    })

    it('should upload local when local is newer', () => {
      const local = {
        id: 'amazing-grace',
        uuid: 'variant-1',
        modifiedDate: toISO(oneHourAgo),
        isDefault: true,
        variantOf: null,
        contentHash: 'local-hash-789',
        lastSyncedAt: toISO(yesterday),
      }

      const remote = {
        id: 'amazing-grace',
        uuid: 'variant-1',
        modifiedDate: toISO(twoHoursAgo),
        isDefault: false,
        variantOf: null,
        contentHash: 'remote-hash-456',
      }

      const plan = reconcileSongs([local], [remote])
      expect(plan).to.have.lengthOf(1)
      expect(plan[0].action).to.equal('upload')
      expect(plan[0].record.isDefault).to.equal(true)
      expect(plan[0].record.contentHash).to.equal('local-hash-789')
    })

    it('should handle variant hierarchy changes from remote', () => {
      // Scenario: Remote promoted a different variant to default
      // NOTE: reconciler uses 'id' as unique key, so each variant needs unique id
      const localOriginal = {
        id: 'original-uuid',
        songId: 'amazing-grace',
        modifiedDate: toISO(yesterday),
        isDefault: true,
        variantOf: null,
      }

      const localSimplified = {
        id: 'simplified-uuid',
        songId: 'amazing-grace',
        modifiedDate: toISO(yesterday),
        isDefault: false,
        variantOf: 'original-uuid',
      }

      // Remote has promoted simplified to default
      const remoteOriginal = {
        id: 'original-uuid',
        songId: 'amazing-grace',
        modifiedDate: toISO(oneHourAgo),
        isDefault: false, // No longer default
        variantOf: null,
      }

      const remoteSimplified = {
        id: 'simplified-uuid',
        songId: 'amazing-grace',
        modifiedDate: toISO(oneHourAgo),
        isDefault: true, // Now default
        variantOf: 'original-uuid',
      }

      const plan = reconcileSongs(
        [localOriginal, localSimplified],
        [remoteOriginal, remoteSimplified]
      )

      expect(plan).to.have.lengthOf(2)
      expect(plan.every(p => p.action === 'download')).to.be.true

      const originalPlan = plan.find(p => p.id === 'original-uuid')
      const simplifiedPlan = plan.find(p => p.id === 'simplified-uuid')

      expect(originalPlan.record.isDefault).to.equal(false)
      expect(simplifiedPlan.record.isDefault).to.equal(true)
    })

    it('should preserve variant relationships during sync', () => {
      const local = {
        id: 'amazing-grace',
        uuid: 'variant-2',
        modifiedDate: toISO(yesterday),
        isDefault: false,
        variantOf: 'original-uuid',
        importDate: toISO(yesterday),
        importUser: 'user1@church.org',
      }

      const remote = {
        id: 'amazing-grace',
        uuid: 'variant-2',
        modifiedDate: toISO(oneHourAgo),
        isDefault: false,
        variantOf: 'original-uuid', // Relationship preserved
        importDate: toISO(yesterday),
        importUser: 'user1@church.org',
      }

      const plan = reconcileSongs([local], [remote])
      expect(plan[0].action).to.equal('download')
      expect(plan[0].record.variantOf).to.equal('original-uuid')
    })
  })

  describe('Setlist Conflicts', () => {
    it('should download remote setlist when both changed but remote is newer', () => {
      const local = {
        id: 'setlist-2024-01-01',
        date: '2024-01-01',
        modifiedDate: toISO(twoHoursAgo),
        songs: [{ songId: 'song1', order: 0 }],
        owner: 'John',
        lastSyncedAt: toISO(yesterday),
      }

      const remote = {
        id: 'setlist-2024-01-01',
        date: '2024-01-01',
        modifiedDate: toISO(oneHourAgo),
        songs: [
          { songId: 'song1', order: 0 },
          { songId: 'song2', order: 1 },
        ], // Remote added a song
        owner: 'Jane', // Remote changed owner
      }

      const plan = reconcileSetlists([local], [remote])
      expect(plan).to.have.lengthOf(1)
      expect(plan[0].action).to.equal('download')
      expect(plan[0].record.songs).to.have.lengthOf(2)
      expect(plan[0].record.owner).to.equal('Jane')
    })

    it('should upload local setlist when local is newer', () => {
      const local = {
        id: 'setlist-2024-01-01',
        date: '2024-01-01',
        modifiedDate: toISO(oneHourAgo),
        songs: [
          { songId: 'song1', order: 0 },
          { songId: 'song2', order: 1 },
        ],
        owner: 'John',
        lastSyncedAt: toISO(yesterday),
      }

      const remote = {
        id: 'setlist-2024-01-01',
        date: '2024-01-01',
        modifiedDate: toISO(twoHoursAgo),
        songs: [{ songId: 'song1', order: 0 }],
        owner: 'Jane',
      }

      const plan = reconcileSetlists([local], [remote])
      expect(plan).to.have.lengthOf(1)
      expect(plan[0].action).to.equal('upload')
      expect(plan[0].record.songs).to.have.lengthOf(2)
      expect(plan[0].record.owner).to.equal('John')
    })

    it('should handle setlist deletion conflicts - remote deleted', () => {
      const local = {
        id: 'setlist-2024-01-01',
        date: '2024-01-01',
        modifiedDate: toISO(yesterday),
        songs: [{ songId: 'song1', order: 0 }],
      }

      const remote = {
        id: 'setlist-2024-01-01',
        date: '2024-01-01',
        modifiedDate: toISO(oneHourAgo),
        deletedAt: toISO(oneHourAgo),
      }

      const plan = reconcileSetlists([local], [remote])
      expect(plan).to.have.lengthOf(1)
      expect(plan[0].action).to.equal('deleteLocal')
    })

    it('should handle setlist deletion conflicts - local deleted', () => {
      const local = {
        id: 'setlist-2024-01-01',
        date: '2024-01-01',
        modifiedDate: toISO(oneHourAgo),
        deletedAt: toISO(oneHourAgo),
      }

      const remote = {
        id: 'setlist-2024-01-01',
        date: '2024-01-01',
        modifiedDate: toISO(yesterday),
        songs: [{ songId: 'song1', order: 0 }],
      }

      const plan = reconcileSetlists([local], [remote])
      expect(plan).to.have.lengthOf(1)
      expect(plan[0].action).to.equal('deleteRemote')
    })

    it('should noop when both local and remote are deleted', () => {
      const local = {
        id: 'setlist-2024-01-01',
        deletedAt: toISO(oneHourAgo),
        modifiedDate: toISO(oneHourAgo),
      }

      const remote = {
        id: 'setlist-2024-01-01',
        deletedAt: toISO(oneHourAgo),
        modifiedDate: toISO(oneHourAgo),
      }

      const plan = reconcileSetlists([local], [remote])
      expect(plan).to.have.lengthOf(1)
      expect(plan[0].action).to.equal('noop')
    })
  })

  describe('Timestamp Edge Cases', () => {
    it('should prefer remote when timestamps are equal (default behavior)', () => {
      const timestamp = toISO(now)
      const local = {
        id: 'song1',
        modifiedDate: timestamp,
        contentHash: 'local-hash',
      }

      const remote = {
        id: 'song1',
        modifiedDate: timestamp,
        contentHash: 'remote-hash',
      }

      const plan = reconcileSongs([local], [remote])
      expect(plan[0].action).to.equal('download')
      expect(plan[0].record.contentHash).to.equal('remote-hash')
    })

    it('should allow preferring local on tie with option', () => {
      const timestamp = toISO(now)
      const local = {
        id: 'song1',
        modifiedDate: timestamp,
        contentHash: 'local-hash',
      }

      const remote = {
        id: 'song1',
        modifiedDate: timestamp,
        contentHash: 'remote-hash',
      }

      const plan = reconcileSongs([local], [remote], { preferRemoteOnConflict: false })
      expect(plan[0].action).to.equal('upload')
      expect(plan[0].record.contentHash).to.equal('local-hash')
    })

    it('should handle missing/invalid timestamps', () => {
      const local = {
        id: 'song1',
        modifiedDate: null,
        contentHash: 'local-hash',
      }

      const remote = {
        id: 'song1',
        modifiedDate: 'invalid-date',
        contentHash: 'remote-hash',
      }

      // Both will normalize to 0, should prefer remote on tie
      const plan = reconcileSongs([local], [remote])
      expect(plan[0].action).to.equal('download')
    })

    it('should handle one valid timestamp vs missing', () => {
      const local = {
        id: 'song1',
        modifiedDate: toISO(oneHourAgo),
        contentHash: 'local-hash',
      }

      const remote = {
        id: 'song1',
        modifiedDate: null,
        contentHash: 'remote-hash',
      }

      // Local has valid timestamp, should upload
      const plan = reconcileSongs([local], [remote])
      expect(plan[0].action).to.equal('upload')
    })
  })

  describe('Multi-entity Conflicts', () => {
    it('should handle multiple songs with different conflict types', () => {
      const localSongs = [
        { id: 'song1', uuid: 'uuid1', modifiedDate: toISO(oneHourAgo) }, // Local newer
        { id: 'song2', uuid: 'uuid2', modifiedDate: toISO(twoHoursAgo) }, // Remote newer
        { id: 'song3', uuid: 'uuid3', modifiedDate: toISO(yesterday) }, // Local only
      ]

      const remoteSongs = [
        { id: 'song1', uuid: 'uuid1', modifiedDate: toISO(twoHoursAgo) },
        { id: 'song2', uuid: 'uuid2', modifiedDate: toISO(oneHourAgo) },
        { id: 'song4', uuid: 'uuid4', modifiedDate: toISO(oneHourAgo) }, // Remote only
      ]

      const plan = reconcileSongs(localSongs, remoteSongs)
      expect(plan).to.have.lengthOf(4)

      const song1Plan = plan.find(p => p.id === 'song1')
      const song2Plan = plan.find(p => p.id === 'song2')
      const song3Plan = plan.find(p => p.id === 'song3')
      const song4Plan = plan.find(p => p.id === 'song4')

      expect(song1Plan.action).to.equal('upload') // Local newer
      expect(song2Plan.action).to.equal('download') // Remote newer
      expect(song3Plan.action).to.equal('upload') // Local only
      expect(song4Plan.action).to.equal('download') // Remote only
    })

    it('should handle variant promotion scenario with multiple users', () => {
      // Scenario: User A created a simplified variant offline
      // User B promoted that variant to default online
      // User A syncs - should download the promotion change
      // NOTE: Each variant has unique id (uuid in real system)

      const localOriginal = {
        id: 'original',
        songId: 'song',
        modifiedDate: toISO(yesterday),
        isDefault: true,
        variantOf: null,
      }

      const localSimplified = {
        id: 'simplified',
        songId: 'song',
        modifiedDate: toISO(oneHourAgo), // User A just created this
        isDefault: false,
        variantOf: 'original',
      }

      const remoteOriginal = {
        id: 'original',
        songId: 'song',
        modifiedDate: toISO(oneHourAgo), // User B demoted this
        isDefault: false,
        variantOf: null,
      }

      const remoteSimplified = {
        id: 'simplified',
        songId: 'song',
        modifiedDate: toISO(oneHourAgo), // User B promoted this
        isDefault: true,
        variantOf: 'original',
      }

      const plan = reconcileSongs(
        [localOriginal, localSimplified],
        [remoteOriginal, remoteSimplified]
      )

      // Both should download (remote modified at same time)
      expect(plan).to.have.lengthOf(2)

      // When timestamps tie, prefer remote
      const originalPlan = plan.find(p => p.id === 'original')
      const simplifiedPlan = plan.find(p => p.id === 'simplified')

      expect(originalPlan.action).to.equal('download')
      expect(simplifiedPlan.action).to.equal('download')
      expect(originalPlan.record.isDefault).to.equal(false)
      expect(simplifiedPlan.record.isDefault).to.equal(true)
    })
  })

  describe('Import Metadata Conflicts', () => {
    it('should preserve import metadata when downloading remote changes', () => {
      const local = {
        id: 'song1',
        uuid: 'uuid1',
        modifiedDate: toISO(yesterday),
        importDate: toISO(yesterday),
        importUser: 'user@church.org',
        importSource: 'songselect',
        sourceUrl: 'https://songselect.ccli.com/songs/12345',
      }

      const remote = {
        id: 'song1',
        uuid: 'uuid1',
        modifiedDate: toISO(oneHourAgo),
        importDate: toISO(yesterday), // Same import metadata
        importUser: 'user@church.org',
        importSource: 'songselect',
        sourceUrl: 'https://songselect.ccli.com/songs/12345',
        contentHash: 'updated-hash', // But content changed
      }

      const plan = reconcileSongs([local], [remote])
      expect(plan[0].action).to.equal('download')
      expect(plan[0].record.importUser).to.equal('user@church.org')
      expect(plan[0].record.importSource).to.equal('songselect')
    })

    it('should handle import metadata changes from collaborators', () => {
      // Scenario: Collaborator corrected the import source
      const local = {
        id: 'song1',
        uuid: 'uuid1',
        modifiedDate: toISO(yesterday),
        importDate: toISO(yesterday),
        importUser: 'user1@church.org',
        importSource: 'manual', // Wrong
        sourceUrl: '',
      }

      const remote = {
        id: 'song1',
        uuid: 'uuid1',
        modifiedDate: toISO(oneHourAgo),
        importDate: toISO(yesterday),
        importUser: 'user2@church.org', // Different user corrected it
        importSource: 'songselect', // Corrected
        sourceUrl: 'https://songselect.ccli.com/songs/12345',
      }

      const plan = reconcileSongs([local], [remote])
      expect(plan[0].action).to.equal('download')
      expect(plan[0].record.importSource).to.equal('songselect')
      expect(plan[0].record.sourceUrl).to.equal('https://songselect.ccli.com/songs/12345')
    })
  })

  describe('Reconciliation Options', () => {
    it('should respect custom entity type in plan', () => {
      const plan = reconcileRecords([{ id: '1', modifiedDate: toISO(now) }], [], {
        entityType: 'custom',
      })
      expect(plan[0].entityType).to.equal('custom')
    })

    it('should handle empty arrays gracefully', () => {
      const plan = reconcileSongs([], [])
      expect(plan).to.have.lengthOf(0)
    })

    it('should handle null/undefined inputs gracefully', () => {
      // The reconciler expects arrays, so undefined/null will be coerced to []
      const plan1 = reconcileSongs(undefined, undefined)
      expect(plan1).to.have.lengthOf(0)

      const plan2 = reconcileSongs([], undefined)
      expect(plan2).to.have.lengthOf(0)

      const plan3 = reconcileSongs(undefined, [])
      expect(plan3).to.have.lengthOf(0)
    })
  })
})
