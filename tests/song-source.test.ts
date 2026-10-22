import { expect } from '@open-wc/testing'
import { songSource } from '../src/js/song-source.ts'

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
})
