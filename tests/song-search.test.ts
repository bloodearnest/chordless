import { expect } from '@open-wc/testing'
import { plainWord, SongIndex, stemOf, wordRanges } from '../src/js/utils/song-search.ts'

const { describe, it } = window

describe('plainWord and stemOf', () => {
  it('makes the forms of a word one stem', () => {
    const stems = ['praise', 'Praises', 'praised', 'praising'].map(word =>
      stemOf(plainWord(word) as string)
    )
    expect(new Set(stems).size).to.equal(1)
  })

  it('ignores case, accents and apostrophes', () => {
    expect(plainWord('Lord’s')).to.equal('lords')
    expect(plainWord("Lord's")).to.equal('lords')
    expect(plainWord('Café')).to.equal('cafe')
  })

  it('leaves out the words every song has, and nothing', () => {
    expect(plainWord('you')).to.equal(null)
    expect(plainWord('The')).to.equal(null)
    expect(plainWord('')).to.equal(null)
    expect(plainWord("'")).to.equal(null)
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
    song(
      'Ten Thousand Reasons',
      "Bless the Lord O my soul\nWorship his holy name\nLord's love",
      'Matt Redman'
    ),
    song('Blessed Be Your Name', 'Blessed be your name', '', 'Acoustic'),
    song('Raise A Hallelujah', 'I raise a hallelujah'),
    song('Praise', 'We are praising and he praised us'),
    song('Worthy Is The Lamb', 'Worthy is the Lamb'),
  ])
  const found = (term: string) => [...index.search(term).keys()].sort()

  it('names songs by their place in the list it was made from', () => {
    expect(found('grace')).to.deep.equal([0])
    expect(found('faithfulness')).to.deep.equal([1])
  })

  it('finds another form of a word, longer or shorter than the song has it', () => {
    expect(found('worshipping')).to.deep.equal([2])
    expect(found('blessing')).to.deep.equal([2, 3])
    expect(found('reason')).to.deep.equal([2])
    expect(found('praises')).to.deep.equal([5])
    expect(found('praise')).to.deep.equal([5])
  })

  it('does not let a short word have a letter wrong ("praises" is not "raise")', () => {
    expect(found('praises')).to.not.include(4)
    expect(found('raises')).to.deep.equal([4])
  })

  it('finds a word with a letter wrong, from six letters, or from seven for the last word', () => {
    expect(found('wretck like')).to.deep.equal([0])
    expect(found('wretchd')).to.deep.equal([0])
    expect(found('hallelujha')).to.deep.equal([4])
  })

  it('does not take a word being typed for a slip of the fingers ("worshi" is not "worthy")', () => {
    expect(found('wretck')).to.deep.equal([])
    expect(found('worshi')).to.deep.equal([2])
    expect(found('worshi')).to.not.include(6)
    expect(found('worthi')).to.deep.equal([6])
  })

  it('finds a word begun, whatever form it will be: the last word', () => {
    expect(found('worshippin')).to.deep.equal([2])
    expect(found('amaz')).to.deep.equal([0])
    expect(found('bless the lo')).to.deep.equal([2])
    expect(found('am grace')).to.deep.equal([])
  })

  it('finds words in any order, and needs them all', () => {
    expect(found('lord bless')).to.deep.equal([2])
    expect(found('lord grace')).to.deep.equal([])
  })

  it('finds a word with an apostrophe as the word without', () => {
    expect(found("lord's")).to.deep.equal([2])
    expect(found('lords')).to.deep.equal([2])
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
    expect(found('')).to.deep.equal([])
  })
})

describe('wordRanges', () => {
  const marked = (text: string, term: string) =>
    wordRanges(text, term).map(({ start, end }) => text.slice(start, end))

  it('finds the other forms of the words searched for', () => {
    expect(marked('We are praising, and Praised be', 'praises')).to.deep.equal([
      'praising',
      'Praised',
    ])
  })

  it('finds a word with a letter wrong, from six letters', () => {
    expect(marked('saved a wretch like me', 'wretck like')).to.deep.equal(['wretch', 'like'])
    expect(marked('saved a wretch like me', 'wretchd')).to.deep.equal(['wretch'])
    expect(marked('Worthy is the Lamb, worship', 'worshi')).to.deep.equal(['worship'])
    expect(marked('I raise it', 'praises')).to.deep.equal([])
  })

  it('finds a word that begins as the last word typed', () => {
    expect(marked('Worshipping at your feet, worship', 'worshippin')).to.deep.equal([
      'Worshipping',
      'worship',
    ])
    expect(marked('Worshipping at your feet', 'feet wor')).to.deep.equal(['Worshipping', 'feet'])
  })

  it('ignores the words too common to search for', () => {
    expect(marked('you are the one', 'you the')).to.deep.equal([])
  })

  it('gives the place in the text', () => {
    expect(wordRanges('Lord’s praise', 'praises')).to.deep.equal([{ start: 7, end: 13 }])
  })
})
