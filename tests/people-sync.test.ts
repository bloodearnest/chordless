/**
 * The people of a space in sync (docs/IDENTITIES.md): one file each in the space's people
 * collection, pulled before the setlists that name them and pushed before the setlists' own files.
 */
import { expect } from '@open-wc/testing'
import type { Person } from '../src/js/data-types.ts'
import { personHasLocalChanges } from '../src/js/sync/person-hash.ts'
import { useSyncRig } from './drive-harness.ts'
import { must } from './must.ts'
import { suppressConsoleLogs } from './test-helpers.ts'

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
