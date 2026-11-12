import { expect, fixture, html } from '@open-wc/testing'
import { type SongInfo, SongRangeChangeEvent } from '../src/components/song-info.ts'
import '../src/components/song-info.ts'

import { songMelody } from '../src/js/melody-analysis.ts'
import { sampleRecord } from './score-sample.ts'
import { A11Y } from './test-helpers.ts'

const { describe, it } = window

type Song = NonNullable<SongInfo['song']>

const song = (over: Record<string, unknown> = {}) =>
  ({ title: 'Amazing Grace', metadata: {}, ...over }) as unknown as Song

describe('song-info', () => {
  async function show(set: Partial<Pick<SongInfo, 'song' | 'appearances' | 'loading' | 'melody'>>) {
    const info = await fixture<SongInfo>(html`<song-info></song-info>`)
    Object.assign(info, set)
    await info.updateComplete
    return info
  }
  const text = (info: SongInfo) => info.shadowRoot?.textContent?.replace(/\s+/g, ' ') ?? ''

  it('says it is loading, or has no song', async () => {
    expect(text(await show({ loading: true }))).to.contain('Loading song information')
    expect(text(await show({ song: null }))).to.contain('No song data available')
  })

  it('shows what the song says about itself', async () => {
    const info = await show({
      song: song({
        artist: 'John Newton',
        metadata: { key: 'G', tempo: 90, timeSignature: '3/4', copyright: '© Public domain' },
      }),
    })
    const shown = text(info)
    expect(shown).to.contain('John Newton')
    expect(shown).to.contain('Key: G • 90 BPM')
    expect(shown).to.contain('3/4')
    expect(shown).to.contain('Copyright')
    expect(shown).to.not.contain('Times Played')
    expect(shown).to.not.contain('Recent Plays')
  })

  describe('the melody range', () => {
    /** A song with a chart that says its range (and the key it is in, if it says) */
    const ranged = (over: Record<string, unknown> = {}, chart: Record<string, string> = {}) =>
      song({
        key: 'G',
        metadata: { key: 'G' },
        parsed: { metadata: { key: 'G', x_chordless_range: 'D4-E5', ...chart } },
        ...over,
      })
    const badges = (info: SongInfo) => info.shadowRoot?.querySelectorAll('.range-badge') ?? []

    it('says how long the song sits on its highest and lowest notes, when it has a melody', async () => {
      const melody = songMelody({ key: 'G' } as never, sampleRecord('song-1', 'G'))
      const shown = text(await show({ song: ranged({}, { x_chordless_range: '' }), melody }))
      expect(shown).to.contain('Highest G4: 3 beats; lowest C4: 1 beat')
      expect(text(await show({ song: ranged(), melody: null }))).to.not.contain('Highest')
      // (a melody that does not say its key is named in the song's)
      const unkeyed = songMelody({} as never, sampleRecord('song-1', null))
      expect(text(await show({ song: ranged(), melody: unkeyed }))).to.contain(
        'Highest G4: 3 beats'
      )
      // (with no key to name the notes in, nothing is said)
      const keyless = ranged({ key: '', metadata: {} }, { key: '', x_chordless_range: 'D4-E5' })
      expect(text(await show({ song: keyless, melody }))).to.not.contain('Highest')
    })

    it('shows the lowest and highest note, how wide it is, and how it fits', async () => {
      const info = await show({ song: ranged() })
      const shown = text(info)
      expect(shown).to.contain('Lead Sheet Range')
      expect(shown).to.contain('D4–E5 in G')
      expect(shown).to.contain('9 notes wide (14 semitones)')
      // (E5 is the edge: yellow, and the words say so as well as the badge)
      expect(shown).to.contain('high')
      expect(badges(info)).to.have.length(1)
      expect(badges(info)[0].getAttribute('data-direction')).to.equal('high')
      expect(shown).to.not.contain('F#5 in')
    })

    it('is the same whatever key the library has the song in, as the range is the song’s own', async () => {
      const shown = text(await show({ song: ranged({ key: 'A' }) }))
      expect(shown).to.contain('D4–E5 in G')
      expect(shown).to.not.contain('E4')
      expect(shown).to.not.contain('in A')
      expect(shown).to.equal(text(await show({ song: ranged({ key: 'G' }) })))
    })

    it('says in words when the song fits as written', async () => {
      const info = await show({ song: ranged({}, { x_chordless_range: 'D4-C5' }) })
      expect(text(info)).to.contain('D4–C5 in G')
      expect(text(info)).to.contain('in range')
    })

    it('keeps the range as the chart says it, and judges the octave nearest the green', async () => {
      const info = await show({ song: ranged({}, { x_chordless_range: 'D5-E6' }) })
      expect(text(info)).to.contain('D5–E6 in G')
      expect(text(info)).to.contain('an octave lower')
    })

    it('offers to add one when the chart says none, and says nothing with no key to write it in', async () => {
      const none = text(await show({ song: ranged({}, { x_chordless_range: '' }) }))
      expect(none).to.contain('Lead Sheet Range')
      expect(none).to.contain('None yet')
      expect(none).to.contain('Add a range')
      // (a song with no chart key and no key of the record's: no key to write the notes in)
      const keyless = await show({ song: song({ metadata: {}, parsed: { metadata: {} } }) })
      expect(text(keyless)).to.not.contain('Lead Sheet Range')
    })

    it('shows the notes, and not how they fit, for a chart with no key to measure from', async () => {
      const info = await show({
        song: song({ metadata: {}, parsed: { metadata: { x_chordless_range: 'D4-E5' } } }),
      })
      expect(text(info)).to.contain('D4–E5 9 notes wide (14 semitones)')
      expect(badges(info)).to.have.length(0)
    })

    describe('setting it', () => {
      const info = async (over: Record<string, unknown> = {}, chart: Record<string, string> = {}) =>
        show({ song: ranged({ uuid: 'song-1', ...over }, chart) })
      const click = (element: SongInfo, label: string) =>
        [...(element.shadowRoot?.querySelectorAll('button') ?? [])]
          .find(button => button.textContent?.trim() === label)
          ?.click()
      const select = (element: SongInfo, label: string) =>
        [...(element.shadowRoot?.querySelectorAll('.range-picker') ?? [])]
          .find(picker => picker.textContent?.trim().startsWith(label))
          ?.querySelector('select') as HTMLSelectElement
      const choose = async (element: SongInfo, label: string, name: string) => {
        const picker = select(element, label)
        const option = [...picker.options].find(o => o.textContent === name)
        picker.value = (option as HTMLOptionElement).value
        picker.dispatchEvent(new Event('change'))
        await element.updateComplete
      }
      const changes = (element: SongInfo) => {
        const sent: SongRangeChangeEvent[] = []
        element.addEventListener(SongRangeChangeEvent.type, event => sent.push(event))
        return sent
      }

      it('opens two pickers of notes, at the range it has, named as the key names them', async () => {
        const element = await info()
        click(element, 'Edit')
        await element.updateComplete
        const low = select(element, 'Lowest note')
        const high = select(element, 'Highest note')
        expect(low.selectedOptions[0].textContent).to.equal('D4')
        expect(high.selectedOptions[0].textContent).to.equal('E5')
        // (A2 to C6 are offered: a singer's span)
        expect(low.options[0].textContent).to.equal('A2')
        expect(low.options[low.options.length - 1].textContent).to.equal('C6')
        expect(text(element)).to.contain('In G, as written')
        expect(text(element)).to.not.contain('9 notes wide')
      })

      it('sends the range the person chose, in the key the notes are in, and shuts the pickers', async () => {
        const element = await info()
        const sent = changes(element)
        click(element, 'Edit')
        await element.updateComplete
        await choose(element, 'Lowest note', 'E4')
        await choose(element, 'Highest note', 'F#5')
        click(element, 'Save')
        await element.updateComplete
        expect(sent).to.have.length(1)
        expect(sent[0].songUuid).to.equal('song-1')
        expect(sent[0].range).to.deep.equal({ low: 64, high: 78 })
        expect(sent[0].key).to.equal('G')
        expect(select(element, 'Lowest note')).to.equal(undefined)
      })

      it('passes the accessibility checks, with the pickers open and with the error', async () => {
        const element = await info()
        click(element, 'Edit')
        await element.updateComplete
        await expect(element).to.be.accessible(A11Y)
        await choose(element, 'Lowest note', 'C6')
        await expect(element).to.be.accessible(A11Y)
      })

      it('sends nothing when cancelled', async () => {
        const element = await info()
        const sent = changes(element)
        click(element, 'Edit')
        await element.updateComplete
        await choose(element, 'Lowest note', 'E4')
        click(element, 'Cancel')
        await element.updateComplete
        expect(sent).to.have.length(0)
        expect(text(element)).to.contain('D4–E5 in G')
      })

      it('takes the range away, when there is one', async () => {
        const element = await info()
        const sent = changes(element)
        click(element, 'Edit')
        await element.updateComplete
        click(element, 'Remove')
        expect(sent).to.have.length(1)
        expect(sent[0].range).to.equal(null)
      })

      it('adds one to a song with none, starting at an octave from D4', async () => {
        const element = await info({}, { x_chordless_range: '' })
        const sent = changes(element)
        click(element, 'Add a range')
        await element.updateComplete
        expect(select(element, 'Lowest note').selectedOptions[0].textContent).to.equal('D4')
        expect(select(element, 'Highest note').selectedOptions[0].textContent).to.equal('D5')
        // (nothing to take away yet)
        expect(text(element)).to.not.contain('Remove')
        click(element, 'Save')
        expect(sent[0].range).to.deep.equal({ low: 62, high: 74 })
      })

      it('will not save a lowest note above the highest, and says so', async () => {
        const element = await info()
        const sent = changes(element)
        click(element, 'Edit')
        await element.updateComplete
        await choose(element, 'Lowest note', 'C6')
        expect(element.shadowRoot?.querySelector('[role="alert"]')?.textContent).to.contain(
          'The lowest note is above the highest'
        )
        const save = [...(element.shadowRoot?.querySelectorAll('button') ?? [])].find(
          button => button.textContent?.trim() === 'Save'
        ) as HTMLButtonElement
        expect(save.disabled).to.equal(true)
        click(element, 'Save')
        expect(sent).to.have.length(0)
        await choose(element, 'Lowest note', 'D4')
        expect(element.shadowRoot?.querySelector('[role="alert"]')).to.equal(null)
      })

      it('offers more notes when the range is wider than a singer’s span', async () => {
        const element = await info({}, { x_chordless_range: 'F2-D7' })
        click(element, 'Edit')
        await element.updateComplete
        const low = select(element, 'Lowest note')
        expect(low.options[0].textContent).to.equal('F2')
        expect(low.options[low.options.length - 1].textContent).to.equal('D7')
      })

      it('shuts the pickers when another song is shown', async () => {
        const element = await info()
        click(element, 'Edit')
        await element.updateComplete
        element.song = ranged({ uuid: 'song-2' }, { x_chordless_range: 'G4-G5' })
        await element.updateComplete
        expect(select(element, 'Lowest note')).to.equal(undefined)
        expect(text(element)).to.contain('G4–G5 in G')
      })

      it('names the notes in the record’s key for a chart with no key, and writes it there', async () => {
        const element = await show({
          song: song({
            uuid: 'song-1',
            key: 'Bb',
            metadata: {},
            parsed: { metadata: { x_chordless_range: 'Bb3-Eb5' } },
          }),
        })
        const sent = changes(element)
        expect(text(element)).to.contain('Bb3–Eb5')
        click(element, 'Edit')
        await element.updateComplete
        expect(select(element, 'Lowest note').selectedOptions[0].textContent).to.equal('Bb3')
        click(element, 'Save')
        expect(sent[0].key).to.equal('Bb')
      })

      it('cannot be edited with no key to name the notes by: shown, with no button', async () => {
        const element = await show({
          song: song({ metadata: {}, parsed: { metadata: { x_chordless_range: 'D4-E5' } } }),
        })
        expect(text(element)).to.contain('D4–E5')
        expect(text(element)).to.not.contain('Edit')
      })

      it('does nothing when saved with no song shown', async () => {
        const element = await info()
        const sent = changes(element)
        click(element, 'Edit')
        await element.updateComplete
        element._saveRange({ low: 60, high: 72 }, 'G')
        element.song = null
        element._saveRange({ low: 60, high: 72 }, 'G')
        expect(sent).to.have.length(1)
      })
    })

    it('says one note, in the singular', async () => {
      const shown = text(await show({ song: ranged({}, { x_chordless_range: 'G4-G4' }) }))
      expect(shown).to.contain('1 note wide (0 semitones)')
    })
  })

  it('shows a key with no tempo, and leaves out what is not there', async () => {
    const shown = text(await show({ song: song({ metadata: { key: 'D' } }) }))
    expect(shown).to.contain('Key: D')
    expect(shown).to.not.contain('BPM')
    expect(shown).to.not.contain('Artist')
    expect(shown).to.not.contain('Time Signature')
    expect(shown).to.not.contain('CCLI')
  })

  it('does not repeat the copyright when the CCLI trailer has it', async () => {
    const shown = text(
      await show({
        song: song({
          metadata: {
            copyright: '(c) 2001 A Publisher',
            ccliTrailer: '© 2001 A  Publisher\nCCLI Song # 123',
          },
        }),
      })
    )
    expect(shown).to.not.contain('Copyright')
    expect(shown).to.contain('CCLI Song # 123')
  })

  it('links to SongSelect for a CCLI number, from any of the places it is kept', async () => {
    for (const where of [
      { metadata: { ccli: '111' } },
      { metadata: { ccliSongNumber: '222' } },
      { ccliNumber: '333' },
    ]) {
      const info = await show({ song: song(where) })
      const link = info.shadowRoot?.querySelector('a.ccli-link') as HTMLAnchorElement
      expect(link.href).to.match(/songselect\.ccli\.com\/songs\/\d{3}$/)
    }
  })

  it('lists the recent plays, newest first and no more than six, and counts them all', async () => {
    const appearances = Array.from({ length: 8 }, (_, i) => ({
      setlistId: `s${i}`,
      date: `2026-0${i + 1}-01`,
      playedInKey: i % 2 ? 'A' : null,
      leader: i === 7 ? '' : 'Ann',
      setlistName: '',
    }))
    const info = await show({ song: song({ metadata: { key: 'G' } }), appearances })
    expect(text(info)).to.contain('Times Played (Total) 8')
    const items = info.shadowRoot?.querySelectorAll('.modal-appearance-item') as NodeListOf<Element>
    expect(items).to.have.length(6)
    // The newest has no leader; the one before was played in no key, so the song's own is shown
    expect(items[0].querySelector('.appearance-meta')?.textContent).to.equal('Key: A')
    expect(items[1].querySelector('.appearance-meta')?.textContent).to.equal('Ann • Key: G')
  })

  it('shows a play with nothing to say of leader or key without a meta line', async () => {
    const info = await show({
      song: song(),
      appearances: [
        { setlistId: 's', date: '2026-01-01', playedInKey: null, leader: '', setlistName: '' },
      ],
    })
    expect(info.shadowRoot?.querySelector('.appearance-meta')).to.equal(null)
  })

  it('knows when the copyright is not in the trailer, or there is no song', async () => {
    const info = await show({ song: song({ metadata: { copyright: '© 2001 A Publisher' } }) })
    expect(info._copyrightIsInTrailer()).to.equal(false)
    info.song = null
    expect(info._copyrightIsInTrailer()).to.equal(false)
  })

  it('counts the plays of the last twelve months', async () => {
    const recent = new Date().toISOString().slice(0, 10)
    const info = await show({
      song: song(),
      appearances: [
        { setlistId: 'a', date: recent, playedInKey: null, leader: '', setlistName: '' },
        { setlistId: 'b', date: '2001-01-01', playedInKey: null, leader: '', setlistName: '' },
      ],
    })
    expect(info.calculateAppearanceStats()).to.deep.equal({
      totalAppearances: 2,
      last12MonthsAppearances: 1,
      lastPlayedDate: recent,
    })
    info.appearances = []
    expect(info.calculateAppearanceStats().totalAppearances).to.equal(0)
  })
})
