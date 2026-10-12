import { expect } from '@open-wc/testing'
import { IncomingSongsEvent, offerIncoming, takeIncoming } from '../src/js/incoming-songs.ts'
import { handleLaunch } from '../src/js/launch.ts'
import { SHARED_CACHE_NAME, storeShared, takeShared } from '../src/js/shared-incoming.ts'

const { describe, it, beforeEach, afterEach } = window

const chart = '{title: Amazing Grace}\n[G]Amazing grace'

describe('what is shared to the app', () => {
  beforeEach(() => caches.delete(SHARED_CACHE_NAME))
  afterEach(() => caches.delete(SHARED_CACHE_NAME))

  it('keeps shared files and text until taken, and only once', async () => {
    const form = new FormData()
    form.append('files', new File([chart], 'Amazing Grace.cho', { type: 'text/plain' }))
    form.append('files', new File(['{title: Two}'], 'Der Herr ist mein Hirte – 2.chordpro'))
    form.append('text', '{title: Pasted}\n[C]Words')
    form.append('title', 'ignored')
    await storeShared(form)

    const shared = await takeShared()
    expect(shared?.files.map(file => file.name)).to.deep.equal([
      'Amazing Grace.cho',
      'Der Herr ist mein Hirte – 2.chordpro',
    ])
    expect(await shared?.files[0].text()).to.equal(chart)
    expect(shared?.text).to.equal('{title: Pasted}\n[C]Words')

    expect(await takeShared()).to.equal(null)
    expect(await caches.has(SHARED_CACHE_NAME)).to.equal(false)
  })

  it('has nothing when nothing was shared, or only an empty text', async () => {
    expect(await takeShared()).to.equal(null)
    const form = new FormData()
    form.append('text', '   ')
    await storeShared(form)
    expect(await takeShared()).to.equal(null)
  })

  it('keeps only the latest share', async () => {
    const first = new FormData()
    first.append('text', 'first')
    await storeShared(first)
    const second = new FormData()
    second.append('text', 'second')
    await storeShared(second)
    expect((await takeShared())?.text).to.equal('second')
  })
})

describe('songs offered to the import page', () => {
  afterEach(() => caches.delete(SHARED_CACHE_NAME))

  it('are taken once, and the page is told when they are offered', async () => {
    let told = 0
    const listener = () => told++
    window.addEventListener(IncomingSongsEvent.type, listener)
    offerIncoming({ files: [], text: 'hello' })
    window.removeEventListener(IncomingSongsEvent.type, listener)
    expect(told).to.equal(1)

    expect((await takeIncoming())?.text).to.equal('hello')
    expect(await takeIncoming()).to.equal(null)
  })

  it('come from a share when none were offered', async () => {
    const form = new FormData()
    form.append('text', 'shared words')
    await storeShared(form)
    expect((await takeIncoming())?.text).to.equal('shared words')
  })
})

describe('launching the installed app', () => {
  afterEach(() => caches.delete(SHARED_CACHE_NAME))

  it('offers the files it was opened with to the import page', async () => {
    const wentTo: string[] = []
    const file = new File([chart], 'Amazing Grace.cho')
    await handleLaunch({ files: [{ getFile: async () => file }] }, async url => {
      wentTo.push(url)
    })
    expect(wentTo).to.deep.equal(['/import-song'])
    const incoming = await takeIncoming()
    expect(incoming?.files).to.deep.equal([file])
  })

  it('goes to the link or shortcut for the open window, unless it is already there', async () => {
    const wentTo: string[] = []
    const go = async (url: string) => {
      wentTo.push(url)
    }
    await handleLaunch({ targetURL: `${location.origin}/songs?q=grace` }, go)
    expect(wentTo).to.deep.equal(['/songs?q=grace'])

    wentTo.length = 0
    await handleLaunch({ targetURL: location.href }, go)
    await handleLaunch({ targetURL: 'https://elsewhere.example/songs' }, go)
    expect(wentTo).to.deep.equal([])
  })
})
