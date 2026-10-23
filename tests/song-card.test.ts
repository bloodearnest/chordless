import { expect, fixture, html } from '@open-wc/testing'
import '../src/components/song-card.ts'
import { KeyChangeEvent, type KeySelector } from '../src/components/key-selector.ts'
import {
  type SongCard,
  SongCardBpmChangeEvent,
  SongCardClickEvent,
  SongCardDeleteEvent,
  SongCardKeyChangeEvent,
  type SongCardSong,
} from '../src/components/song-card.ts'
import { ChordProParser } from '../src/js/parser.ts'
import { must } from './must.ts'

const { describe, it } = window

describe('song-card', () => {
  const song = (over: Partial<SongCardSong> = {}): SongCardSong => ({
    title: 'Amazing Grace',
    artist: 'John Newton',
    metadata: { key: 'G', tempo: 90, timeSignature: '3/4' },
    ...over,
  })

  async function show(set: Partial<SongCard> = {}) {
    const card = await fixture<SongCard>(html`<song-card></song-card>`)
    Object.assign(card, set)
    await card.updateComplete
    return card
  }

  const part = (card: SongCard, name: string) => card.shadowRoot?.querySelector(`[part~="${name}"]`)
  const text = (card: SongCard, selector: string) =>
    card.shadowRoot?.querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim()

  describe('what it shows', () => {
    it('says so when it has no song', async () => {
      expect(text(await show(), '.title')).to.equal('No song data')
    })

    it('shows the title, artist and what is known of the key, tempo and time', async () => {
      const card = await show({ song: song() })
      expect(text(card, '.title')).to.equal('Amazing Grace')
      expect(text(card, '.artist')).to.equal('John Newton')
      expect(text(card, '.meta')).to.equal('Key: G BPM: 90 Time: 3/4')
    })

    it('shows only the parts of the meta it has, and none with no metadata', async () => {
      expect(text(await show({ song: song({ metadata: { key: 'D' } }) }), '.meta')).to.equal(
        'Key: D'
      )
      expect(text(await show({ song: song({ metadata: null }) }), '.meta')).to.equal('')
    })

    it('does not say the unit twice when the chart gives the tempo as "61 bpm"', async () => {
      const card = await show({ song: song({ metadata: { key: 'E', tempo: '61 bpm' } }) })
      expect(text(card, '.meta')).to.equal('Key: E BPM: 61')
    })

    it('leaves the artist out in a setlist, and for a song with none', async () => {
      const inSetlist = await show({ song: song(), variant: 'setlist' })
      expect(part(inSetlist, 'artist')).to.equal(null)
      expect(part(await show({ song: song({ artist: null }) }), 'artist')).to.equal(null)
    })

    it('names the version of the song, unless it is just the original', async () => {
      const named = await show({
        song: song({ variantLabel: 'Simon, capo 3' }),
        variant: 'setlist',
      })
      expect(text(named, '.variant-label')).to.equal('Simon, capo 3')
      expect(
        part(await show({ song: song({ variantLabel: 'Original' }) }), 'variant-label')
      ).to.equal(null)
      expect(part(await show({ song: song({ variantLabel: '' }) }), 'variant-label')).to.equal(null)
      expect(part(await show({ song: song() }), 'variant-label')).to.equal(null)
    })

    it('says "Original" where the song has other versions to tell it from, and marks a search in the name', async () => {
      const several = await show({ song: song({ variantLabel: 'Original', variantCount: 2 }) })
      expect(text(several, '.variant-label')).to.equal('Original')
      const unnamed = await show({ song: song({ variantLabel: '', variantCount: 2 }) })
      expect(text(unnamed, '.variant-label')).to.equal('Original')
      const alone = await show({ song: song({ variantLabel: 'Original', variantCount: 1 }) })
      expect(part(alone, 'variant-label')).to.equal(null)
      const searched = await show({ song: song({ variantLabel: 'Capo 3' }), search: 'capo' })
      expect(searched.shadowRoot?.querySelector('.variant-label mark')?.textContent).to.equal(
        'Capo'
      )
    })

    it('cleans the artist: the credit words go, and more than two become “et al”', async () => {
      expect(
        text(await show({ song: song({ artist: 'Words by John Newton; Music: Anon' }) }), '.artist')
      ).to.equal('John Newton, Anon')
      expect(text(await show({ song: song({ artist: 'A, B; C | D' }) }), '.artist')).to.equal(
        'A et al'
      )
      expect(text(await show({ song: song({ artist: ' ; ' }) }), '.artist')).to.equal('')
    })

    it('shows the key to change in edit mode, from the minor keys for a minor song', async () => {
      const major = await show({
        song: song({ currentKey: 'G', originalKey: 'G' }),
        editMode: true,
      })
      const majorKeys = must(major.shadowRoot?.querySelector<KeySelector>('key-selector')).keys
      expect(majorKeys).to.include('Bb')
      expect(majorKeys).to.not.include('Bbm')

      const minor = await show({ song: song({ currentKey: 'Em' }), editMode: true })
      expect(must(minor.shadowRoot?.querySelector<KeySelector>('key-selector')).keys).to.include(
        'Bbm'
      )

      const none = await show({ song: song(), editMode: true })
      expect(must(none.shadowRoot?.querySelector<KeySelector>('key-selector')).value).to.equal('-')
    })
  })

  describe('when it was last played', () => {
    const last = (card: SongCard) => text(card, '.last-played')

    it('says where a song from another database is from', async () => {
      expect(last(await show({ song: song({ source: { label: 'Shared with me' } }) }))).to.equal(
        'From Shared with me'
      )
    })

    it('says which space the song is in, then who led it and how long ago', async () => {
      expect(last(await show({ song: song({ spaceName: 'Gateway Church' }) }))).to.equal(
        'Gateway Church'
      )
      const card = await show({
        song: song({
          spaceName: 'Gateway Church',
          lastUsageInfo: { date: '2020-01-05', leader: 'Ann', key: 'A' },
        }),
      })
      expect(last(card)).to.match(/^Gateway Church • Ann • in A • \d+ years? ago$/)
      expect(
        last(await show({ song: song({ spaceName: 'Gateway Church', lastUsedAt: '2020-01-05' }) }))
      ).to.match(/^Gateway Church • Last played \d+ years? ago$/)
    })

    it('says who led it, in which key, and how long ago', async () => {
      const card = await show({
        song: song({ lastUsageInfo: { date: '2020-01-05', leader: 'Ann', key: 'A' } }),
      })
      expect(last(card)).to.match(/^Ann • in A • \d+ years? ago$/)
    })

    it('leaves out the leader or key it does not have', async () => {
      const card = await show({
        song: song({ lastUsageInfo: { date: '2020-01-05', leader: '', key: null } }),
      })
      expect(last(card)).to.match(/^\d+ years? ago$/)
    })

    it('reads the older record of when it was last played', async () => {
      expect(last(await show({ song: song({ lastUsedAt: '2020-01-05' }) }))).to.match(
        /^Last played \d+ years? ago$/
      )
    })

    it('says nothing for a song never played, or in a setlist', async () => {
      expect(last(await show({ song: song() }))).to.equal(undefined)
      expect(
        last(await show({ song: song({ lastUsedAt: '2020-01-05' }), variant: 'setlist' }))
      ).to.equal(undefined)
    })
  })

  describe('a search', () => {
    const parsed = new ChordProParser().parse('{title: X}\n\n[G]Was blind but now I see')

    it('marks the words found in the title and artist, and shows nothing else', async () => {
      const card = await show({ song: song(), search: 'grace' })
      expect(card.shadowRoot?.querySelector('.title mark')?.textContent).to.equal('Grace')
      const byArtist = await show({ song: song(), search: 'newton' })
      expect(byArtist.shadowRoot?.querySelector('.artist mark')?.textContent).to.equal('Newton')
      expect(part(card, 'lyric-match')).to.equal(null)
    })

    it('does not mark anything for no search, or one it does not find', async () => {
      expect((await show({ song: song(), search: '' })).shadowRoot?.querySelector('mark')).to.equal(
        null
      )
      expect(
        (await show({ song: song(), search: 'zzz' })).shadowRoot?.querySelector('mark')
      ).to.equal(null)
    })

    it('quotes the lyric line when the words found are only in the lyrics', async () => {
      const card = await show({ song: song({ parsed }), search: 'blind but' })
      expect(part(card, 'lyric-match')?.textContent).to.contain('Was blind but now I see')
      expect(card.shadowRoot?.querySelector('.lyric-match mark')?.textContent).to.equal('blind but')
    })

    it('quotes nothing when the lyrics matched but no line can be quoted', async () => {
      // (“İ” is two characters in lower case, so a place in a line cannot be found)
      const odd = new ChordProParser().parse('{title: X}\n\n[G]İstanbul grace')
      const card = await show({
        song: song({ parsed: odd, title: 'Y', artist: 'Z' }),
        search: 'grace',
      })
      expect(part(card, 'lyric-match')).to.equal(null)
    })

    it('does not quote them when the title matched, or the song has no chart', async () => {
      expect(
        part(await show({ song: song({ parsed, title: 'Blind' }), search: 'blind' }), 'lyric-match')
      ).to.equal(null)
      expect(part(await show({ song: song(), search: 'blind' }), 'lyric-match')).to.equal(null)
    })
  })

  describe('being used', () => {
    it('tells the page the song was chosen when it is clicked', async () => {
      const card = await show({ song: song() })
      const chosen: SongCardSong[] = []
      card.addEventListener(SongCardClickEvent.type, event =>
        chosen.push((event as SongCardClickEvent).song)
      )
      ;(part(card, 'card') as HTMLElement).click()
      expect(chosen).to.have.length(1)
      expect(chosen[0].title).to.equal('Amazing Grace')
    })

    it('says nothing when clicked in edit mode, to be safe from touching it by mistake', async () => {
      const card = await show({ song: song(), editMode: true })
      let heard = 0
      card.addEventListener(SongCardClickEvent.type, () => heard++)
      ;(part(card, 'card') as HTMLElement).click()
      expect(heard).to.equal(0)
    })

    it('says the song is to be removed when its button is pressed, and not that it was clicked', async () => {
      const card = await show({ song: song(), editMode: true })
      const events: string[] = []
      card.addEventListener(SongCardDeleteEvent.type, () => events.push('delete'))
      card.addEventListener(SongCardClickEvent.type, () => events.push('click'))
      ;(part(card, 'delete-button') as HTMLElement).click()
      expect(events).to.deep.equal(['delete'])
    })

    it('passes on the key chosen as its own event, and keeps the selector’s to itself', async () => {
      const card = await show({ song: song({ currentKey: 'G' }), editMode: true })
      const heard: string[] = []
      card.addEventListener(SongCardKeyChangeEvent.type, event =>
        heard.push((event as SongCardKeyChangeEvent).key)
      )
      const outside: Event[] = []
      const listener = (event: Event) => outside.push(event)
      document.addEventListener(KeyChangeEvent.type, listener)
      must(card.shadowRoot?.querySelector('key-selector')).dispatchEvent(new KeyChangeEvent('A'))
      expect(heard).to.deep.equal(['A'])
      document.removeEventListener(KeyChangeEvent.type, listener)
      expect(outside).to.have.length(0)
    })

    describe('the tempo', () => {
      const box = (card: SongCard) =>
        must(card.shadowRoot?.querySelector<HTMLInputElement>('.bpm-edit input'))
      const type = (card: SongCard, value: string) => {
        box(card).value = value
        box(card).dispatchEvent(new Event('change'))
      }
      const bpmCard = () =>
        show({
          song: song({ metadata: { key: 'G', tempo: 72 } }),
          editMode: true,
          variant: 'setlist',
        })

      it('is a number box in a setlist, showing the song’s tempo', async () => {
        expect(box(await bpmCard()).value).to.equal('72')
      })

      it('is not offered in the library, and is empty for a song with none', async () => {
        const library = await show({ song: song(), editMode: true })
        expect(library.shadowRoot?.querySelector('.bpm-edit')).to.equal(null)
        const none = await show({
          song: song({ metadata: { key: 'G' } }),
          editMode: true,
          variant: 'setlist',
        })
        expect(box(none).value).to.equal('')
      })

      it('says the tempo typed as its own event', async () => {
        const card = await bpmCard()
        const heard: number[] = []
        card.addEventListener(SongCardBpmChangeEvent.type, event =>
          heard.push((event as SongCardBpmChangeEvent).bpm)
        )
        type(card, '96')
        expect(heard).to.deep.equal([96])
      })

      it('puts back the song’s tempo for one that is out of range or empty', async () => {
        const card = await bpmCard()
        const heard: number[] = []
        card.addEventListener(SongCardBpmChangeEvent.type, event =>
          heard.push((event as SongCardBpmChangeEvent).bpm)
        )
        type(card, '900')
        expect(box(card).value).to.equal('72')
        type(card, '')
        expect(box(card).value).to.equal('72')
        expect(heard).to.deep.equal([])
        const none = await show({
          song: song({ metadata: { key: 'G' } }),
          editMode: true,
          variant: 'setlist',
        })
        type(none, '5')
        expect(box(none).value).to.equal('')
      })
    })

    it('does not open the context menu, as a long press on a touch screen would', async () => {
      const card = await show({ song: song() })
      const event = new Event('contextmenu', { bubbles: true, cancelable: true })
      card.dispatchEvent(event)
      expect(event.defaultPrevented).to.equal(true)
    })

    it('lets the context menu be once it has gone', async () => {
      const card = await show({ song: song() })
      const parent = card.parentElement
      card.remove()
      const event = new Event('contextmenu', { cancelable: true })
      card.dispatchEvent(event)
      expect(event.defaultPrevented).to.equal(false)
      parent?.append(card)
    })
  })
})
