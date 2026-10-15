import { expect, fixture, html } from '@open-wc/testing'
import '../src/components/chord-display.ts'
import type { ChordDisplay } from '../src/components/chord-display.ts'

const { describe, it } = window

describe('chord-display', () => {
  async function show(set: Partial<ChordDisplay>) {
    const chord = await fixture<ChordDisplay>(html`<chord-display></chord-display>`)
    Object.assign(chord, set)
    await chord.updateComplete
    return chord
  }
  const text = (chord: ChordDisplay) => chord.textContent?.trim()
  const extensions = (chord: ChordDisplay) =>
    Array.from(chord.querySelectorAll('sup.chord-extension'), sup => sup.textContent)

  it('shows nothing for no chord', async () => {
    expect(text(await show({ chord: '' }))).to.equal('')
  })

  it('shows a bar marker as it is', async () => {
    expect(text(await show({ chord: '|' }))).to.equal('|')
  })

  it('shows a chord, with its extension raised', async () => {
    const chord = await show({ chord: 'Gsus4' })
    expect(text(chord)).to.equal('Gsus4')
    expect(extensions(chord)).to.deep.equal(['sus4'])
    expect(extensions(await show({ chord: 'G' }))).to.deep.equal([])
  })

  it('shows what is not a chord as it is', async () => {
    expect(text(await show({ chord: 'N.C.' }))).to.equal('N.C.')
    expect(text(await show({ chord: ' ' }))).to.equal('')
  })

  it('shows sharps and flats as the signs, if asked to', async () => {
    expect(text(await show({ chord: 'F#m7' }))).to.equal('F#m7')
    expect(text(await show({ chord: 'F#m7', unicodeAccidentals: true }))).to.equal('F♯m7')
  })

  describe('with a capo', () => {
    it('shows the chords to play: the chord down by the capo', async () => {
      expect(text(await show({ chord: 'G', capo: 2, capoKey: 'F' }))).to.equal('F')
      expect(text(await show({ chord: 'G', capo: 2 }))).to.equal('F')
    })

    it('shows the chord as it is with no capo, or one that is not a number', async () => {
      expect(text(await show({ chord: 'G', capo: 0 }))).to.equal('G')
      expect(text(await show({ chord: 'G', capo: Number.NaN }))).to.equal('G')
    })

    it('goes no further down than 11', async () => {
      expect(text(await show({ chord: 'G', capo: 40 }))).to.equal(
        text(await show({ chord: 'G', capo: 11 }))
      )
    })
  })

  describe('as Nashville numbers', () => {
    const numbers = (chord: string) => show({ chord, displayAsNashville: true, displayKey: 'G' })

    it('shows the chord as its number in the key, with the extension raised', async () => {
      expect(text(await numbers('C'))).to.equal('4')
      const minor = await numbers('Am7')
      expect(text(minor)).to.equal('2m7')
      expect(extensions(minor)).to.deep.equal(['7'])
    })

    it('keeps the brackets round a chord, and the bass after a slash', async () => {
      expect(text(await numbers('(D)'))).to.equal('(5)')
      const slash = await numbers('Dsus4/F#')
      expect(text(slash)).to.equal('5sus4/7')
      expect(extensions(slash)).to.deep.equal(['sus4'])
    })

    it('shows a flat or sharp number with its sign', async () => {
      expect(text(await numbers('Bb'))).to.equal('b3')
    })

    it('shows what is not a chord as it is', async () => {
      expect(text(await numbers('N.C.'))).to.equal('N.C.')
    })

    it('shows the chord, not a number, when it does not know the key', async () => {
      expect(text(await show({ chord: 'C', displayAsNashville: true }))).to.equal('C')
    })

    it('reads a part that is not a number as it is, and brackets that are not a pair as text', async () => {
      const chord = await show({})
      expect(chord._buildNashvilleCore('x')).to.deep.equal([{ type: 'base', value: 'x' }])
      expect(chord._buildNashvilleSegments('(5').map(segment => segment.value)).to.deep.equal([
        '(5',
      ])
    })
  })
})
