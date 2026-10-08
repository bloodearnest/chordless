import { expect } from '@esm-bundle/chai'
import {
  chordproFilename,
  forUpdate,
  setlistFileMetadata,
  setlistFilename,
  songFileMetadata,
} from '../public/js/drive-metadata.js'

const { describe, it } = window

describe('Drive file metadata', () => {
  const setlist = {
    id: 'setlist-1',
    date: '2026-06-22',
    owner: 'Simon Davy',
    type: 'Event',
    name: 'Devoted Leaders - Tue Am',
  }

  it('names setlist files as before (existing files keep their names)', () => {
    expect(setlistFilename(setlist)).to.equal(
      '2026-06-22-simon-davy-event-devoted-leaders---tue-am.json'
    )
    expect(setlistFilename({ id: 'x', date: '2026-09-27', type: 'Church Service' })).to.equal(
      '2026-09-27-church-service.json'
    )
  })

  it('names chord chart files as before', () => {
    expect(chordproFilename('Amazing Grace (My Chains)', '4779')).to.equal(
      'amazing-grace-my-chains-4779.txt'
    )
    expect(chordproFilename('Be Still -- My Soul', '')).to.equal('be-still-my-soul.txt')
  })

  it('keeps setlist appProperties to identity only', () => {
    const meta = setlistFileMetadata(setlist, { organisationId: 'org-1' })
    expect(meta.mimeType).to.equal('application/json')
    expect(meta.appProperties).to.deep.equal({
      organisationId: 'org-1',
      setlistId: 'setlist-1',
      appVersion: '1.0.0',
    })
  })

  it('gives songs identity, variant and import appProperties, all strings', () => {
    const song = {
      id: 'ccli-4779',
      uuid: 'uuid-1',
      title: 'Amazing Grace',
      ccliNumber: '4779',
      isDefault: false,
      variantOf: 'uuid-0',
      importDate: '2026-06-21T19:00:00Z',
      importSource: 'songselect',
    }
    const meta = songFileMetadata(
      song,
      { content: '{title: Amazing Grace}' },
      {
        organisationId: 'org-1',
      }
    )
    expect(meta.name).to.equal('amazing-grace-4779.txt')
    expect(meta.appProperties).to.deep.equal({
      type: 'chordpro',
      organisationId: 'org-1',
      songId: 'ccli-4779',
      songUuid: 'uuid-1',
      variantOf: 'uuid-0',
      isDefault: 'false',
      variantLabel: 'Variant',
      importDate: '2026-06-21T19:00:00Z',
      importUser: '',
      importSource: 'songselect',
      appVersion: '1.0.0',
    })
    for (const value of Object.values(meta.appProperties)) expect(value).to.be.a('string')
  })

  it('removes retired appProperties on update', () => {
    const update = forUpdate(setlistFileMetadata(setlist, { organisationId: 'org-1' }), 'setlist')
    expect(update).not.to.have.property('mimeType')
    expect(update.appProperties.leader).to.equal(null)
    expect(update.appProperties.date).to.equal(null)
    expect(update.appProperties.setlistId).to.equal('setlist-1')
  })
})
