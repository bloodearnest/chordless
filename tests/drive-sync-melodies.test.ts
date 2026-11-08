import { expect } from '@open-wc/testing'
import type { MelodyRecord } from '../src/js/data-types.ts'
import type { Melody, MelodyNote } from '../src/js/melody.ts'
import { writeMusicXml } from '../src/js/melody-musicxml.ts'
import { readMusicXml } from '../src/js/melody-musicxml-read.ts'
import { melodyRecord } from '../src/js/melody-record.ts'
import { readMelodyFile, readMxl } from '../src/js/mxl.ts'
import { midiOf } from '../src/js/pitch.ts'
import { addSong, useSyncRig } from './drive-harness.ts'
import type { MemoryFile } from './memory-storage.ts'
import { must } from './must.ts'
import { suppressConsoleLogs, wait } from './test-helpers.ts'

const { describe, it } = window

suppressConsoleLogs()

/** A melody of one bar of four notes, whose first lyric says which one it is */
function melodyOf(word: string): Melody {
  const note = (step: MelodyNote['step'], start: number, syllable: string): MelodyNote => ({
    kind: 'note',
    id: `${step}${start}`,
    step,
    alter: 0,
    octave: 4,
    midi: midiOf(step, 0, 4),
    start,
    duration: 1,
    tupletRatio: 1,
    tieStart: false,
    tieStop: false,
    cue: false,
    syllables: [syllable],
    withPrevious: false,
  })
  return {
    title: null,
    notice: ['CCLI Song # 1'],
    measures: [
      {
        number: 1,
        voices: [[note('G', 0, word), note('A', 1, 'b'), note('B', 2, 'c'), note('C', 3, 'd')]],
        chords: [{ start: 0, text: 'G' }],
        section: null,
        barline: 'final',
        directions: [],
        repeatStart: false,
        ending: null,
        length: 4,
        full: true,
        fifths: 1,
        beats: 4,
        beatType: 4,
        tempo: null,
      },
    ],
  }
}

/** The first lyric of a melody record: which version of it this is */
const wordOf = (record: MelodyRecord | undefined): string => {
  const first = record && readMusicXml(record.xml)?.measures[0]?.voices[0]?.[0]
  return first?.kind === 'note' ? (first.syllables[0] ?? '') : ''
}

/** A file's bytes as the fake keeps them: one character a byte for a file that was written as bytes */
const bytesOf = (file: MemoryFile): Uint8Array =>
  file.binary
    ? Uint8Array.from(file.content, c => c.charCodeAt(0))
    : new TextEncoder().encode(file.content)

/** The MusicXML a melody file holds, whichever form it is in */
const scoreOf = (file: MemoryFile) => readMelodyFile(bytesOf(file))

describe('Drive sync: melodies', () => {
  const rig = useSyncRig()
  const { makeDevice, syncDevice } = rig

  const melodyFiles = () => rig.storage.list(f => f.props.type === 'melody')

  /** A device with a song and its melody, not yet synced */
  async function deviceWithMelody(name = 'phone', word = 'one') {
    const device = await makeDevice(name)
    await addSong(device, {
      uuid: 'song-1',
      title: 'Amazing Grace',
      content: '{title: Amazing Grace}',
    })
    await device.db.saveMelody(melodyRecord('song-1', writeMusicXml(melodyOf(word)), 'G'))
    return device
  }

  it('uploads a melody as an .mxl beside its chart, linked by its properties', async () => {
    const phone = await deviceWithMelody()
    await syncDevice(phone)

    const [file] = melodyFiles()
    expect(melodyFiles()).to.have.length(1)
    expect(file.name).to.equal('amazing-grace.melody.mxl')
    expect(file.type).to.equal('application/vnd.recordare.musicxml')
    expect(file.props).to.include({
      type: 'melody',
      songUuid: 'song-1',
      key: 'G',
      melodyFormat: '2',
    })
    // (beside the chart's own file, in the songs folder)
    expect(rig.storage.list(f => f.props.type === 'chordpro')).to.have.length(1)
    // (zipped: a few KB, and the score inside is the one that was made)
    expect(file.binary).to.equal(true)
    expect(await readMxl(bytesOf(file))).to.equal(writeMusicXml(melodyOf('one')))
    expect(readMusicXml((await scoreOf(file)) ?? '')?.measures).to.have.length(1)
    const record = must(await phone.db.getMelody('song-1'))
    expect(record.fileRef).to.equal(file.ref)
    expect(record.syncedContentHash).to.equal(record.contentHash)
  })

  it('downloads it on another device, with the key, and does not take it for a song', async () => {
    const phone = await deviceWithMelody()
    const tablet = await makeDevice('tablet')
    await syncDevice(phone)
    await syncDevice(tablet)

    const record = must(await tablet.db.getMelody('song-1'))
    expect(wordOf(record)).to.equal('one')
    expect(record.key).to.equal('G')
    expect(record.fileRef).to.equal(melodyFiles()[0].ref)
    expect(await tablet.db.getAllSongs()).to.have.length(1)
    // (the same melody on both, and nothing to send back)
    expect(readMusicXml(record.xml)?.measures[0]?.chords).to.deep.equal([{ start: 0, text: 'G' }])
    rig.storage.clearCalls()
    await syncDevice(tablet)
    expect(rig.storage.writes()).to.deep.equal([])
  })

  it('updates the file in place when the melody is made again here, and another device follows', async () => {
    const phone = await deviceWithMelody()
    const tablet = await makeDevice('tablet')
    await syncDevice(phone)
    await syncDevice(tablet)
    const ref = melodyFiles()[0].ref

    const before = must(await phone.db.getMelody('song-1'))
    await phone.db.saveMelody(melodyRecord('song-1', writeMusicXml(melodyOf('two')), 'G', before))
    await syncDevice(phone)
    expect(melodyFiles()).to.have.length(1)
    expect(melodyFiles()[0].ref).to.equal(ref)

    await syncDevice(tablet)
    expect(wordOf(await tablet.db.getMelody('song-1'))).to.equal('two')
  })

  it('does not upload a melody that has not changed', async () => {
    const phone = await deviceWithMelody()
    await syncDevice(phone)
    rig.storage.clearCalls()
    await syncDevice(phone)
    expect(rig.storage.writes()).to.deep.equal([])
  })

  it('puts the melody file in the trash with its song, and the other device lets both go', async () => {
    const phone = await deviceWithMelody()
    const tablet = await makeDevice('tablet')
    await syncDevice(phone)
    await syncDevice(tablet)
    const ref = melodyFiles()[0].ref

    await phone.db.deleteSong('song-1')
    expect(await phone.db.getMelody('song-1')).to.equal(undefined)
    await syncDevice(phone)
    expect(melodyFiles()).to.have.length(0)
    expect(rig.storage.file(ref).trashed).to.equal(true)

    await syncDevice(tablet)
    expect(await tablet.db.getSong('song-1')).to.equal(undefined)
    expect(await tablet.db.getMelody('song-1')).to.equal(undefined)
  })

  it('removes a melody whose file was deleted in Drive, if it was not made again here', async () => {
    const phone = await deviceWithMelody()
    const tablet = await makeDevice('tablet')
    await syncDevice(phone)
    await syncDevice(tablet)

    rig.storage.trash(melodyFiles()[0].ref)
    await syncDevice(tablet)
    expect(await tablet.db.getMelody('song-1')).to.equal(undefined)
    // (the song stays: only its notes went)
    expect(await tablet.db.getSong('song-1')).to.not.equal(undefined)
  })

  it('uploads a melody made again here as a new file when its file was deleted in Drive', async () => {
    const phone = await deviceWithMelody()
    await syncDevice(phone)
    const old = melodyFiles()[0].ref
    rig.storage.trash(old)

    const record = must(await phone.db.getMelody('song-1'))
    await phone.db.saveMelody(melodyRecord('song-1', writeMusicXml(melodyOf('three')), 'G', record))
    await syncDevice(phone)

    expect(melodyFiles()).to.have.length(1)
    expect(melodyFiles()[0].ref).to.not.equal(old)
    expect(wordOf(await phone.db.getMelody('song-1'))).to.equal('three')
  })

  it("keeps Drive's version when it changed here and in Drive", async () => {
    const phone = await deviceWithMelody()
    const tablet = await makeDevice('tablet')
    await syncDevice(phone)
    await syncDevice(tablet)

    await phone.db.saveMelody(
      melodyRecord(
        'song-1',
        writeMusicXml(melodyOf('phone')),
        'G',
        must(await phone.db.getMelody('song-1'))
      )
    )
    await tablet.db.saveMelody(
      melodyRecord(
        'song-1',
        writeMusicXml(melodyOf('tablet')),
        'G',
        must(await tablet.db.getMelody('song-1'))
      )
    )
    await syncDevice(phone)
    await syncDevice(tablet)

    expect(wordOf(await tablet.db.getMelody('song-1'))).to.equal('phone')
    expect(wordOf(await phone.db.getMelody('song-1'))).to.equal('phone')
  })

  it('leaves a file that is not MusicXML alone, and tries it again at the next sync', async () => {
    const phone = await deviceWithMelody()
    await syncDevice(phone)
    const [file] = melodyFiles()
    rig.storage.edit(file.ref, 'this is not music')

    const tablet = await makeDevice('tablet')
    await syncDevice(tablet)
    expect(await tablet.db.getMelody('song-1')).to.equal(undefined)
    expect(await tablet.db.getSong('song-1')).to.not.equal(undefined)
  })

  it('removes the melody of a song the chart of which was deleted in Drive, and trashes its file', async () => {
    const phone = await deviceWithMelody()
    const tablet = await makeDevice('tablet')
    await syncDevice(phone)
    await syncDevice(tablet)

    // the chart's own file goes, and the melody's stays
    rig.storage.trash(rig.storage.list(f => f.props.type === 'chordpro')[0].ref)
    await syncDevice(tablet)
    expect(await tablet.db.getSong('song-1')).to.equal(undefined)
    expect(await tablet.db.getMelody('song-1')).to.equal(undefined)
    await syncDevice(tablet)
    expect(melodyFiles()).to.have.length(0)
  })

  it('does not keep the melody of a song a new device never had, and trashes its file', async () => {
    const phone = await deviceWithMelody()
    await syncDevice(phone)
    // the chart's own file goes, and the melody's stays, before this device has seen either
    rig.storage.trash(rig.storage.list(f => f.props.type === 'chordpro')[0].ref)

    const watch = await makeDevice('watch')
    await syncDevice(watch)
    expect(await watch.db.getMelody('song-1')).to.equal(undefined)
    await syncDevice(watch)
    expect(melodyFiles()).to.have.length(0)
  })

  it('keeps a melody a read-only user made here when the leader changed it too, and says so', async () => {
    const leader = await deviceWithMelody('leader')
    await syncDevice(leader)
    const member = await makeDevice('member')
    await syncDevice(member)

    rig.storage.readOnly = true
    await member.db.saveMelody(
      melodyRecord(
        'song-1',
        writeMusicXml(melodyOf('mine')),
        'G',
        must(await member.db.getMelody('song-1'))
      )
    )
    rig.storage.readOnly = false
    await leader.db.saveMelody(
      melodyRecord(
        'song-1',
        writeMusicXml(melodyOf('theirs')),
        'G',
        must(await leader.db.getMelody('song-1'))
      )
    )
    await syncDevice(leader)
    rig.storage.readOnly = true
    const report = await member.sync.sync()

    expect(wordOf(await member.db.getMelody('song-1'))).to.equal('mine')
    expect(report.heldBack).to.equal(1)
  })

  it('tells how many melodies it uploads and downloads', async () => {
    const phone = await deviceWithMelody()
    const said: string[] = []
    await phone.sync.sync(progress => said.push(progress.message))
    expect(said.some(message => message.includes('Uploaded 1/1 melodies'))).to.equal(true)

    const tablet = await makeDevice('tablet')
    const heard: string[] = []
    await tablet.sync.sync(progress => heard.push(progress.message))
    expect(heard.some(message => message.includes('Downloaded 1/1 melodies'))).to.equal(true)
  })

  it('tries a melody it could not read again at the next sync, and reports the failure', async () => {
    const phone = await deviceWithMelody()
    await syncDevice(phone)
    const tablet = await makeDevice('tablet')
    rig.storage.fail('readBytes', { on: melodyFiles()[0].ref })

    const report = await syncDevice(tablet)
    expect(report.downloadsFailed).to.equal(true)
    expect(await tablet.db.getMelody('song-1')).to.equal(undefined)

    await syncDevice(tablet)
    expect(wordOf(await tablet.db.getMelody('song-1'))).to.equal('one')
  })

  it('uploads a melody on its own when its batch fails, and again at the next sync if that fails too', async () => {
    const phone = await deviceWithMelody()
    rig.storage.fail('create', { skip: 1 })
    await syncDevice(phone)
    expect(melodyFiles()).to.have.length(0)
    expect(must(await phone.db.getMelody('song-1')).fileRef ?? null).to.equal(null)

    await syncDevice(phone)
    expect(melodyFiles()).to.have.length(1)
  })

  it('leaves a melody whose update failed as changed, and sends it at the next sync', async () => {
    const phone = await deviceWithMelody()
    await syncDevice(phone)
    await phone.db.saveMelody(
      melodyRecord(
        'song-1',
        writeMusicXml(melodyOf('next')),
        'G',
        must(await phone.db.getMelody('song-1'))
      )
    )
    rig.storage.fail('update')
    await syncDevice(phone)
    expect(await scoreOf(melodyFiles()[0])).to.equal(writeMusicXml(melodyOf('one')))

    await syncDevice(phone)
    expect(await scoreOf(melodyFiles()[0])).to.equal(writeMusicXml(melodyOf('next')))
  })

  it('lets go of a melody file the feed names as gone, when the melody was made again here', async () => {
    const phone = await deviceWithMelody()
    await syncDevice(phone)
    await phone.sync.incrementalSync()
    const ref = melodyFiles()[0].ref
    rig.storage.trash(ref)
    await phone.db.saveMelody(
      melodyRecord(
        'song-1',
        writeMusicXml(melodyOf('again')),
        'G',
        must(await phone.db.getMelody('song-1'))
      )
    )

    await phone.sync.incrementalSync()
    expect(melodyFiles()).to.have.length(1)
    expect(melodyFiles()[0].ref).to.not.equal(ref)
  })

  it('is cleared of its links when the space is linked to another folder', async () => {
    const phone = await deviceWithMelody()
    await syncDevice(phone)
    await phone.db.clearFileLinks()
    expect(must(await phone.db.getMelody('song-1')).fileRef ?? null).to.equal(null)
  })

  it('does not bring back a melody whose file could not be put in the trash yet', async () => {
    const phone = await deviceWithMelody()
    await syncDevice(phone)
    await phone.db.deleteSong('song-1')
    rig.storage.fail('trash', { times: 5 })
    await syncDevice(phone)
    expect(melodyFiles()).to.have.length(1)
    expect(await phone.db.getMelody('song-1')).to.equal(undefined)

    rig.storage.clearFailures()
    await syncDevice(phone)
    expect(melodyFiles()).to.have.length(0)
  })

  it('takes the newer file when Drive has two melodies for a song, and ignores one linked to no song', async () => {
    const phone = await deviceWithMelody()
    await syncDevice(phone)
    const original = melodyFiles()[0]
    rig.storage.copyFile(original.ref, { ref: 'copy-1', props: { ...original.props } })
    await wait(5)
    rig.storage.edit('copy-1', writeMusicXml(melodyOf('newer')))
    rig.storage.copyFile(original.ref, { ref: 'loose-1', props: { type: 'melody' } })

    const tablet = await makeDevice('tablet')
    await syncDevice(tablet)
    expect(wordOf(await tablet.db.getMelody('song-1'))).to.equal('newer')
    expect(await tablet.db.getAllMelodies()).to.have.length(1)
  })

  it('records the checksum of a file it already has, and keeps what was made here', async () => {
    const phone = await deviceWithMelody()
    await syncDevice(phone)
    // (a record from before the file's checksum was kept)
    const record = must(await phone.db.getMelody('song-1'))
    await phone.db.saveMelody({ ...record, fileRev: null })
    await syncDevice(phone)
    expect(must(await phone.db.getMelody('song-1')).fileRev).to.equal(melodyFiles()[0].rev)
  })

  it('uploads each melody on its own when the batch fails (in a space that holds text only)', async () => {
    rig.storage.bytes = false
    const phone = await deviceWithMelody()
    // (the chart's batch goes through first: the second call to createMany is the melodies')
    rig.storage.fail('createMany', { skip: 1 })
    await syncDevice(phone)
    expect(melodyFiles()).to.have.length(1)
  })

  it('updates each melody on its own when the batch of updates fails (in a space that holds text only)', async () => {
    rig.storage.bytes = false
    const phone = await deviceWithMelody()
    await syncDevice(phone)
    await phone.db.saveMelody(
      melodyRecord(
        'song-1',
        writeMusicXml(melodyOf('single')),
        'G',
        must(await phone.db.getMelody('song-1'))
      )
    )
    rig.storage.fail('updateMany')
    await syncDevice(phone)
    expect(await scoreOf(melodyFiles()[0])).to.equal(writeMusicXml(melodyOf('single')))
  })

  it('leaves the melody of a song that is not here alone, and lists it among the unsent changes', async () => {
    const phone = await makeDevice('phone')
    await phone.db.saveMelody(melodyRecord('ghost', writeMusicXml(melodyOf('boo')), null))
    expect((await phone.sync.findUnsyncedChanges()).filter(c => c.type === 'melody')).to.deep.equal(
      [{ type: 'melody', id: 'ghost', label: '' }]
    )
    await phone.sync.pushToDrive()
    expect(melodyFiles()).to.have.length(0)
  })

  it('comes down by the feed of changes, without listing the space', async () => {
    const phone = await deviceWithMelody()
    const tablet = await makeDevice('tablet')
    await syncDevice(phone)
    await syncDevice(tablet)

    await phone.db.saveMelody(
      melodyRecord(
        'song-1',
        writeMusicXml(melodyOf('feed')),
        'G',
        must(await phone.db.getMelody('song-1'))
      )
    )
    await phone.sync.incrementalSync()
    rig.storage.clearCalls()
    const report = await tablet.sync.incrementalSync()

    expect(report.full).to.equal(false)
    expect(wordOf(await tablet.db.getMelody('song-1'))).to.equal('feed')
    expect(rig.storage.calls.filter(call => call.op === 'list')).to.deep.equal([])
  })

  it('lists a melody made here and not sent among the changes a reset would lose', async () => {
    const phone = await deviceWithMelody()
    const unsynced = await phone.sync.findUnsyncedChanges()
    expect(unsynced.filter(change => change.type === 'melody')).to.deep.equal([
      { type: 'melody', id: 'song-1', label: 'Amazing Grace' },
    ])
    await syncDevice(phone)
    expect((await phone.sync.findUnsyncedChanges()).filter(c => c.type === 'melody')).to.deep.equal(
      []
    )
  })

  it('is brought back from Drive by a reset', async () => {
    const phone = await deviceWithMelody()
    await syncDevice(phone)
    await phone.sync.resetLocalFromDrive()
    expect(wordOf(await phone.db.getMelody('song-1'))).to.equal('one')
  })

  it('compresses the file: the score is far larger than what is in Drive', async () => {
    const phone = await deviceWithMelody()
    await syncDevice(phone)
    const [file] = melodyFiles()
    const score = writeMusicXml(melodyOf('one'))
    expect(bytesOf(file).length).to.be.lessThan(score.length)
  })

  describe('in a space that holds text only', () => {
    it('keeps the plain MusicXML, as the first version did, and another device reads it', async () => {
      rig.storage.bytes = false
      const phone = await deviceWithMelody()
      await syncDevice(phone)
      const [file] = melodyFiles()
      expect(file.name).to.equal('amazing-grace.melody.musicxml')
      expect(file.props.melodyFormat).to.equal('1')
      expect(file.binary).to.equal(false)
      expect(file.content).to.equal(writeMusicXml(melodyOf('one')))

      const tablet = await makeDevice('tablet')
      await syncDevice(tablet)
      expect(wordOf(await tablet.db.getMelody('song-1'))).to.equal('one')
    })
  })

  it('reads a plain MusicXML file, and writes it as an .mxl when the melody changes here', async () => {
    rig.storage.bytes = false
    const phone = await deviceWithMelody()
    await syncDevice(phone)
    const ref = melodyFiles()[0].ref

    rig.storage.bytes = true
    const tablet = await makeDevice('tablet')
    await syncDevice(tablet)
    expect(wordOf(await tablet.db.getMelody('song-1'))).to.equal('one')
    // (nothing to send back: it is the same score)
    rig.storage.clearCalls()
    await syncDevice(tablet)
    expect(rig.storage.writes()).to.deep.equal([])

    await tablet.db.saveMelody(
      melodyRecord(
        'song-1',
        writeMusicXml(melodyOf('two')),
        'G',
        must(await tablet.db.getMelody('song-1'))
      )
    )
    await syncDevice(tablet)
    const [file] = melodyFiles()
    expect(file.ref).to.equal(ref)
    expect(file.name).to.equal('amazing-grace.melody.mxl')
    expect(file.props.melodyFormat).to.equal('2')
    expect(await scoreOf(file)).to.equal(writeMusicXml(melodyOf('two')))
  })

  it('does not send a melody again because another device zipped the same score differently', async () => {
    const phone = await deviceWithMelody()
    await syncDevice(phone)
    const [file] = melodyFiles()
    // the same score as plain text, which is not the same bytes (as another deflate would make): another checksum
    rig.storage.edit(file.ref, writeMusicXml(melodyOf('one')))

    rig.storage.clearCalls()
    await syncDevice(phone)
    expect(rig.storage.writes()).to.deep.equal([])
    expect(wordOf(await phone.db.getMelody('song-1'))).to.equal('one')
    expect(must(await phone.db.getMelody('song-1')).fileRev).to.equal(melodyFiles()[0].rev)
  })

  it('leaves a zip it cannot read alone, as it leaves any file that is not MusicXML', async () => {
    const phone = await deviceWithMelody()
    await syncDevice(phone)
    rig.storage.edit(melodyFiles()[0].ref, 'PK this begins like a zip and is not one')

    const tablet = await makeDevice('tablet')
    await syncDevice(tablet)
    expect(await tablet.db.getMelody('song-1')).to.equal(undefined)
  })

  it('takes the newer of two files for a song whichever is listed first', async () => {
    const phone = await deviceWithMelody()
    await syncDevice(phone)
    const original = melodyFiles()[0]
    rig.storage.copyFile(original.ref, { ref: 'copy-2', props: { ...original.props } })
    await wait(5)
    // (the original is edited last, so the copy listed after it is the older)
    rig.storage.edit(original.ref, writeMusicXml(melodyOf('latest')))

    const tablet = await makeDevice('tablet')
    await syncDevice(tablet)
    expect(wordOf(await tablet.db.getMelody('song-1'))).to.equal('latest')
  })

  it('keeps the key it had when the file in Drive names none, and has none if it never had one', async () => {
    const phone = await deviceWithMelody()
    await syncDevice(phone)
    const tablet = await makeDevice('tablet')
    await syncDevice(tablet)
    const original = melodyFiles()[0]
    rig.storage.copyFile(original.ref, { ref: 'copy-3', props: { ...original.props, key: '' } })
    await wait(5)
    rig.storage.edit('copy-3', writeMusicXml(melodyOf('keyless')))
    await syncDevice(tablet)
    expect(wordOf(await tablet.db.getMelody('song-1'))).to.equal('keyless')
    expect((await tablet.db.getMelody('song-1'))?.key).to.equal('G')

    const watch = await makeDevice('watch')
    await syncDevice(watch)
    expect((await watch.db.getMelody('song-1'))?.key).to.equal(null)
  })

  describe('in a space that holds text only (updates)', () => {
    it('updates the plain file in place, a batch at a time', async () => {
      rig.storage.bytes = false
      const phone = await deviceWithMelody()
      await syncDevice(phone)
      const ref = melodyFiles()[0].ref
      await phone.db.saveMelody(
        melodyRecord(
          'song-1',
          writeMusicXml(melodyOf('edited')),
          'G',
          must(await phone.db.getMelody('song-1'))
        )
      )
      await syncDevice(phone)
      expect(melodyFiles()).to.have.length(1)
      expect(melodyFiles()[0].ref).to.equal(ref)
      expect(melodyFiles()[0].content).to.equal(writeMusicXml(melodyOf('edited')))
    })
  })
})
