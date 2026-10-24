/**
 * The setlist page when a sync saves its setlist while it is showing it: it follows the new
 * version, on the song being viewed, and says what changed (docs/SYNC_ARCHITECTURE.md).
 */
import { expect } from '@open-wc/testing'
import { announceDataChange, type DataChange, DataChangeEvent } from '../src/js/data-changes.ts'
import { loadSetlistLocalState } from '../src/js/setlist/local-state.ts'
import { makeEntry } from './builders.ts'
import { must, useSetlistPage } from './setlist-page-harness.ts'
import { clearToasts, shownToast, wait } from './test-helpers.ts'

const { describe, it, afterEach } = window

describe('the setlist page: a sync saves its setlist', () => {
  const rig = useSetlistPage()
  afterEach(() => clearToasts())

  /** The setlist as saved now, with its songs replaced by those (in order) */
  async function savedWith(id: string, songs: { id: string; uuid: string }[]) {
    const setlist = must(await rig.db.getSetlist(id))
    setlist.songs = songs.map((song, order) =>
      makeEntry({ order, songId: song.id, songUuid: song.uuid, key: 'G', tempo: 90 })
    )
    await rig.db.saveSetlist(setlist)
    return setlist
  }

  /** Where the page moved to when it followed a sync (the first move: its section observer moves it on in a test, as nothing is laid out) */
  let movedTo: number | undefined

  /** Tell the page, and give it time to show the new version */
  async function pulled(ids: string[] | null, fields: Partial<DataChange> = {}) {
    movedTo = undefined
    const navigateTo = rig.page.navigateTo.bind(rig.page)
    rig.page.navigateTo = (index, options) => {
      movedTo ??= index
      return navigateTo(index, options)
    }
    window.dispatchEvent(
      new DataChangeEvent({
        spaceId: rig.db.spaceId,
        kind: 'setlist',
        ids,
        origin: 'sync',
        remote: false,
        ...fields,
      })
    )
    await wait(100)
    await rig.flush()
  }

  const song = (index: number) => rig.songs[index]

  it('shows a song added elsewhere, stays on the song being viewed, and says what came in', async () => {
    const setlist = await rig.open(3, {}, { songIndex: 1 })

    await savedWith(setlist.id, [song(3), song(0), song(1), song(2)])
    await pulled([setlist.id])

    expect(rig.page.songs).to.have.length(4)
    expect(movedTo).to.equal(2)
    expect(rig.page.songs[2].title).to.equal('Bravo')
    expect(rig.visited.some(visit => visit.replace && visit.url.includes('/song/2'))).to.equal(true)
    expect(shownToast()?.message).to.contain('+ Delta')
  })

  it('keeps what this device set for a song with the song when the setlist is reordered elsewhere', async () => {
    const setlist = await rig.open(3, {}, { songIndex: 1 })
    const hidden = { hideMode: 'chords' as const, isCollapsed: false, isHidden: false }
    rig.page.sections.states = { 1: { 0: hidden }, 2: { 0: hidden } }

    // Bravo (1) is now last, and Charlie (2) is gone
    await savedWith(setlist.id, [song(3), song(0), song(1)])
    await pulled([setlist.id])

    expect(
      loadSetlistLocalState(setlist.id, must(rig.page.currentSetlist).songs).sectionState
    ).to.deep.equal({ 2: { 0: hidden } })
    expect(rig.page.sections.states).to.deep.equal({ 2: { 0: hidden } })
  })

  it('goes to the overview when the song being viewed is no longer in the setlist', async () => {
    const setlist = await rig.open(3, {}, { songIndex: 1 })

    await savedWith(setlist.id, [song(0), song(2)])
    await pulled([setlist.id])

    expect(rig.page.songs).to.have.length(2)
    expect(movedTo).to.equal(-1)
    expect(shownToast()?.message).to.contain('− Bravo')
  })

  it('stays on the overview when that is where it was', async () => {
    const setlist = await rig.open(2)
    await savedWith(setlist.id, [song(0), song(1), song(2)])
    await pulled([setlist.id])

    expect(rig.page.songs).to.have.length(3)
    expect(movedTo).to.equal(-1)
  })

  it('works on the new version from then on, so a later save does not undo it', async () => {
    const setlist = await rig.open(2)
    await savedWith(setlist.id, [song(0), song(1), song(2)])
    await pulled([setlist.id])

    expect(must(rig.page.currentSetlist).songs).to.have.length(3)
  })

  it('shows nothing when only what sync keeps of the file changed, and carries it', async () => {
    const setlist = await rig.open(2)
    const shown = rig.page.songs
    const latest = must(await rig.db.getSetlist(setlist.id))
    await rig.db.saveSetlist({ ...latest, fileRev: 'a-new-checksum' })

    await pulled([setlist.id])

    expect(rig.page.songs).to.equal(shown)
    expect(must(rig.page.currentSetlist).fileRev).to.equal('a-new-checksum')
    expect(shownToast()).to.equal(null)
  })

  it('says only that it was updated when nothing it can describe changed', async () => {
    const setlist = await rig.open(2)
    const latest = must(await rig.db.getSetlist(setlist.id))
    const entry = { ...latest.songs[0], notes: 'repeat the chorus' }
    await rig.db.saveSetlist({ ...latest, songs: [entry, latest.songs[1]] })

    await pulled([setlist.id])

    expect(shownToast()?.message).to.match(/was updated$/)
  })

  it('follows another tab’s edit as it follows a sync’s, but not the page’s own save, nor another space’s', async () => {
    const setlist = await rig.open(2)
    const shown = rig.page.songs
    await savedWith(setlist.id, [song(0), song(1), song(2)])

    await pulled([setlist.id], { origin: 'local' })
    expect(rig.page.songs).to.equal(shown)
    await pulled([setlist.id], { spaceId: 'another-space' })
    expect(rig.page.songs).to.equal(shown)

    await pulled([setlist.id], { origin: 'local', remote: true })
    expect(rig.page.songs).to.have.length(3)
  })

  it('follows a change of all the setlists, as a reset from Drive makes', async () => {
    const setlist = await rig.open(2)
    await savedWith(setlist.id, [song(0), song(1), song(2)])
    await pulled([])
    expect(rig.page.songs).to.have.length(2)
    await pulled(null)
    expect(rig.page.songs).to.have.length(3)
  })

  it('ignores a sync of other setlists', async () => {
    const setlist = await rig.open(2)
    const shown = rig.page.songs
    await savedWith(setlist.id, [song(0), song(1), song(2)])

    await pulled(['another-setlist'])

    expect(rig.page.songs).to.equal(shown)
  })

  it('does nothing when the setlist is gone, or the page has been left', async () => {
    const setlist = await rig.open(2)
    const shown = rig.page.songs
    await rig.db.deleteSetlist(setlist.id)
    await pulled([setlist.id])
    expect(rig.page.songs).to.equal(shown)

    const other = await rig.open(2)
    await savedWith(other.id, [song(0), song(1), song(2)])
    const left = rig.page.songs
    rig.page.dispose()
    await pulled([other.id])
    expect(rig.page.songs).to.equal(left)
  })

  it('does nothing before it has shown a setlist, and does not move on when it was left while showing the new one', async () => {
    const { SetlistPage } = await import('../src/js/setlist-page.ts')
    const bare = new SetlistPage({ root: rig.root, setlistId: 'none', db: rig.db })
    await bare.applyChangedSetlist()
    expect(bare.currentSetlist).to.equal(undefined)

    const setlist = await rig.open(2)
    await savedWith(setlist.id, [song(0), song(1), song(2)])
    rig.page.renderSetlist = async () => {
      rig.page.dispose()
    }
    await pulled([setlist.id])
    expect(movedTo).to.equal(undefined)
  })

  it('hears of a sync through the announcement the sync makes', async () => {
    const setlist = await rig.open(2)
    await savedWith(setlist.id, [song(0), song(1), song(2)])

    announceDataChange({
      spaceId: rig.db.spaceId,
      kind: 'setlist',
      ids: [setlist.id],
      origin: 'sync',
    })
    await wait(100)
    await rig.flush()

    expect(rig.page.songs).to.have.length(3)
  })
})
