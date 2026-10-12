import { expect } from '@open-wc/testing'
import { ChordlessDB } from '../src/js/db.ts'
import { ChordProParser } from '../src/js/parser.ts'
import type { RuntimeSong } from '../src/js/setlist/runtime-songs.ts'
import { createSetlistSongModel } from '../src/js/song-model-factory.ts'
import { makeEntry } from './builders.ts'
import { suppressConsoleLogs } from './test-helpers.ts'

const { describe, it } = window

suppressConsoleLogs()

describe('createSetlistSongModel', () => {
  it('makes a model for a song with its own edits, which has no canonical song', () => {
    const parsed = new ChordProParser().parse('{title: Edited}\n{key: D}\n\n[D]Edited words')
    const entry = makeEntry({ songId: 'title-edited', songUuid: 'uuid-edited', key: 'D' })
    const runtimeSong = {
      title: 'Edited',
      parsed,
      songIndex: 0,
      originalKey: 'D',
      currentKey: 'E',
      currentCapo: 0,
      metadata: {},
    } as unknown as RuntimeSong

    const db = new ChordlessDB('unused')
    const model = createSetlistSongModel(runtimeSong, entry, null, 'setlist-1', db, 'org-1')

    expect(model.id).to.equal('title-edited')
    expect(model.uuid).to.equal('uuid-edited')
    expect(model.title).to.equal('Edited')
    expect(model.parsed).to.equal(parsed)
    expect(model.getOriginalKey()).to.equal('D')
    expect(model.getKey()).to.equal('E')
    expect(model.getCapo()).to.equal(0)
  })
})
