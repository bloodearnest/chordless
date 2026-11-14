import { expect, fixture, html } from '@open-wc/testing'
import '../src/components/song-display.ts'
import { ContextProvider } from '@lit/context'
import type { SongDisplay } from '../src/components/song-display.ts'
import type { SongSection } from '../src/components/song-section.ts'
import { ChordProParser } from '../src/js/parser.ts'
import { attachCues } from '../src/js/score-shown.ts'

const { describe, it } = window

const parse = (text: string) => new ChordProParser().parse(text)
const CHART = '{title: A}\n{key: G}\n\n{comment: Verse}\n[G]One\n\n[C]Unlabelled'

describe('song-display', () => {
  const sections = (display: SongDisplay) =>
    Array.from(display.shadowRoot?.querySelectorAll<SongSection>('song-section') ?? [])

  async function show(set: Partial<SongDisplay> = {}) {
    const display = await fixture<SongDisplay>(html`<song-display></song-display>`)
    Object.assign(display, set)
    await display.updateComplete
    return display
  }

  it('shows nothing until it has a song', async () => {
    const display = await show()
    expect(sections(display)).to.have.length(0)
  })

  it('shows a section for each of the song’s, labelled as they are, and none for no label', async () => {
    const display = await show({ parsed: parse(CHART), songIndex: 2 })
    expect(sections(display).map(section => section.label)).to.deep.equal(['Verse'])
    expect(sections(display)[0].getAttribute('section-index')).to.equal('0')
    expect(sections(display)[0].songIndex).to.equal(2)

    display.parsed = parse('{title: A}\n\n[G]No label')
    await display.updateComplete
    expect(sections(display).map(section => section.label)).to.deep.equal([''])
  })

  it('tells each section the capo, and the key to play in', async () => {
    const display = await show({ parsed: parse(CHART), capo: 2 })
    expect(sections(display)[0].capo).to.equal(2)
    expect(sections(display)[0].capoKey).to.equal('F')
  })

  it('keeps a capo to 0 to 11, and none when it is not a number', async () => {
    const display = await show({ parsed: parse(CHART), capo: 40 })
    expect(sections(display)[0].capo).to.equal(11)
    display.capo = Number.NaN
    await display.updateComplete
    expect(sections(display)[0].capo).to.equal(0)
    expect(sections(display)[0].capoKey).to.equal('')
  })

  it('moves the chords up by the tuning and down by the capo, as one capo would', async () => {
    const { displayPreferencesContext } = await import('../src/js/display-preferences.ts')
    const host = document.createElement('div')
    const provider = new ContextProvider(host, {
      context: displayPreferencesContext,
      initialValue: { nashville: false, unicodeAccidentals: false, tuning: 1 },
    })
    document.body.append(host)
    const display = document.createElement('song-display')
    display.parsed = parse(CHART)
    host.append(display)
    await display.updateComplete
    // (a guitar tuned a half step down plays a G chart in Ab: the same as a capo at 11)
    expect(sections(display)[0].capo).to.equal(11)
    expect(sections(display)[0].capoKey).to.equal('Ab')

    // (a capo 3 on top: down 2 from the key)
    display.capo = 3
    await display.updateComplete
    expect(sections(display)[0].capo).to.equal(2)
    expect(sections(display)[0].capoKey).to.equal('F')

    // (the setlist's own tuning wins over the device's, and standard needs no shift)
    display.capo = 0
    display.tuning = 0
    await display.updateComplete
    expect(sections(display)[0].capo).to.equal(0)
    expect(sections(display)[0].capoKey).to.equal('')
    display.tuning = 2
    await display.updateComplete
    expect(sections(display)[0].capo).to.equal(10)
    expect(sections(display)[0].capoKey).to.equal('A')

    // (and with none of its own it follows the device's again)
    display.tuning = null
    provider.setValue({ nashville: false, unicodeAccidentals: false, tuning: 0 })
    await display.updateComplete
    expect(sections(display)[0].capo).to.equal(0)
    host.remove()
  })

  it('gives no capo key for a song with no key', async () => {
    const display = await show({ parsed: parse('{title: A}\n\n[G]One'), capo: 2 })
    expect(sections(display)[0].capoKey).to.equal('')
  })

  it('passes down how chords are to be shown, by the page’s preferences', async () => {
    // (A provider of its own, so the user's preferences, which other tests use, are left alone)
    const { displayPreferencesContext } = await import('../src/js/display-preferences.ts')
    const host = document.createElement('div')
    const provider = new ContextProvider(host, {
      context: displayPreferencesContext,
      initialValue: { nashville: true, unicodeAccidentals: false, tuning: 0 },
    })
    document.body.append(host)
    const display = document.createElement('song-display')
    display.parsed = parse(CHART)
    host.append(display)
    await display.updateComplete
    expect(sections(display)[0].displayAsNashville).to.equal(true)
    expect(sections(display)[0].unicodeAccidentals).to.equal(false)

    provider.setValue({ nashville: false, unicodeAccidentals: true, tuning: 0 })
    await display.updateComplete
    expect(sections(display)[0].displayAsNashville).to.equal(false)
    expect(sections(display)[0].unicodeAccidentals).to.equal(true)
    host.remove()
  })

  it('gives each section the notes of the lead sheet that are its own, where it has any', async () => {
    const melody = { title: null, notice: [], measures: [] }
    const display = await show({
      parsed: parse('{title: A}\n{key: G}\n\n{comment: Intro}\n[G]\n\n{comment: Verse}\n[G]One'),
      cues: { melody, key: 'C', measures: [[0, 1], null] },
    })
    const [intro, verse] = sections(display) as unknown as {
      melody: unknown
      melodyKey: string
      melodyMeasures: number[] | null
    }[]
    expect(intro.melody).to.equal(melody)
    expect(intro.melodyKey).to.equal('C')
    expect(intro.melodyMeasures).to.deep.equal([0, 1])
    expect(verse.melody).to.equal(null)
    expect(verse.melodyMeasures).to.equal(null)
    display.cues = null
    await display.updateComplete
    expect((sections(display)[0] as unknown as { melody: unknown }).melody).to.equal(null)
  })

  it('has no cues to attach to content with no song in it', () => {
    expect(attachCues(document.createElement('div'), null)).to.equal(false)
  })
})
