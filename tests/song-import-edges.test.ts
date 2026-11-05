import { expect, fixture, html } from '@open-wc/testing'
import { SongImportedEvent } from '../src/components/song-import.ts'
import { createSetlist, getCurrentDB, normalizeTitle } from '../src/js/db.ts'
import { offerIncoming } from '../src/js/incoming-songs.ts'
import { createSong } from '../src/js/song-utils.ts'
import { makeSong } from './builders.ts'
import { installFakeAuthWorker } from './fake-auth-worker.ts'
import { must } from './must.ts'
import { clearToasts, shownToast, suppressConsoleLogs } from './test-helpers.ts'

const { describe, it, afterEach } = window

suppressConsoleLogs()

/** The song-import page's remaining corners: messages, the opener, and what can go wrong */
describe('song-import: corners', () => {
  const unique = (name: string) => `${name} ${crypto.randomUUID().slice(0, 8)}`
  const chart = (title: string, body = '[C]Hello') => `{title: ${title}}\n{key: C}\n\n${body}`
  const importer = async (): Promise<any> => fixture(html`<song-import></song-import>`)
  const $ = (element: any, selector: string) => element.shadowRoot.querySelector(selector)
  const waitFor = async (check: () => unknown, timeout = 2000) => {
    const start = Date.now()
    while (!check()) {
      if (Date.now() - start > timeout) throw new Error('Timed out waiting')
      await new Promise(resolve => setTimeout(resolve, 10))
    }
  }
  const message = (data: unknown) =>
    window.dispatchEvent(
      new MessageEvent('message', { origin: 'https://songselect.ccli.com', data })
    )

  it('imports what the SongSelect bookmarklet sends, and ignores messages of no kind', async () => {
    const element = await importer()
    message(null)
    message({ type: 'other' })
    message({ type: 'CHORDLESS_IMPORT_FAILED' })
    await element.updateComplete
    expect($(element, '[role="alert"]').textContent).to.contain('failed')
    const title = unique('Bookmarklet')
    message({
      type: 'CHORDLESS_IMPORT',
      data: { chordproText: chart(title), metadata: { title }, source: 'songselect' },
    })
    await waitFor(() => element._state === 'choices')
    expect(element._imports[0].song.title).to.equal(title)
  })

  describe('a lead sheet', () => {
    const leadSheet = () => new TextEncoder().encode('%PDF-1.4 a lead sheet').buffer
    /** What the reader gives for the sheet of a song in C, D4 to E5, as it reads it */
    const read = (overrides = {}) => ({
      low: 62,
      high: 76,
      keySignature: 0,
      notes: 312,
      instrumental: 31,
      unsung: 7,
      pages: 3,
      staves: 19,
      lowAt: { page: 2, staff: 3 },
      highAt: { page: 1, staff: 2 },
      ...overrides,
    })

    /** An importer whose melody reader is a stand-in, and a log of what it was asked to read */
    async function importerReading(read: (pdf: ArrayBuffer) => Promise<unknown>) {
      const element = await importer()
      const reads: ArrayBuffer[] = []
      element.loadMelodyReader = async () => ({
        readMelodyRange: async (pdf: ArrayBuffer) => {
          reads.push(pdf)
          return read(pdf)
        },
      })
      return { element, reads }
    }

    /** What the page says, as a person reads it */
    const said = async (element: any) => {
      await element.updateComplete
      return element.shadowRoot.textContent.replace(/\s+/g, ' ')
    }

    it('puts the melody range in the chart it came with, in the chart key', async () => {
      const { element, reads } = await importerReading(async () => read())
      await element.receive({
        chordproText: chart(unique('With a range')),
        source: 'songselect',
        leadSheet: leadSheet(),
      })
      expect(reads).to.have.length(1)
      expect(element._imports[0].chordproText).to.equal(
        `{title: ${element._imports[0].song.title}}\n{key: C}\n{x_chordless_range: D4-E5}\n\n[C]Hello`
      )
      expect(await said(element)).to.contain('Melody range D4–E5 in C, from the lead sheet.')
    })

    it('says so on the page when the lead sheet had no melody, or could not be read', async () => {
      const cases: [() => Promise<unknown>, string][] = [
        [async () => null, 'The lead sheet had no melody to read, so there is no range.'],
        [
          async () => Promise.reject(new Error('damaged')),
          'The lead sheet could not be read, so there is no range.',
        ],
      ]
      for (const [read, sentence] of cases) {
        const { element } = await importerReading(read)
        await element.receive({
          chordproText: chart(unique('Says so')),
          source: 'songselect',
          leadSheet: leadSheet(),
        })
        expect(await said(element)).to.contain(sentence)
      }
    })

    it('is not used when it is in another key than the chart, and says so', async () => {
      // the sheet has a sharp, and the chart is in C
      const { element } = await importerReading(async () => read({ keySignature: 1 }))
      const text = chart(unique('Another key'))
      await element.receive({ chordproText: text, source: 'songselect', leadSheet: leadSheet() })
      expect(element._imports[0].chordproText).to.equal(text)
      expect(await said(element)).to.contain(
        'The lead sheet is in another key than the chart (1 sharp (G major or E minor); the chart is in C), so its range was not used.'
      )
    })

    it('is used when it is in the chart key, a minor chart with its relative major signature too', async () => {
      const { element } = await importerReading(async () => read({ keySignature: 1 }))
      const minor = `{title: ${unique('Minor')}}\n{key: Em}\n\n[Em]Hello`
      await element.receive({ chordproText: minor, source: 'songselect', leadSheet: leadSheet() })
      expect(element._imports[0].chordproText).to.contain('{x_chordless_range: D4-E5}')
    })

    it('says how it was read, and where the lowest and highest notes are, to check them by', async () => {
      const { element } = await importerReading(async () => read())
      await element.receive({
        chordproText: chart(unique('How')),
        source: 'songselect',
        leadSheet: leadSheet(),
      })
      const text = await said(element)
      expect(text).to.contain('How the lead sheet was read')
      expect(text).to.contain(
        '3 pages and 19 staves: 312 sung notes read, and left out 31 small instrumental notes and 7 notes with no lyric.'
      )
      expect(text).to.contain(
        'Key signature: no sharps or flats (C major or A minor). The chart is in C.'
      )
      expect(text).to.contain('Lowest note D4: page 2, staff 3 from the top.')
      expect(text).to.contain('Highest note E5: page 1, staff 2 from the top.')
    })

    it('says what it left out when that is only one kind, in the singular', async () => {
      for (const [overrides, sentence] of [
        [{ instrumental: 1, unsung: 0 }, 'and left out 1 small instrumental note.'],
        [{ instrumental: 0, unsung: 1 }, 'and left out 1 note with no lyric.'],
      ] as const) {
        const { element } = await importerReading(async () => read(overrides))
        await element.receive({
          chordproText: chart(unique('Left out')),
          source: 'songselect',
          leadSheet: leadSheet(),
        })
        expect(await said(element)).to.contain(sentence)
      }
    })

    it('says how it was read in the singular, and when it is in another key', async () => {
      const { element } = await importerReading(async () =>
        read({ pages: 1, staves: 1, notes: 1, instrumental: 0, unsung: 0, keySignature: -2 })
      )
      await element.receive({
        chordproText: chart(unique('Singular')),
        source: 'songselect',
        leadSheet: leadSheet(),
      })
      const text = await said(element)
      expect(text).to.contain('1 page and 1 staff: 1 sung note read.')
      expect(text).to.not.contain('left out')
      expect(text).to.contain('Key signature: 2 flats (Bb major or G minor).')
    })

    it('says when the song is already in the library and the chart is the same', async () => {
      const title = unique('Same again')
      const { element } = await importerReading(async () => read())
      const text = chart(title)
      await createSong(`${text.replace('{key: C}', '{key: C}\n{x_chordless_range: D4-E5}')}`)
      await element.receive({ chordproText: text, source: 'songselect', leadSheet: leadSheet() })
      expect(element._imports[0].comparison.verdict).to.equal('identical')
      const said = await element.updateComplete.then(() =>
        element.shadowRoot.textContent.replace(/\s+/g, ' ')
      )
      expect(said).to.contain(
        'An identical version of this song is already in your library, nothing to import.'
      )
      // (nothing to save, but a way on: to the library, said as that and not as saving)
      expect($(element, '.library-only .title').textContent.trim()).to.equal('Go to the Library')
      expect($(element, '.library-only .subtitle').textContent.trim()).to.equal(
        'Nothing to save: it is in the library'
      )
      expect($(element, '.new-setlist')).to.exist
      expect($(element, '.add-to-setlist')).to.exist
      expect(element.shadowRoot.querySelector('.already')).to.exist
    })

    it('says so in a list of songs too', async () => {
      const title = unique('In a list')
      await createSong(chart(title))
      const { element } = await importerReading(async () => read())
      await element.receiveAll([
        { chordproText: chart(title), source: 'songselect' },
        { chordproText: chart(unique('Another')), source: 'songselect' },
      ])
      await element.updateComplete
      expect(element.shadowRoot.textContent).to.contain('identical version already in library')
      // (the other song is new, so there is something to save)
      expect($(element, '.library-only .title').textContent.trim()).to.equal('Save to Library Only')
    })

    it('updates the library chart with no question when the lead sheet only adds a range to it', async () => {
      const title = unique('Adds a range')
      const song = await createSong(chart(title))
      const { element } = await importerReading(async () => read())
      await element.receive({
        chordproText: chart(title),
        source: 'songselect',
        leadSheet: leadSheet(),
      })
      const [item] = element._imports
      expect(item.comparison.verdict).to.equal('same-chart')
      expect(item.auto).to.equal(true)
      expect(item.choice).to.equal('update')
      await element.updateComplete
      expect($(element, '.duplicate')).to.equal(null)
      expect(await said(element)).to.contain(
        'This song was already in your library, as the same song. It has been updated.'
      )
      const db = await getCurrentDB()
      const stored = must(await db.getSong(song.uuid))
      expect(must(await db.getChordPro(stored.chordproFileId)).content).to.contain(
        '{x_chordless_range: D4-E5}'
      )
    })

    it('updates it too when only other details differ, and the import adds no range', async () => {
      const title = unique('No range added')
      const song = await createSong(chart(title))
      const element = await importer()
      await element.receive({
        chordproText: chart(title).replace('{key: C}', '{key: C}\n{tempo: 70}'),
        source: 'songselect',
      })
      expect(element._imports[0].choice).to.equal('update')
      const db = await getCurrentDB()
      expect(must(await db.getSong(song.uuid)).tempo).to.equal(70)
    })

    it('says so when a SongSelect song came with no lead sheet, and nothing for a song with none to expect', async () => {
      const element = await importer()
      await element.receive({
        chordproText: chart(unique('From SongSelect')),
        source: 'songselect',
      })
      expect(await said(element)).to.contain(
        'No lead sheet came with this song, so there is no range.'
      )
      const pasted = await importer()
      await pasted.receive({ chordproText: chart(unique('Pasted')), source: 'paste' })
      await pasted.updateComplete
      expect($(pasted, '.range')).to.equal(null)
    })

    describe('a range set by the person', () => {
      const choose = async (element: any, label: string, value: number) => {
        const picker = [...element.shadowRoot.querySelectorAll('.range-picker')].find(one =>
          one.textContent.includes(label)
        )
        const select = picker.querySelector('select')
        select.value = String(value)
        select.dispatchEvent(new Event('change'))
        await element.updateComplete
      }

      it('is offered for a song with no range, and put in its chart', async () => {
        const element = await importer()
        const title = unique('Set by hand')
        await element.receive({ chordproText: chart(title), source: 'songselect' })
        expect(await said(element)).to.contain('Set the range yourself')
        await choose(element, 'Lowest note', 60)
        await choose(element, 'Highest note', 76)
        $(element, '.range-set button').click()
        await waitFor(() => element._imports[0].rangeSetByHand)
        await element.updateComplete
        expect(await said(element)).to.contain('Melody range C4–E5 in C, set by you.')
        expect($(element, '.range-set')).to.equal(null)
        const db = await getCurrentDB()
        const stored = must(await db.getSong(element._imports[0].song.uuid))
        expect(must(await db.getChordPro(stored.chordproFileId)).content).to.contain(
          '{x_chordless_range: C4-E5}'
        )
      })

      it('is offered for a pasted song too, and not for a chart that has a range', async () => {
        const pasted = await importer()
        await pasted.receive({ chordproText: chart(unique('Pasted')), source: 'paste' })
        await pasted.updateComplete
        expect($(pasted, '.range-set')).to.not.equal(null)
        const ranged = await importer()
        await ranged.receive({
          chordproText: `${chart(unique('Has one'))}\n{x_chordless_range: E4-D5}`,
          source: 'file',
        })
        await ranged.updateComplete
        expect($(ranged, '.range-set')).to.equal(null)
      })

      it('cannot be saved with the lowest note above the highest', async () => {
        const element = await importer()
        await element.receive({ chordproText: chart(unique('Backwards')), source: 'songselect' })
        await choose(element, 'Lowest note', 76)
        await choose(element, 'Highest note', 60)
        expect($(element, '.range-set button').disabled).to.equal(true)
        expect($(element, '.range-error').textContent).to.contain('lowest note is above')
      })

      it("is not offered for a list of songs, or one that is the library's already", async () => {
        const several = await importer()
        await several.receiveAll([
          { chordproText: chart(unique('One')), source: 'songselect' },
          { chordproText: chart(unique('Two')), source: 'songselect' },
        ])
        await several.updateComplete
        expect($(several, '.range-set')).to.equal(null)
        const title = unique('Identical')
        await createSong(chart(title))
        const again = await importer()
        await again.receive({ chordproText: chart(title), source: 'songselect' })
        await again.updateComplete
        expect($(again, '.range-set')).to.equal(null)
      })

      it('says so in a toast, with a way to try again, when it cannot be saved', async () => {
        clearToasts()
        const element = await importer()
        await element.receive({ chordproText: chart(unique('Cannot save')), source: 'songselect' })
        const db = await getCurrentDB()
        const { uuid } = element._imports[0].song
        await db.deleteSong(uuid, { remember: false })
        $(element, '.range-set button').click()
        await waitFor(() => shownToast())
        const toast = must(shownToast())
        expect(toast.kind).to.equal('error')
        expect(toast.message).to.equal("Couldn't save the melody range.")
        expect(toast.details).to.contain('Song not found')
        expect(element._imports[0].rangeSetByHand).to.equal(undefined)
        // (trying again tries again: the song is still not there, so it says so again)
        clearToasts()
        must(toast.action).run()
        await waitFor(() => shownToast())
        expect(must(shownToast()).message).to.equal("Couldn't save the melody range.")
      })
    })

    it('shows the range a chart already has', async () => {
      const element = await importer()
      const ranged = `${chart(unique('Has a range'))}\n{x_chordless_range: E4-D5}`
      await element.receive({ chordproText: ranged, source: 'file' })
      const text = await said(element)
      expect(text).to.contain('Melody range E4–D5 in C.')
      expect(text).to.not.contain('from the lead sheet')
    })

    it('shows the range beside the comparison when the song is already in the library', async () => {
      const title = unique('Already here')
      await createSong(chart(title))
      const { element } = await importerReading(async () => read())
      await element.receive({
        chordproText: chart(title, '[C]Hello [F]there'),
        source: 'songselect',
        leadSheet: leadSheet(),
      })
      expect(element._imports[0].isDuplicate).to.equal(true)
      expect(await said(element)).to.contain('Melody range D4–E5 in C, from the lead sheet.')
    })

    it('imports the song without a range when the lead sheet has no melody, or cannot be read', async () => {
      for (const read of [async () => null, async () => Promise.reject(new Error('damaged'))]) {
        const { element } = await importerReading(read)
        const text = chart(unique('No range'))
        await element.receive({ chordproText: text, source: 'songselect', leadSheet: leadSheet() })
        expect(element._imports[0].chordproText).to.equal(text)
      }
    })

    it('imports the song without a range when the reader cannot be loaded', async () => {
      const element = await importer()
      element.loadMelodyReader = async () => {
        throw new Error('offline')
      }
      const text = chart(unique('No reader'))
      await element.receive({ chordproText: text, source: 'songselect', leadSheet: leadSheet() })
      expect(element._imports[0].chordproText).to.equal(text)
    })

    it('is not read when there is no key to put its notes in, or the chart has a range', async () => {
      const { element, reads } = await importerReading(async () => read())
      const noKey = `{title: ${unique('No key')}}\n\n[C]Hello`
      await element.receive({ chordproText: noKey, source: 'songselect', leadSheet: leadSheet() })
      expect(element._imports[0].chordproText).to.equal(noKey)
      const ranged = `${chart(unique('Has a range'))}\n{x_chordless_range: E4-D5}`
      await element.receive({ chordproText: ranged, source: 'songselect', leadSheet: leadSheet() })
      expect(element._imports[0].chordproText).to.equal(ranged)
      expect(reads).to.have.length(0)
    })

    it('is not read when it is not a PDF in a buffer, or is far too big', async () => {
      const { element, reads } = await importerReading(async () => read())
      for (const sent of ['%PDF', { byteLength: 5 }, new ArrayBuffer(9 * 1024 * 1024)]) {
        const text = chart(unique('Not a lead sheet'))
        await element.receive({ chordproText: text, source: 'songselect', leadSheet: sent })
        expect(element._imports[0].chordproText).to.equal(text)
      }
      expect(reads).to.have.length(0)
    })

    describe('chosen together with its ChordPro', () => {
      const pdf = (name: string, marker: string) =>
        new File([`%PDF-1.4 ${marker}`], name, { type: 'application/pdf' })
      const cho = (title: string, extra = '', trailer = '') =>
        new File([`{title: ${title}}\n${extra}{key: C}\n\n[C]Hello${trailer}`], `${title}.chordpro`)
      /** What SongSelect puts at the foot of a ChordPro: the number is a line of text, not a directive */
      const ccliTrailer = (number: string) =>
        `\n\nCCLI Song # ${number}\n© 2022 A Publisher\nFor use solely with the SongSelect® Terms of Use. All rights reserved. www.ccli.com\nCCLI License # 471102`
      const markerOf = (bytes: ArrayBuffer) =>
        new TextDecoder().decode(bytes).replace('%PDF-1.4 ', '')

      /** An importer whose PDFs say what the table says by their marker, and have the range it gives */
      async function importerForSheets(
        texts: Record<string, string>,
        ranges: Record<string, { low: number; high: number }>
      ) {
        const element = await importer()
        element.loadPdfReader = async () => ({
          readPdfText: async (bytes: ArrayBuffer) => texts[markerOf(bytes)] ?? '',
        })
        element.loadMelodyReader = async () => ({
          readMelodyRange: async (bytes: ArrayBuffer) => {
            const range = ranges[markerOf(bytes)]
            return range ? read(range) : null
          },
        })
        return element
      }
      const rangeIn = (element: any, index: number) =>
        /x_chordless_range: (\S+)}/.exec(element._imports[index].chordproText)?.[1]

      it('pairs each PDF with the song of its CCLI number, in whatever order they come', async () => {
        const a = unique('Song A')
        const b = unique('Song B')
        const element = await importerForSheets(
          { A: 'Another title\nCCLI Song # 1111111', B: 'Not this title\nCCLI Song # 2222222' },
          { A: { low: 62, high: 76 }, B: { low: 64, high: 77 } }
        )
        await element.importFiles([
          pdf('b.pdf', 'B'),
          // (the number as SongSelect's ChordPro has it, and as a directive)
          cho(a, '', ccliTrailer('1111111')),
          cho(b, '{ccli: 2222222}\n'),
          pdf('a.pdf', 'A'),
        ])
        expect(element._imports).to.have.length(2)
        expect(rangeIn(element, 0)).to.equal('D4-E5')
        expect(rangeIn(element, 1)).to.equal('E4-F5')
        expect(await said(element)).to.contain('Melody range D4–E5 in C, from the lead sheet.')
      })

      it('pairs by title when there is no CCLI number, from the sheet or from its filename', async () => {
        const title = unique('Washed')
        const element = await importerForSheets(
          { SHEET: `${title}\n(based on the recording by Someone)` },
          { SHEET: { low: 62, high: 76 } }
        )
        // (a chart with no title of its own is not this song)
        const untitled = new File(['{key: C}\n[C]No title'], 'untitled.chordpro')
        await element.importFiles([untitled, cho(title), pdf(`${title}-lead-G.pdf`, 'SHEET')])
        expect(rangeIn(element, 0)).to.equal(undefined)
        expect(rangeIn(element, 1)).to.equal('D4-E5')
        const named = await importerForSheets({}, { NAMED: { low: 62, high: 76 } })
        const other = unique('By name')
        await named.importFiles([cho(other), pdf(`${other}.pdf`, 'NAMED')])
        expect(rangeIn(named, 0)).to.equal('D4-E5')
      })

      it('pairs by filename when the PDF reader cannot be loaded', async () => {
        const title = unique('No reader')
        const element = await importerForSheets({}, { X: { low: 62, high: 76 } })
        element.loadPdfReader = async () => {
          throw new Error('offline')
        }
        await element.importFiles([cho(title), pdf(`${title}.pdf`, 'X')])
        expect(rangeIn(element, 0)).to.equal('D4-E5')
      })

      it('does not import a PDF of no song chosen with it, and says why, and imports the song', async () => {
        const element = await importerForSheets({ OTHER: 'Quite another song' }, {})
        await element.importFiles([cho(unique('Chosen')), pdf('other.pdf', 'OTHER')])
        expect(element._imports).to.have.length(1)
        expect(element._imports[0].chordproText).to.not.contain('x_chordless_range')
        expect(await said(element)).to.contain(
          'Not imported: other.pdf: a PDF, but no ChordPro chosen with it is of this song'
        )
      })

      it('says so when only a PDF is chosen', async () => {
        const element = await importerForSheets({}, {})
        await element.importFiles([pdf('alone.pdf', 'X')])
        await element.updateComplete
        expect(element._error).to.contain('No songs to import')
        expect(element._error).to.contain('alone.pdf')
      })

      it('gives a song one lead sheet, and not a second: the other is not imported', async () => {
        const title = unique('Two sheets')
        const element = await importerForSheets(
          { ONE: title, TWO: title },
          { ONE: { low: 62, high: 76 }, TWO: { low: 40, high: 90 } }
        )
        await element.importFiles([cho(title), pdf('one.pdf', 'ONE'), pdf('two.pdf', 'TWO')])
        expect(rangeIn(element, 0)).to.equal('D4-E5')
        expect(await said(element)).to.contain('Not imported: two.pdf')
      })

      it('says it is reading the PDF while it does', async () => {
        const title = unique('Slow PDF')
        const element = await importerForSheets({}, {})
        let finish: (text: string) => void = () => {}
        let started = false
        element.loadPdfReader = async () => ({
          readPdfText: () =>
            new Promise<string>(resolve => {
              finish = resolve
              started = true
            }),
        })
        const done = element.importFiles([cho(title), pdf(`${title}.pdf`, 'X')])
        await waitFor(() => started)
        await element.updateComplete
        expect($(element, '.working').textContent).to.contain('Reading the PDF…')
        finish(title)
        await done
        expect(element._busy).to.equal(false)
      })

      it('does the same for files opened with Chordless or shared to it', async () => {
        const title = unique('Shared')
        const element = await importerForSheets(
          { SHEET: `${title}\nCCLI Song # 3333333` },
          { SHEET: { low: 62, high: 76 } }
        )
        offerIncoming({
          files: [cho(title, '{ccli: 3333333}\n'), pdf('sheet.pdf', 'SHEET')],
          text: '',
        })
        await waitFor(() => element._state === 'choices')
        expect(rangeIn(element, 0)).to.equal('D4-E5')
      })
    })

    it('is read by the real reader, which loads in the browser', async () => {
      const element = await importer()
      const reader = await element.loadMelodyReader()
      expect(reader.readMelodyRange).to.be.a('function')
    })

    it('comes from the bookmarklet in its message', async () => {
      const { element, reads } = await importerReading(async () => read())
      const title = unique('From the bookmarklet')
      message({
        type: 'CHORDLESS_IMPORT',
        data: {
          chordproText: chart(title),
          metadata: { title },
          source: 'songselect',
          leadSheet: leadSheet(),
        },
      })
      await waitFor(() => element._state === 'choices')
      expect(reads).to.have.length(1)
      expect(element._imports[0].chordproText).to.contain('{x_chordless_range: D4-E5}')
    })
  })

  describe('opened by the bookmarklet', () => {
    /** Run with a window.opener, as a tab the bookmarklet opened has */
    async function opened<T>(run: () => Promise<T>): Promise<T> {
      const real = Object.getOwnPropertyDescriptor(window, 'opener')
      Object.defineProperty(window, 'opener', {
        configurable: true,
        value: { postMessage: () => {} },
      })
      try {
        return await run()
      } finally {
        if (real) Object.defineProperty(window, 'opener', real)
        else Reflect.deleteProperty(window, 'opener')
      }
    }
    const said = async (element: any) => {
      await element.updateComplete
      return element.shadowRoot.textContent.replace(/\s+/g, ' ')
    }

    it('shows a spinner and what it is waiting for, and not the ways to import by hand', async () => {
      await opened(async () => {
        const element = await importer()
        expect(await said(element)).to.contain('Waiting for SongSelect…')
        expect($(element, '.spinner')).to.exist
        expect($(element, '[role="status"]')).to.exist
        expect($(element, 'textarea')).to.equal(null)
        expect($(element, 'input[type="file"]')).to.equal(null)
      })
    })

    it('says it is reading the song, and the lead sheet, until it is done', async () => {
      await opened(async () => {
        const element = await importer()
        let finish: (value: unknown) => void = () => {}
        element.loadMelodyReader = () =>
          new Promise(resolve => {
            finish = () => resolve({ readMelodyRange: async () => null })
          })
        message({
          type: 'CHORDLESS_IMPORT',
          data: {
            chordproText: chart(unique('Slow')),
            source: 'songselect',
            leadSheet: new TextEncoder().encode('%PDF-1.4').buffer,
          },
        })
        await waitFor(() => element._progress === 'Reading the lead sheet…')
        const text = await said(element)
        expect(text).to.contain('Reading the lead sheet…')
        expect($(element, 'textarea')).to.equal(null)
        finish(null)
        await waitFor(() => element._state === 'choices')
        expect(await said(element)).to.not.contain('Reading the lead sheet')
      })
    })

    it('shows the ways to import by hand when the import fails', async () => {
      await opened(async () => {
        const element = await importer()
        message({ type: 'CHORDLESS_IMPORT_FAILED', data: { message: 'no access' } })
        await element.updateComplete
        expect($(element, '[role="alert"]').textContent).to.contain('no access')
        expect($(element, 'textarea')).to.exist
      })
    })

    it('shows them too when asked to', async () => {
      await opened(async () => {
        const element = await importer()
        $(element, '.manual').click()
        await element.updateComplete
        expect($(element, 'textarea')).to.exist
        expect($(element, '.spinner')).to.equal(null)
      })
    })
  })

  it('tells the page that opened it that it is ready', async () => {
    const posted: unknown[] = []
    const real = Object.getOwnPropertyDescriptor(window, 'opener')
    Object.defineProperty(window, 'opener', {
      configurable: true,
      value: { postMessage: (data: unknown) => posted.push(data) },
    })
    try {
      const element = await importer()
      expect(posted).to.deep.equal([{ type: 'CHORDLESS_READY' }])
      expect(element.shadowRoot.textContent).to.contain('Waiting for SongSelect')
      Object.defineProperty(window, 'opener', {
        configurable: true,
        value: {
          postMessage: () => {
            throw new Error('closed')
          },
        },
      })
      element._signalReady()
    } finally {
      if (real) Object.defineProperty(window, 'opener', real)
      else Reflect.deleteProperty(window, 'opener')
    }
  })

  it('imports a chart with a CCLI number, from the chart or the sender', async () => {
    const element = await importer()
    await element.receiveAll([
      { name: 'a', chordproText: `${chart(unique('Ccli A'))}\n{ccli: 7000001}`, source: 'paste' },
      {
        name: 'b',
        chordproText: chart(unique('Ccli B')),
        metadata: { ccliNumber: '7000002' },
        source: 'paste',
      },
      { name: 'c', chordproText: '[C]no title', source: 'paste' },
    ])
    expect(
      element._imports.map((item: { song: { title: string } }) => item.song.title)
    ).to.have.length(3)
    expect(element._imports[2].song.title).to.equal('Untitled')
  })

  it('does not import from the paste box once it has gone', async () => {
    const element = await importer()
    await element.receive({ chordproText: chart(unique('Pasted')), source: 'paste' })
    await element.updateComplete
    element._importPasted()
    await waitFor(() => element._error)
    expect(element._error).to.contain('No songs to import')
  })

  it('says so when the setlist it was to add to is not there, or cannot be saved', async () => {
    const element = await importer()
    await element.receive({ chordproText: chart(unique('Lost')), source: 'paste' })
    await element._addToSetlist('no-such-setlist')
    expect(element._error).to.contain('Setlist not found')
  })

  it('says so when a song cannot be updated', async () => {
    const element = await importer()
    await element.receive({ chordproText: chart(unique('Gone')), source: 'paste' })
    await element._applyPicks([
      { song: { uuid: 'no-such-song' }, chordproText: 'x', pick: 'update' },
    ])
    expect(element._error).to.contain('Failed to import the song')
  })

  it('compares with a chart that is not there as with an empty one', async () => {
    const db = await getCurrentDB()
    const title = unique('No chart')
    await db.saveSong(
      makeSong({
        uuid: unique('no-chart'),
        id: `title-${title}`,
        title,
        titleNormalized: normalizeTitle(title),
        chordproFileId: 'chordpro-missing',
      })
    )
    const element = await importer()
    await element.receive({ chordproText: chart(title), source: 'paste' })
    await element.updateComplete
    expect(element._imports[0].comparison.verdict).to.equal('different-words')
  })

  it('does nothing for a duplicate with nothing picked', async () => {
    const element = await importer()
    await element.receive({ chordproText: chart(unique('Nothing')), source: 'paste' })
    await element._applyPicks([{ song: { uuid: 'no-such-song' }, chordproText: 'x' }])
    expect(element._error).to.equal('')
  })

  it('says so when a duplicate cannot be imported', async () => {
    const element = await importer()
    await element.receive({ chordproText: chart(unique('Gone both')), source: 'paste' })
    await element._applyPicks([
      { song: { uuid: 'no-such-song' }, chordproText: 'x', pick: 'as-original' },
    ])
    expect(element._error).to.contain('Failed to import the song')
  })

  it('names setlists with a name, and asks about several songs already in the library', async () => {
    const db = await getCurrentDB()
    const setlist = createSetlist({ date: '2099-02-02', name: unique('Named') })
    await db.saveSetlist(setlist)
    const titles = [unique('Dup one'), unique('Dup two')]
    for (const title of titles) await createSong(chart(title))
    const element = await importer()
    await element.receiveAll(
      titles.map(title => ({
        name: title,
        chordproText: chart(title, '[D]Different'),
        source: 'paste',
      }))
    )
    await element.updateComplete
    expect(element.shadowRoot.textContent).to.contain('2 of these songs are already')
    for (const radio of element.shadowRoot.querySelectorAll('.pick-use-existing')) radio.click()
    await element.updateComplete
    $(element, '.apply-all').click()
    await waitFor(() => $(element, '.choices'))
    expect($(element, 'select').textContent).to.contain(setlist.name)
  })

  it('opens the new setlist form for a user nobody knows, and a failed save of it is shown', async () => {
    const element = await importer()
    await element.receive({ chordproText: chart(unique('Fresh')), source: 'paste' })
    await element.updateComplete
    await element._openNewSetlist()
    const db = element._db
    const real = db.saveSetlist
    db.saveSetlist = async () => {
      throw new Error('disk full')
    }
    try {
      await element._createSetlist(
        Object.assign(new Event('x'), { details: { date: '2099-03-03', name: 'N' } })
      )
    } finally {
      db.saveSetlist = real
    }
    expect(element._error).to.contain('Failed to create setlist')
    must(element)
    expect(SongImportedEvent.type).to.be.a('string')
  })

  describe('with someone signed in', () => {
    let auth: ReturnType<typeof installFakeAuthWorker>
    afterEach(() => auth?.uninstall())

    it('starts a new setlist led by them, for several songs, and saves it', async () => {
      auth = installFakeAuthWorker()
      auth.worker.stored = {
        blob: 'blob',
        metadata: {
          access_token: 'token',
          expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
          user: {
            picture: null,
            given_name: null,
            family_name: null,
            sub: '1',
            name: 'Ann Singer',
            email: 'ann@example.com',
          },
        },
        updated_at: new Date().toISOString(),
      } as never
      const db = await getCurrentDB()
      await db.saveSetlist(createSetlist({ date: '2099-04-04' }))
      const element = await importer()
      await element.receiveAll([
        { name: 'a', chordproText: chart(unique('Many A')), source: 'paste' },
        { name: 'b', chordproText: chart(unique('Many B')), source: 'paste' },
      ])
      await element.updateComplete
      expect($(element, 'select').textContent).to.contain('2099')
      await element._openNewSetlist()
      const ann = must((await db.getAllPeople()).find(each => each.name === 'Ann Singer'))
      expect(element._newSetlist.leaderId).to.equal(ann.id)
      expect($(element, 'setlist-details-form').getAttribute('submit-label')).to.contain('Songs')
      const url = new Promise<string>(resolve =>
        element.addEventListener(
          SongImportedEvent.type,
          (event: SongImportedEvent) => {
            event.preventDefault()
            resolve(event.url)
          },
          { once: true }
        )
      )
      await element._createSetlist(
        Object.assign(new Event('x'), { details: { date: '2099-05-05', name: 'Made' } })
      )
      expect(await url).to.match(/^\/setlist\//)
    })
  })

  describe('when it is not known which person is the one using the app', () => {
    let auth: ReturnType<typeof installFakeAuthWorker>
    afterEach(() => auth?.uninstall())

    it('asks, and leads the new setlist by the one they say', async () => {
      auth = installFakeAuthWorker()
      auth.worker.stored = {
        blob: 'blob',
        metadata: {
          access_token: 'token',
          expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
          user: {
            picture: null,
            given_name: null,
            family_name: null,
            sub: '1',
            name: 'Dee Question',
            email: 'dee@home.org',
          },
        },
        updated_at: new Date().toISOString(),
      } as never
      const db = await getCurrentDB()
      await db.savePeople([
        {
          id: 'dee-at-work',
          name: 'Dee Question',
          emails: ['dee@work.org'],
          modifiedDate: new Date().toISOString(),
        },
      ])
      const element = await importer()
      await element.receiveAll([
        { name: 'a', chordproText: chart(unique('Ask A')), source: 'paste' },
      ])
      await element._openNewSetlist()
      expect(element._askWho).to.equal(true)
      expect(element._newSetlist.leaderId).to.equal('')

      await element._identify(Object.assign(new Event('x'), { personId: 'dee-at-work' }))

      expect(element._askWho).to.equal(false)
      expect(element._meId).to.equal('dee-at-work')
      expect(element._newSetlist.leaderId).to.equal('dee-at-work')
      // (an answer that is none of the people leaves it as it was)
      await element._identify(Object.assign(new Event('x'), { personId: 'nobody' }))
      expect(element._meId).to.equal('dee-at-work')
      localStorage.removeItem(`chordless:me:${db.spaceId}`)
    })

    it('stays unsure when the answer is none of the people', async () => {
      auth = installFakeAuthWorker()
      auth.worker.stored = {
        blob: 'blob',
        metadata: {
          access_token: 'token',
          expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
          user: {
            picture: null,
            given_name: null,
            family_name: null,
            sub: '1',
            name: 'Eve Question',
            email: 'eve@home.org',
          },
        },
        updated_at: new Date().toISOString(),
      } as never
      const db = await getCurrentDB()
      await db.savePeople([
        {
          id: 'eve-at-work',
          name: 'Eve Question',
          emails: ['eve@work.org'],
          modifiedDate: new Date().toISOString(),
        },
      ])
      const element = await importer()
      await element.receiveAll([
        { name: 'a', chordproText: chart(unique('Eve A')), source: 'paste' },
      ])
      await element._openNewSetlist()
      await element._identify(Object.assign(new Event('x'), { personId: 'nobody' }))
      expect(element._askWho).to.equal(true)
      expect(element._meId).to.equal(null)
      expect(element._newSetlist.leaderId).to.equal('')
    })
  })

  it('goes to the library when several songs were imported to it only', async () => {
    const element = await importer()
    await element.receiveAll([
      { name: 'a', chordproText: chart(unique('Lib A')), source: 'paste' },
      { name: 'b', chordproText: chart(unique('Lib B')), source: 'paste' },
    ])
    const url = new Promise<string>(resolve =>
      element.addEventListener(
        SongImportedEvent.type,
        (event: SongImportedEvent) => {
          event.preventDefault()
          resolve(event.url)
        },
        { once: true }
      )
    )
    element._libraryOnly()
    expect(await url).to.equal('/songs')
  })

  it('shows what went wrong when a song cannot be processed', async () => {
    const element = await importer()
    await element.receive({ chordproText: 5, source: 'paste' })
    expect(element._error).to.contain('Failed to process song')
  })
})
