import { expect } from '@open-wc/testing'
import { processTerm, SongIndex } from '../src/js/utils/song-search.ts'

const { describe, it } = window

describe('processTerm', () => {
  it('makes the forms of a word one word', () => {
    const stems = ['praise', 'Praises', 'praised', 'praising'].map(processTerm)
    expect(new Set(stems).size).to.equal(1)
  })

  it('ignores case, accents and apostrophes', () => {
    expect(processTerm('Lord’s')).to.equal(processTerm('lords'))
    expect(processTerm("Lord's")).to.equal(processTerm('lords'))
    expect(processTerm('Café')).to.equal(processTerm('cafe'))
  })

  it('leaves out the words every song has, and nothing', () => {
    expect(processTerm('you')).to.equal(null)
    expect(processTerm('The')).to.equal(null)
    expect(processTerm('')).to.equal(null)
    expect(processTerm("'")).to.equal(null)
  })
})

describe('SongIndex', () => {
  const song = (title: string, lyrics = '', artist = '', label = '') => ({
    title,
    artist,
    label,
    lyrics,
  })
  const index = new SongIndex([
    song('Amazing Grace', 'Amazing grace how sweet the sound\nthat saved a wretch like me'),
    song(
      'Great Is Thy Faithfulness',
      'Great is thy faithfulness, morning by morning new mercies I see'
    ),
    song('Ten Thousand Reasons', 'Bless the Lord O my soul\nWorship his holy name', 'Matt Redman'),
    song('Blessed Be Your Name', 'Blessed be your name', '', 'Acoustic'),
  ])
  const found = (term: string) => [...index.search(term).keys()].sort()

  it('names songs by their place in the list it was made from', () => {
    expect(found('grace')).to.deep.equal([0])
    expect(found('faithfulness')).to.deep.equal([1])
  })

  it('finds another form of a word', () => {
    expect(found('worshipping')).to.deep.equal([2])
    expect(found('blessing')).to.deep.equal([2, 3])
    expect(found('reason')).to.deep.equal([2])
  })

  it('finds a word with a letter wrong, from four letters', () => {
    expect(found('wretck')).to.deep.equal([0])
    expect(found('sweat')).to.deep.equal([0])
  })

  it('does not guess at a short word', () => {
    expect(found('sea')).to.deep.equal([])
  })

  it('finds words in any order, and needs them all', () => {
    expect(found('lord bless')).to.deep.equal([2])
    expect(found('lord grace')).to.deep.equal([])
  })

  it('finds a word begun, as while typing, at the last word', () => {
    expect(found('amaz')).to.deep.equal([0])
    expect(found('bless the lo')).to.deep.equal([2])
    expect(found('am grace')).to.deep.equal([])
  })

  it('finds the artist and the name of the variant', () => {
    expect(found('redman')).to.deep.equal([2])
    expect(found('acoustic')).to.deep.equal([3])
  })

  it('scores a word in the title above the same word in the lyrics', () => {
    const scored = new SongIndex([
      song('Other', 'name name name name'),
      song('Name', 'Other'),
    ]).search('name')
    expect(scored.get(1)).to.be.greaterThan(scored.get(0) as number)
  })

  it('finds nothing for a search of only common words', () => {
    expect(found('the you')).to.deep.equal([])
  })
})
