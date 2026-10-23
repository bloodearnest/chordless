import { expect } from '@open-wc/testing'
import { describeOrigin, songSource } from '../src/js/song-source.ts'

const { describe, it } = window

describe('a song’s source', () => {
  it('is where it came from, as recorded', () => {
    for (const source of [
      'songselect',
      'file',
      'paste',
      'manual',
      'share',
      'sample',
      'Hillsong CCLI 123',
    ]) {
      expect(songSource(source)).to.equal(source)
    }
  })

  it('is empty where only how it arrived was recorded: Google Drive, a copy, an import', () => {
    for (const arrived of ['drive', 'copy', 'import']) expect(songSource(arrived)).to.equal('')
  })

  it('is empty where nothing was recorded', () => {
    expect(songSource('')).to.equal('')
    expect(songSource(null)).to.equal('')
    expect(songSource(undefined)).to.equal('')
  })

  it('is described by who imported it, when, and where it came from', () => {
    const date = new Date('2026-10-23T11:00:00Z').toLocaleDateString()
    expect(
      describeOrigin({
        importUser: 'Jo',
        importDate: '2026-10-23T11:00:00Z',
        importSource: 'songselect',
      })
    ).to.equal(`Imported by Jo, ${date}, SongSelect`)
    expect(describeOrigin({ importSource: 'Hillsong' })).to.equal('Importer unknown, Hillsong')
    expect(describeOrigin({ importUser: 'Jo', importSource: 'paste' })).to.equal('Imported by Jo')
    expect(describeOrigin({})).to.equal('Importer unknown')
  })
})
