import { expect } from '@open-wc/testing'
import '../src/components/app-modal.js'
import { getCurrentDB } from '../src/js/db.js'
import { AddSongModal } from '../src/js/setlist/add-song-modal.js'
import { createSong } from '../src/js/song-utils.js'
import { suppressConsoleLogs } from './test-helpers.js'

const { describe, it, beforeEach, afterEach } = window

const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const stamp = crypto.randomUUID().slice(0, 8)
const chart = title => `{title: ${title}}\n{key: G}\n\n[G]Amazing [C]grace`

describe('AddSongModal', () => {
  let root
  let picked
  let modal
  let db

  const modalElement = () => root.querySelector('#add-song-modal')
  const results = () => root.querySelector('#add-song-results')
  const listed = () =>
    [...(results().querySelector('song-list')?.songs ?? [])].map(song => song.title)
  const type = async text => {
    const input = root.querySelector('#add-song-search-input')
    input.value = text
    input.dispatchEvent(new Event('input'))
  }

  suppressConsoleLogs()

  beforeEach(async () => {
    db = await getCurrentDB()
    root = document.createElement('div')
    root.innerHTML = `
      <app-modal id="add-song-modal" size="fullscreen">
        <div slot="header"><input id="add-song-search-input" type="text" /></div>
        <div id="add-song-results"></div>
      </app-modal>`
    document.body.append(root)
    picked = []
    modal = new AddSongModal({ root, getDb: () => db, onPick: song => picked.push(song) })
  })

  afterEach(() => root.remove())

  it('shows the library to choose from, in an open modal', async () => {
    await createSong(chart(`Beta ${stamp}`))
    await createSong(chart(`Alpha ${stamp}`))
    await modal.open()
    await modalElement().updateComplete
    expect(modalElement().hasAttribute('open')).to.equal(true)
    const mine = listed().filter(title => title.endsWith(stamp))
    expect(mine).to.deep.equal([`Alpha ${stamp}`, `Beta ${stamp}`])
  })

  it('narrows the list as you type, and shows it all again when cleared', async () => {
    await createSong(chart(`Findable ${stamp}`))
    await createSong(chart(`Other ${stamp}`))
    await modal.open()
    const all = listed().length

    await type(`findable ${stamp}`)
    expect(listed()).to.deep.equal([`Findable ${stamp}`])
    await type('')
    expect(listed()).to.have.length(all)
  })

  it('says so when nothing matches', async () => {
    await createSong(chart(`Something ${stamp}`))
    await modal.open()
    await type('zzzz-no-such-song')
    expect(listed()).to.deep.equal([])
  })

  it('tells the owner which song was chosen', async () => {
    const song = await createSong(chart(`Pick me ${stamp}`))
    await modal.open()
    const list = results().querySelector('song-list')
    const chosen = list.songs.find(candidate => candidate.id === song.id)
    list.dispatchEvent(
      Object.assign(new Event('song-list:select', { bubbles: true, composed: true }), {
        song: chosen,
      })
    )
    expect(picked).to.have.length(1)
    expect(picked[0].id).to.equal(song.id)
  })

  it('closes when asked, and stops filtering', async () => {
    await createSong(chart(`Closing ${stamp}`))
    await modal.open()
    modal.close()
    await wait(0)
    await modalElement().updateComplete
    expect(modalElement().hasAttribute('open')).to.equal(false)

    // Typing now changes nothing
    const before = listed()
    await type('zzzz')
    expect(listed()).to.deep.equal(before)
  })

  it('starts with a clear search each time it opens', async () => {
    await createSong(chart(`Again ${stamp}`))
    await modal.open()
    await type('again')
    modal.close()
    await wait(0)
    await modal.open()
    expect(root.querySelector('#add-song-search-input').value).to.equal('')
  })

  it('opens, with a message, when the library is empty', async () => {
    const emptyDb = { getAllSongs: async () => [] }
    modal = new AddSongModal({ root, getDb: () => emptyDb, onPick: () => {} })
    await modal.open()
    await modalElement().updateComplete
    expect(modalElement().hasAttribute('open')).to.equal(true)
    expect(results().querySelector('status-message').state).to.equal('empty')
  })

  it('opens, with an error, when the library cannot be loaded', async () => {
    const originalError = console.error
    console.error = () => undefined
    try {
      const brokenDb = {
        getAllSongs: async () => {
          throw new Error('no database')
        },
      }
      modal = new AddSongModal({ root, getDb: () => brokenDb, onPick: () => {} })
      await modal.open()
    } finally {
      console.error = originalError
    }
    await modalElement().updateComplete
    expect(modalElement().hasAttribute('open')).to.equal(true)
    expect(results().querySelector('status-message').state).to.equal('error')
  })
})
