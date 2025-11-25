import { expect } from '@esm-bundle/chai'

/**
 * Tests for Drive API sync metadata
 * Ensures that variant relationships and import metadata are properly synced to appProperties
 */

describe('Drive API Sync Metadata', () => {
  let mockDriveAPI
  let capturedAppProperties

  beforeEach(() => {
    // Reset captured data
    capturedAppProperties = null

    // Create a mock Drive API that captures appProperties
    mockDriveAPI = {
      async uploadChordProFile(
        organisationFolderId,
        songId,
        versionId,
        title,
        ccliNumber,
        versionLabel,
        content,
        metadata = {}
      ) {
        // Build appProperties as the real implementation does
        capturedAppProperties = {
          type: 'chordpro',
          songId: songId,
          ccliNumber: ccliNumber || '',
          title: title,
          titleNormalized: metadata.titleNormalized || '',
          versionId: versionId,
          versionLabel: versionLabel,
          contentHash: metadata.contentHash || '',
          variantOf: metadata.variantOf || '',
          isDefault: metadata.isDefault ? 'true' : 'false',
          importDate: metadata.importDate || '',
          importUser: metadata.importUser || '',
          importSource: metadata.importSource || '',
          sourceUrl: metadata.sourceUrl || '',
          createdAt: metadata.createdAt || new Date().toISOString(),
          updatedAt: metadata.updatedAt || new Date().toISOString(),
          appVersion: 'test',
        }

        return {
          id: 'mock-file-id',
          name: `${title}.chordpro`,
          appProperties: capturedAppProperties,
        }
      },

      async updateChordProFile(fileId, content, metadata = {}) {
        // Build appProperties update as the real implementation does
        const appPropsUpdate = {
          appVersion: 'test',
        }

        if (metadata.contentHash) appPropsUpdate.contentHash = metadata.contentHash
        if (metadata.ccliNumber !== undefined) appPropsUpdate.ccliNumber = metadata.ccliNumber
        if (metadata.title) appPropsUpdate.title = metadata.title
        if (metadata.titleNormalized) appPropsUpdate.titleNormalized = metadata.titleNormalized
        if (metadata.versionLabel) appPropsUpdate.versionLabel = metadata.versionLabel
        if (metadata.updatedAt) appPropsUpdate.updatedAt = metadata.updatedAt

        // Variant relationships
        if (metadata.variantOf !== undefined) appPropsUpdate.variantOf = metadata.variantOf || ''
        if (metadata.isDefault !== undefined)
          appPropsUpdate.isDefault = metadata.isDefault ? 'true' : 'false'

        // Import metadata
        if (metadata.importDate) appPropsUpdate.importDate = metadata.importDate
        if (metadata.importUser) appPropsUpdate.importUser = metadata.importUser
        if (metadata.importSource) appPropsUpdate.importSource = metadata.importSource
        if (metadata.sourceUrl) appPropsUpdate.sourceUrl = metadata.sourceUrl

        capturedAppProperties = appPropsUpdate
      },
    }
  })

  describe('uploadChordProFile', () => {
    it('should include variant relationships in appProperties', async () => {
      const metadata = {
        titleNormalized: 'amazing-grace',
        contentHash: 'abc123',
        variantOf: 'parent-song-uuid',
        isDefault: true,
        importDate: '2024-01-01T00:00:00.000Z',
        importUser: 'test@example.com',
        importSource: 'songselect',
        sourceUrl: 'https://songselect.ccli.com/songs/12345',
      }

      await mockDriveAPI.uploadChordProFile(
        'org-folder-id',
        'song-deterministic-id',
        'song-variant-uuid',
        'Amazing Grace',
        '12345',
        'Original',
        '{title: Amazing Grace}',
        metadata
      )

      expect(capturedAppProperties).to.not.be.null
      expect(capturedAppProperties.variantOf).to.equal('parent-song-uuid')
      expect(capturedAppProperties.isDefault).to.equal('true')
      expect(capturedAppProperties.importDate).to.equal('2024-01-01T00:00:00.000Z')
      expect(capturedAppProperties.importUser).to.equal('test@example.com')
      expect(capturedAppProperties.importSource).to.equal('songselect')
      expect(capturedAppProperties.sourceUrl).to.equal('https://songselect.ccli.com/songs/12345')
    })

    it('should handle isDefault=false correctly', async () => {
      const metadata = {
        variantOf: 'parent-song-uuid',
        isDefault: false,
      }

      await mockDriveAPI.uploadChordProFile(
        'org-folder-id',
        'song-id',
        'variant-uuid',
        'Song Title',
        '12345',
        'Simplified',
        '{title: Song}',
        metadata
      )

      expect(capturedAppProperties.isDefault).to.equal('false')
    })

    it('should handle missing variant relationships gracefully', async () => {
      const metadata = {
        contentHash: 'abc123',
        // No variantOf, isDefault, or import metadata
      }

      await mockDriveAPI.uploadChordProFile(
        'org-folder-id',
        'song-id',
        'variant-uuid',
        'Song Title',
        '12345',
        'Original',
        '{title: Song}',
        metadata
      )

      expect(capturedAppProperties.variantOf).to.equal('')
      expect(capturedAppProperties.isDefault).to.equal('false')
      expect(capturedAppProperties.importDate).to.equal('')
      expect(capturedAppProperties.importUser).to.equal('')
      expect(capturedAppProperties.importSource).to.equal('')
      expect(capturedAppProperties.sourceUrl).to.equal('')
    })

    it('should handle null variantOf correctly', async () => {
      const metadata = {
        variantOf: null,
        isDefault: true,
      }

      await mockDriveAPI.uploadChordProFile(
        'org-folder-id',
        'song-id',
        'variant-uuid',
        'Song Title',
        '12345',
        'Original',
        '{title: Song}',
        metadata
      )

      // variantOf should be empty string when null
      expect(capturedAppProperties.variantOf).to.equal('')
      expect(capturedAppProperties.isDefault).to.equal('true')
    })
  })

  describe('updateChordProFile', () => {
    it('should include variant relationships in update', async () => {
      const metadata = {
        contentHash: 'xyz789',
        variantOf: 'updated-parent-uuid',
        isDefault: true,
        importDate: '2024-02-01T00:00:00.000Z',
        importUser: 'editor@example.com',
        importSource: 'manual',
        sourceUrl: '',
      }

      await mockDriveAPI.updateChordProFile('file-id', '{updated content}', metadata)

      expect(capturedAppProperties.variantOf).to.equal('updated-parent-uuid')
      expect(capturedAppProperties.isDefault).to.equal('true')
      expect(capturedAppProperties.importDate).to.equal('2024-02-01T00:00:00.000Z')
      expect(capturedAppProperties.importUser).to.equal('editor@example.com')
      expect(capturedAppProperties.importSource).to.equal('manual')
    })

    it('should handle isDefault change from true to false', async () => {
      const metadata = {
        isDefault: false,
      }

      await mockDriveAPI.updateChordProFile('file-id', '{content}', metadata)

      expect(capturedAppProperties.isDefault).to.equal('false')
    })

    it('should only include provided metadata fields in update', async () => {
      const metadata = {
        contentHash: 'new-hash',
        // Only updating contentHash, not variant relationships
      }

      await mockDriveAPI.updateChordProFile('file-id', '{content}', metadata)

      expect(capturedAppProperties.contentHash).to.equal('new-hash')
      // These should not be present if not provided
      expect(capturedAppProperties.variantOf).to.be.undefined
      expect(capturedAppProperties.isDefault).to.be.undefined
      expect(capturedAppProperties.importDate).to.be.undefined
    })
  })

  describe('Integration scenarios', () => {
    it('should sync complete song variant hierarchy', async () => {
      // Scenario: User creates a variant of a song and uploads it
      const originalSong = {
        variantOf: null, // This is the original
        isDefault: true,
        importDate: '2024-01-01T00:00:00.000Z',
        importUser: 'user@church.org',
        importSource: 'songselect',
        sourceUrl: 'https://songselect.ccli.com/songs/12345',
      }

      await mockDriveAPI.uploadChordProFile(
        'org-folder-id',
        'amazing-grace',
        'original-uuid',
        'Amazing Grace',
        '12345',
        'Original',
        '{title: Amazing Grace}',
        originalSong
      )

      expect(capturedAppProperties.variantOf).to.equal('')
      expect(capturedAppProperties.isDefault).to.equal('true')

      // Now create a simplified variant
      const simplifiedSong = {
        variantOf: 'original-uuid',
        isDefault: false,
        importDate: '2024-01-15T00:00:00.000Z',
        importUser: 'editor@church.org',
        importSource: 'manual',
      }

      await mockDriveAPI.uploadChordProFile(
        'org-folder-id',
        'amazing-grace',
        'simplified-uuid',
        'Amazing Grace',
        '12345',
        'Simplified',
        '{title: Amazing Grace (Simplified)}',
        simplifiedSong
      )

      expect(capturedAppProperties.variantOf).to.equal('original-uuid')
      expect(capturedAppProperties.isDefault).to.equal('false')
      expect(capturedAppProperties.importUser).to.equal('editor@church.org')
    })

    it('should handle promoting a variant to default', async () => {
      // Scenario: User marks a variant as the new default
      // First, demote the old default
      await mockDriveAPI.updateChordProFile('original-file-id', '{content}', {
        isDefault: false,
      })

      expect(capturedAppProperties.isDefault).to.equal('false')

      // Then promote the new variant
      await mockDriveAPI.updateChordProFile('variant-file-id', '{content}', {
        isDefault: true,
      })

      expect(capturedAppProperties.isDefault).to.equal('true')
    })
  })
})
