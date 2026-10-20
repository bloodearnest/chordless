import { expect } from '@open-wc/testing'
import {
  chordproFilename,
  forUpdate,
  setlistFileMetadata,
  setlistFilename,
  shareFileMetadata,
  songFileDetails,
  songFileMetadata,
} from '../src/js/drive-metadata.ts'
import { makeSetlist } from './builders.ts'

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
    expect(
      setlistFilename(
        makeSetlist({ id: 'x', date: '2026-09-27', type: 'Church Service', owner: '', name: '' })
      )
    ).to.equal('2026-09-27-church-service.json')
  })

  it('names chord chart files as before', () => {
    expect(chordproFilename('Amazing Grace (My Chains)', '4779')).to.equal(
      'amazing-grace-my-chains-4779.txt'
    )
    expect(chordproFilename('Be Still -- My Soul', '')).to.equal('be-still-my-soul.txt')
  })

  it('keeps setlist appProperties to identity only', () => {
    const meta = setlistFileMetadata(setlist, { spaceId: 'org-1' })
    expect(meta.mimeType).to.equal('application/json')
    expect(meta.appProperties).to.deep.equal({
      spaceId: 'org-1',
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
        spaceId: 'org-1',
      }
    )
    expect(meta.name).to.equal('amazing-grace-4779.txt')
    expect(meta.appProperties).to.deep.equal({
      type: 'chordpro',
      spaceId: 'org-1',
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
    const update = forUpdate(setlistFileMetadata(setlist, { spaceId: 'org-1' }), 'setlist')
    expect(update).not.to.have.property('mimeType')
    expect(update.appProperties.leader).to.equal(null)
    expect(update.appProperties.date).to.equal(null)
    expect(update.appProperties.setlistId).to.equal('setlist-1')
  })
})

describe('Drive file metadata, with less recorded', () => {
  it('names a setlist file by its id when it has no date', () => {
    expect(setlistFilename({ id: 'setlist-9', date: '', owner: '', type: '', name: '' })).to.equal(
      'setlist-9.json'
    )
  })

  it('has no space in a file’s details when there is none', () => {
    const metadata = setlistFileMetadata(
      { id: 'x', date: '2026-06-22', owner: '', type: '', name: '' },
      { spaceId: null }
    )
    expect(metadata.appProperties.spaceId).to.equal('')
  })

  it('has no space in a share file’s details when there is none', () => {
    const metadata = shareFileMetadata({ id: 'x' }, { spaceId: null, expires: '2026-10-25' })
    expect(metadata.appProperties).to.include({ spaceId: '', expires: '2026-10-25' })
  })

  it('titles a song’s file by its record, else its chart, else “Untitled”', () => {
    expect(
      songFileDetails({ title: 'Record title' }, { content: '{title: Chart}' }).title
    ).to.equal('Record title')
    expect(songFileDetails({}, { content: '{title: Chart title}' }).title).to.equal('Chart title')
    expect(songFileDetails({}, { content: 'no title here' }).title).to.equal('Untitled')
    expect(songFileDetails({}, null).title).to.equal('Untitled')
  })

  it('labels a song’s file Original, or Variant for one that is a variant of another', () => {
    expect(songFileDetails({ variantLabel: 'Acoustic' }).variantLabel).to.equal('Acoustic')
    expect(songFileDetails({ isDefault: true }).variantLabel).to.equal('Original')
    expect(songFileDetails({ variantOf: 'title-x' }).variantLabel).to.equal('Variant')
    expect(songFileDetails({}).variantLabel).to.equal('Original')
  })

  it('records only what a song has, and the id for its uuid if it has none', () => {
    const metadata = songFileMetadata({ id: 'title-x', title: 'X' }, null, { spaceId: null })
    expect(metadata.appProperties).to.include({
      spaceId: '',
      songUuid: 'title-x',
      variantOf: '',
      isDefault: 'false',
      importDate: '',
      importUser: '',
      importSource: '',
    })
  })
})
