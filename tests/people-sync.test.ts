/**
 * The people of a space in sync (docs/IDENTITIES.md): one file each in the space's people
 * collection, pulled before the setlists that name them and pushed before the setlists' own files.
 */
import { expect } from '@open-wc/testing'
import type { Person } from '../src/js/data-types.ts'
import { personHasLocalChanges } from '../src/js/sync/person-hash.ts'
import { useFakeDriveRig, useSyncRig } from './drive-harness.ts'
import { must } from './must.ts'
import { suppressConsoleLogs, TEST_SPACE } from './test-helpers.ts'

const { describe, it } = window

suppressConsoleLogs()

const NOW = '2026-10-29T10:00:00.000Z'
const person = (over: Partial<Person> & { id: string; name: string }): Person => ({
  emails: [],
  modifiedDate: NOW,
  ...over,
})

describe('people in sync (against the memory backend)', () => {
  const rig = useSyncRig()
  const { makeDevice, addSetlist, syncDevice } = rig
  type Device = Awaited<ReturnType<typeof makeDevice>>

  const peopleFiles = () => rig.storage.list(f => Boolean(f.props.personId))
  const stored = async (device: Device, id: string) => must(await device.db.getPerson(id))

  it('uploads a person into the people collection, and records the link', async () => {
    const phone = await makeDevice('phone')
    await phone.db.savePeople([
      person({ id: 'ann', name: 'Ann Smith', emails: ['ann@example.com'] }),
    ])

    await syncDevice(phone)

    const [file] = peopleFiles()
    expect(file.collection).to.equal('people')
    expect(file.props.personId).to.equal('ann')
    expect(file.name).to.match(/^ann-smith-ann\.json$/)
    expect(JSON.parse(file.content)).to.deep.equal(
      person({ id: 'ann', name: 'Ann Smith', emails: ['ann@example.com'] })
    )
    const local = await stored(phone, 'ann')
    expect(local.fileRef).to.equal(file.ref)
    expect(personHasLocalChanges(local)).to.equal(false)
  })

  it('sends nothing again for a person that has not changed', async () => {
    const phone = await makeDevice('phone')
    await phone.db.savePeople([person({ id: 'ann', name: 'Ann' })])
    await syncDevice(phone)
    rig.storage.clearCalls()

    await syncDevice(phone)

    expect(rig.storage.writes()).to.deep.equal([])
  })

  it('brings a person, and the setlist they lead, to another device', async () => {
    const phone = await makeDevice('phone')
    const tablet = await makeDevice('tablet')
    await phone.db.savePeople([person({ id: 'ann', name: 'Ann Smith' })])
    const setlist = await addSetlist(phone, { name: 'Harvest', leaderId: 'ann' })
    await syncDevice(phone)

    await syncDevice(tablet)

    expect((await stored(tablet, 'ann')).name).to.equal('Ann Smith')
    expect(must(await tablet.db.getSetlist(setlist.id)).leaderId).to.equal('ann')
  })

  it('names the setlist’s file by the leader’s name the first time it is sent', async () => {
    const phone = await makeDevice('phone')
    await phone.db.savePeople([person({ id: 'ann', name: 'Ann' })])
    const setlist = await addSetlist(phone, { date: '2026-10-11', leaderId: 'ann' })
    await syncDevice(phone)
    const file = rig.storage.list(f => f.props.setlistId === setlist.id)[0]
    expect(file.name).to.contain('-ann-')
  })

  it('brings a change made on another device', async () => {
    const phone = await makeDevice('phone')
    const tablet = await makeDevice('tablet')
    await phone.db.savePeople([person({ id: 'ann', name: 'Ann' })])
    await syncDevice(phone)
    await syncDevice(tablet)

    const ann = await stored(phone, 'ann')
    await phone.db.savePeople([
      {
        ...ann,
        name: 'Ann Smith',
        emails: ['ann@example.com'],
        modifiedDate: '2026-10-30T10:00:00Z',
      },
    ])
    await syncDevice(phone)
    await syncDevice(tablet)

    const there = await stored(tablet, 'ann')
    expect(there.name).to.equal('Ann Smith')
    expect(there.emails).to.deep.equal(['ann@example.com'])
    expect(peopleFiles()).to.have.length(1)
  })

  it('stores a person two devices made for themselves once, in one file', async () => {
    const phone = await makeDevice('phone')
    const tablet = await makeDevice('tablet')
    await phone.db.savePeople([person({ id: 'same', name: 'Sam', emails: ['sam@example.com'] })])
    await tablet.db.savePeople([person({ id: 'same', name: 'Sam', emails: ['sam@example.com'] })])
    await syncDevice(phone)

    await syncDevice(tablet)

    expect(peopleFiles()).to.have.length(1)
    expect((await stored(tablet, 'same')).fileRef).to.equal(peopleFiles()[0].ref)
  })

  it('keeps the emails of both and the newer name when each device changed the person', async () => {
    const phone = await makeDevice('phone')
    const tablet = await makeDevice('tablet')
    await phone.db.savePeople([person({ id: 'tom', name: 'Tom' })])
    await syncDevice(phone)
    await syncDevice(tablet)

    const onPhone = await stored(phone, 'tom')
    await phone.db.savePeople([
      { ...onPhone, emails: ['tom@home.org'], modifiedDate: '2026-10-30T10:00:00Z' },
    ])
    const onTablet = await stored(tablet, 'tom')
    await tablet.db.savePeople([
      {
        ...onTablet,
        name: 'Tom Smith',
        emails: ['tom@work.org'],
        modifiedDate: '2026-10-31T10:00:00Z',
      },
    ])
    await syncDevice(phone)
    await syncDevice(tablet)
    await syncDevice(phone)

    for (const device of [phone, tablet]) {
      const tom = await stored(device, 'tom')
      expect(tom.name).to.equal('Tom Smith')
      expect([...tom.emails].sort()).to.deep.equal(['tom@home.org', 'tom@work.org'])
      expect(personHasLocalChanges(tom)).to.equal(false)
    }
  })

  it('sends a person again, and does not delete them, when their file is gone from storage', async () => {
    const phone = await makeDevice('phone')
    await phone.db.savePeople([person({ id: 'ann', name: 'Ann' })])
    await syncDevice(phone)
    rig.storage.remove(peopleFiles()[0].ref)

    await syncDevice(phone)

    expect(peopleFiles()).to.have.length(1)
    expect((await stored(phone, 'ann')).fileRef).to.equal(peopleFiles()[0].ref)
  })

  it('ignores a file in the people collection that is not a person’s', async () => {
    const phone = await makeDevice('phone')
    await syncDevice(phone)
    const root = must(rig.storage.rootNamed(TEST_SPACE.name)).ref
    await rig.storage
      .space(root)
      .create('people', { name: 'stray.json', type: 'application/json', props: {} }, '{}')

    await syncDevice(phone)

    expect(await phone.db.getAllPeople()).to.deep.equal([])
  })

  it('skips a person it cannot download, and gets them next sync', async () => {
    const phone = await makeDevice('phone')
    const tablet = await makeDevice('tablet')
    await phone.db.savePeople([person({ id: 'ann', name: 'Ann' })])
    await syncDevice(phone)
    rig.storage.fail('readMany')

    await syncDevice(tablet)
    expect(await tablet.db.getPerson('ann')).to.equal(undefined)

    const messages: string[] = []
    await tablet.sync.sync(progress => messages.push(progress.message))
    expect((await stored(tablet, 'ann')).name).to.equal('Ann')
    expect(messages.join('\n')).to.contain('Downloading 1 people')
  })

  it('sends people one at a time when a batch fails, and says how many went', async () => {
    const phone = await makeDevice('phone')
    await phone.db.savePeople([
      person({ id: 'ann', name: 'Ann' }),
      person({ id: 'ben', name: 'Ben' }),
    ])
    rig.storage.fail('createMany')
    const messages: string[] = []

    await phone.sync.sync(progress => messages.push(progress.message))

    expect(peopleFiles()).to.have.length(2)
    expect(messages.join('\n')).to.contain('Uploaded 2/2 people')

    const ann = await stored(phone, 'ann')
    await phone.db.savePeople([{ ...ann, name: 'Anne', modifiedDate: '2026-10-30T10:00:00Z' }])
    rig.storage.fail('updateMany')
    await syncDevice(phone)
    expect(
      JSON.parse(must(peopleFiles().find(f => f.props.personId === 'ann')).content).name
    ).to.equal('Anne')
  })

  it('takes the newer name when the other device changed the person later than this one did', async () => {
    const phone = await makeDevice('phone')
    const tablet = await makeDevice('tablet')
    await phone.db.savePeople([person({ id: 'tom', name: 'Tom' })])
    await syncDevice(phone)
    await syncDevice(tablet)
    const onPhone = await stored(phone, 'tom')
    await phone.db.savePeople([
      { ...onPhone, name: 'Thomas', modifiedDate: '2026-10-30T10:00:00Z' },
    ])
    const onTablet = await stored(tablet, 'tom')
    await tablet.db.savePeople([
      { ...onTablet, name: 'Tom Smith', emails: ['t@x.org'], modifiedDate: '2026-10-31T10:00:00Z' },
    ])
    await syncDevice(tablet)

    // (the phone has an older change that was never sent: the tablet's later one wins)
    await syncDevice(phone)

    const tom = await stored(phone, 'tom')
    expect(tom.name).to.equal('Tom Smith')
    expect(tom.modifiedDate).to.equal('2026-10-31T10:00:00Z')
  })

  it('records the people that were sent when another in the batch was not', async () => {
    const phone = await makeDevice('phone')
    await phone.db.savePeople([
      person({ id: 'ann', name: 'Ann' }),
      person({ id: 'ben', name: 'Ben' }),
    ])
    rig.storage.fail('create')

    await syncDevice(phone)

    const linked = (await phone.db.getAllPeople()).filter(each => each.fileRef)
    expect(linked).to.have.length(1)
    await syncDevice(phone)
    expect(peopleFiles()).to.have.length(2)
  })

  it('leaves a person it cannot send for the next sync', async () => {
    const phone = await makeDevice('phone')
    await phone.db.savePeople([person({ id: 'ann', name: 'Ann' })])
    rig.storage.fail('createMany')
    rig.storage.fail('create')

    await syncDevice(phone)
    expect(peopleFiles()).to.have.length(0)

    await syncDevice(phone)
    expect(peopleFiles()).to.have.length(1)
  })

  it('waits for a pull that could not read every file before it makes a file', async () => {
    const phone = await makeDevice('phone')
    const tablet = await makeDevice('tablet')
    await phone.db.savePeople([person({ id: 'ann', name: 'Ann' })])
    await syncDevice(phone)
    await tablet.db.savePeople([person({ id: 'ben', name: 'Ben' })])
    rig.storage.fail('readMany')

    await syncDevice(tablet)

    expect(peopleFiles()).to.have.length(1)
    await syncDevice(tablet)
    expect(peopleFiles()).to.have.length(2)
  })

  it('is let go of with the other links when a space is started over, and cleared with a reset', async () => {
    const phone = await makeDevice('phone')
    await phone.db.savePeople([person({ id: 'ann', name: 'Ann' })])
    await syncDevice(phone)

    await phone.db.clearFileLinks()
    const let_go = await stored(phone, 'ann')
    expect(let_go.fileRef).to.equal(null)
    expect(personHasLocalChanges(let_go)).to.equal(true)

    await phone.db.clearSyncedData()
    expect(await phone.db.getAllPeople()).to.deep.equal([])
  })

  it('is picked up by a sync that reads only what changed', async () => {
    const phone = await makeDevice('phone')
    const tablet = await makeDevice('tablet')
    await syncDevice(phone)
    await syncDevice(tablet)
    await tablet.sync.incrementalSync()

    await phone.db.savePeople([person({ id: 'ann', name: 'Ann' })])
    await phone.sync.incrementalSync()
    await tablet.sync.incrementalSync()

    expect((await stored(tablet, 'ann')).name).to.equal('Ann')
  })
})

describe('people in sync (against FakeDrive)', () => {
  const rig = useFakeDriveRig()

  it('keeps people in a people folder, which the feed of changes names', async () => {
    const phone = await rig.makeDevice('phone')
    const tablet = await rig.makeDevice('tablet')
    await rig.syncDevice(phone)
    await rig.syncDevice(tablet)
    await tablet.sync.incrementalSync()

    await phone.db.savePeople([person({ id: 'ann', name: 'Ann Smith' })])
    await phone.sync.incrementalSync()
    await tablet.sync.incrementalSync()

    const files = rig.drive.listFiles(f => Boolean(f.appProperties.personId))
    expect(files).to.have.length(1)
    expect((await must(await tablet.db.getPerson('ann'))).name).to.equal('Ann Smith')
    // and a full sync lists the folder
    await rig.syncDevice(tablet)
    expect(await tablet.db.getAllPeople()).to.have.length(1)
  })
})
