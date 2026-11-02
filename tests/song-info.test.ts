import { expect, fixture, html } from '@open-wc/testing'
import type { SongInfo } from '../src/components/song-info.ts'
import '../src/components/song-info.ts'

const { describe, it } = window

type Song = NonNullable<SongInfo['song']>

const song = (over: Record<string, unknown> = {}) =>
  ({ title: 'Amazing Grace', metadata: {}, ...over }) as unknown as Song

describe('song-info', () => {
  async function show(set: Partial<Pick<SongInfo, 'song' | 'appearances' | 'loading'>>) {
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

    it('shows the lowest and highest note, how wide it is, and how it fits', async () => {
      const info = await show({ song: ranged() })
      const shown = text(info)
      expect(shown).to.contain('Melody Range')
      expect(shown).to.contain('D4–E5 in G')
      expect(shown).to.contain('9 notes wide (14 semitones)')
      // (E5 is the edge: yellow, and the words say so as well as the badge)
      expect(shown).to.contain('high')
      expect(badges(info)).to.have.length(1)
      expect(badges(info)[0].getAttribute('data-direction')).to.equal('high')
      expect(shown).to.not.contain('F#5 in')
    })

    it('shows it in the key the library has the song in, when that is another', async () => {
      const info = await show({ song: ranged({ key: 'A' }) })
      const shown = text(info)
      expect(shown).to.contain('D4–E5 in G')
      expect(shown).to.contain('E4–F#5 in A')
      expect(shown).to.contain('too high')
      expect(badges(info)).to.have.length(2)
    })

    it('says in words when the song fits', async () => {
      const info = await show({ song: ranged({ key: 'E' }) })
      expect(text(info)).to.contain('B3–C#5 in E')
      expect(text(info)).to.contain('in range')
    })

    it('shows nothing when the chart says no range', async () => {
      const shown = text(await show({ song: ranged({}, { x_chordless_range: '' }) }))
      expect(shown).to.not.contain('Melody Range')
      expect(text(await show({ song: song({ metadata: { key: 'G' } }) }))).to.not.contain(
        'Melody Range'
      )
    })

    it('shows the notes, and not how they fit, for a chart with no key to measure from', async () => {
      const info = await show({
        song: song({ metadata: {}, parsed: { metadata: { x_chordless_range: 'D4-E5' } } }),
      })
      expect(text(info)).to.contain('D4–E5 9 notes wide (14 semitones)')
      expect(badges(info)).to.have.length(0)
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
