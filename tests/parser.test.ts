import { expect } from '@open-wc/testing'
import { ChordProParser } from '../src/js/parser.ts'

const { describe, it } = window

const parse = (text: string) => new ChordProParser().parse(text)

describe('ChordProParser sections', () => {
  it('starts a section at each {comment: ...} line, labelled with it', () => {
    const { sections } = parse('{comment: Verse 1}\n[G]One\n\n{comment: Chorus}\n[C]Two')
    expect(sections.map(section => section.label)).to.deep.equal(['Verse 1', 'Chorus'])
    expect(sections.map(section => section.note)).to.deep.equal([undefined, undefined])
  })

  it('keeps text after the label on the same line as a note, not as a lyric', () => {
    // As SongSelect writes it
    const { sections } = parse(
      '{comment: Chorus} (first time a cappella)\nI’ve been [G]washed in the water\n\n{comment: Verse 1}\nI’m [G/B]clean'
    )
    expect(sections).to.have.length(2)
    expect(sections[0].label).to.equal('Chorus')
    expect(sections[0].note).to.equal('(first time a cappella)')
    expect(sections[0].lines).to.have.length(1)
    expect(sections[0].lines[0].segments.map(segment => segment.lyrics).join('')).to.equal(
      'I’ve been washed in the water'
    )
    expect(sections[1].label).to.equal('Verse 1')
  })

  it('treats the first chorus of a song that starts with such a line like any other', () => {
    const { sections } = parse(
      '{title: Washed}\n{key: G}\n\n{comment: Chorus} (first time a cappella)\n[G]Washed'
    )
    expect(sections).to.have.length(1)
    expect(sections[0].label).to.equal('Chorus')
  })
})

describe('ChordProParser, a label with a note after a section', () => {
  it('ends the section before it, and keeps that one', () => {
    const { sections } = parse(
      '{comment: Verse 1}\n[G]One\n\n{comment: Chorus} (first time a cappella)\n[C]Two'
    )
    expect(sections.map(section => [section.label, section.note])).to.deep.equal([
      ['Verse 1', undefined],
      ['Chorus', '(first time a cappella)'],
    ])
  })
})
