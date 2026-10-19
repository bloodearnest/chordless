import { expect } from '@open-wc/testing'
import { addSong, editSong, useSyncRig } from './drive-harness.ts'
import { must } from './must.ts'
import { suppressConsoleLogs, TEST_ORG } from './test-helpers.ts'

const { describe, it } = window

suppressConsoleLogs()

describe('Drive sync: organisations', () => {
  const rig = useSyncRig()
  const {
    makeDevice,
    renameOrganisation,
    addSetlist,
    editSetlist,
    syncDevice,
    driveSetlistFiles,
    driveSetlist,
  } = rig

  describe('organisations', () => {
    const orgFolders = () =>
      [...rig.drive.files.values()].filter(
        f => f.parents.includes(rig.drive.findByPath(['Chordless']).id) && !f.trashed
      )

    it('keeps syncing the same Drive folder after a rename, and renames it', async () => {
      const phone = await makeDevice('phone', { orgName: 'Personal' })
      const setlist = await addSetlist(phone, { name: 'Harvest' })
      await syncDevice(phone)
      const folderId = rig.drive.findByPath(['Chordless', 'Personal']).id

      await renameOrganisation(phone, 'Simon Davy')
      await editSetlist(phone, setlist.id, { name: 'Harvest edited' })
      await syncDevice(phone)

      expect(orgFolders().map(f => f.name)).to.deep.equal(['Simon Davy'])
      expect(rig.drive.findByPath(['Chordless', 'Simon Davy']).id).to.equal(folderId)
      expect(driveSetlist(setlist.id).name).to.equal('Harvest edited')
    })

    it('keeps the linked folder, without renaming it, if the new name is taken', async () => {
      const phone = await makeDevice('phone', { orgName: 'Personal' })
      const setlist = await addSetlist(phone, { name: 'Harvest' })
      await syncDevice(phone)
      await makeDevice('tablet', { orgName: 'Simon Davy' }) // creates that folder

      await renameOrganisation(phone, 'Simon Davy')
      await editSetlist(phone, setlist.id, { name: 'Harvest edited' })
      await syncDevice(phone)

      expect(
        orgFolders()
          .map(f => f.name)
          .sort()
      ).to.deep.equal(['Personal', 'Simon Davy'])
      expect(driveSetlist(setlist.id).name).to.equal('Harvest edited')
    })

    it('joins an existing folder with the new name if nothing was synced yet', async () => {
      // e.g. a new browser syncs while still "Personal", then is renamed to the
      // Google account's name, which another device already syncs with
      const tablet = await makeDevice('tablet', { orgName: 'Simon Davy' })
      const theirs = await addSetlist(tablet, { name: 'From tablet' })
      await syncDevice(tablet)
      const phone = await makeDevice('phone', { orgName: 'Personal' })
      await syncDevice(phone) // linked to an empty "Personal" folder

      await renameOrganisation(phone, 'Simon Davy')
      await syncDevice(phone)

      expect(must(await phone.db.getSetlist(theirs.id)).name).to.equal('From tablet')
      expect(phone.folderLink.value).to.equal(rig.drive.findByPath(['Chordless', 'Simon Davy']).id)
    })

    it('stops before changing anything if records belong to another folder', async () => {
      // A device from before folders were linked: sync found the folder by name,
      // so renaming its organisation pointed it at a different folder, and
      // everything looked "missing" and was uploaded again (6 October 2026).
      const noLink = { get: async () => null, set: async () => {} }
      const phone = await makeDevice('phone', { orgName: 'Personal', folderLink: noLink })
      await addSetlist(phone, { name: 'Mine' })
      await syncDevice(phone)
      const tablet = await makeDevice('tablet', { orgName: 'Simon Davy' })
      await addSetlist(tablet, { name: 'Theirs' })
      await syncDevice(tablet)
      rig.drive.requests = []

      await renameOrganisation(phone, 'Simon Davy')
      let error
      try {
        await phone.sync.sync()
      } catch (e) {
        error = e
      }

      expect(error?.name).to.equal('OrganisationFolderMismatchError')
      expect(rig.drive.requests.filter(r => r.method !== 'GET')).to.deep.equal([])
      expect((await phone.db.getAllSetlists()).map(s => s.name)).to.deep.equal(['Mine'])
    })

    it('stops instead of creating a new folder if the linked one is in the trash', async () => {
      const phone = await makeDevice('phone', { orgName: 'Personal' })
      await addSetlist(phone)
      await syncDevice(phone)
      rig.drive.files.get(rig.drive.findByPath(['Chordless', 'Personal']).id).trashed = true

      let error
      try {
        await renameOrganisation(phone, 'Personal')
      } catch (e) {
        error = e
      }

      expect(error?.message).to.match(/in the Drive trash/)
      expect(orgFolders()).to.deep.equal([])
    })
  })

  describe('organisation members', () => {
    it("caches the people the organisation's folder is shared with", async () => {
      const phone = await makeDevice('phone')
      const folder = rig.drive.findByPath(['Chordless', TEST_ORG.name])
      rig.drive.addPermission(folder.id, {
        emailAddress: 'simon@example.com',
        displayName: 'Simon Davy',
        role: 'owner',
      })
      rig.drive.addPermission(folder.id, {
        emailAddress: 'ann@example.com',
        displayName: 'Ann Smith',
        role: 'writer',
      })
      rig.drive.addPermission(folder.id, { type: 'anyone', role: 'reader' })

      await syncDevice(phone)

      expect(phone.memberCache.value).to.deep.equal([
        { email: 'simon@example.com', name: 'Simon Davy', role: 'owner' },
        { email: 'ann@example.com', name: 'Ann Smith', role: 'writer' },
      ])
    })

    it('still syncs if the members cannot be fetched', async () => {
      const phone = await makeDevice('phone')
      const setlist = await addSetlist(phone, { name: 'Synced anyway' })
      rig.drive.failRequests({ method: 'GET', path: /\/permissions/ })

      await syncDevice(phone)

      expect(driveSetlist(setlist.id).name).to.equal('Synced anyway')
      expect(phone.memberCache.value).to.equal(null)
    })
  })

  describe('a user who can only read the folder', () => {
    const writes = () => rig.drive.requests.filter(r => r.method !== 'GET' && r.method !== 'HEAD')

    it('downloads what is in Drive, uploads nothing, and does not fail', async () => {
      const leader = await makeDevice('leader')
      const setlist = await addSetlist(leader, { name: 'Sunday' })
      await syncDevice(leader)

      rig.drive.readOnly = true
      const member = await makeDevice('member')
      const local = await addSetlist(member, { name: 'Only here' })
      rig.drive.requests.length = 0
      await syncDevice(member)

      expect(await member.db.getSetlist(setlist.id)).to.include({ name: 'Sunday' })
      expect(writes()).to.deep.equal([])
      expect(driveSetlistFiles().map(file => JSON.parse(file.content).name)).to.deep.equal([
        'Sunday',
      ])
      expect(member.memberCache.readOnly).to.equal(true)
      // Kept on the device
      expect(must(await member.db.getSetlist(local.id)).name).to.equal('Only here')
    })

    it('does not push when asked to push directly either', async () => {
      const member = await makeDevice('member')
      await addSetlist(member, { name: 'Only here' })
      rig.drive.readOnly = true
      rig.drive.requests.length = 0
      await member.sync.pushToDrive()
      expect(writes()).to.deep.equal([])
    })

    it('is found out by a refused upload when the first check could not be made', async () => {
      const member = await makeDevice('member')
      const local = await addSetlist(member, { name: 'Only here' })
      rig.drive.readOnly = true
      rig.drive.requests.length = 0
      // The check fails once, so the sync goes ahead and tries to upload
      rig.drive.failRequests({ method: 'GET', path: /capabilities/, times: 1 })
      await syncDevice(member)

      expect(writes().length).to.be.greaterThan(0)
      expect(writes().every(request => request.failed === 403)).to.equal(true)
      expect(member.memberCache.readOnly).to.equal(true)
      expect(driveSetlistFiles()).to.have.length(0)
      expect(must(await member.db.getSetlist(local.id)).name).to.equal('Only here')
    })

    it('does not take a failing upload for a reader', async () => {
      const member = await makeDevice('member')
      await addSetlist(member, { name: 'Writer' })
      rig.drive.failRequests({ method: 'POST', path: /^\/upload\//, status: 500, times: 50 })
      await syncDevice(member)
      expect(member.memberCache.readOnly).to.equal(false)
    })

    it('replaces a setlist it changed with the leader’s when the leader changed it too, and says which', async () => {
      const leader = await makeDevice('leader')
      const setlist = await addSetlist(leader, { name: 'Sunday' })
      await syncDevice(leader)
      const member = await makeDevice('member')
      await syncDevice(member)

      rig.drive.readOnly = true
      await editSetlist(member, setlist.id, { name: 'My key change' })
      rig.drive.readOnly = false
      await editSetlist(leader, setlist.id, { name: 'Leader change' })
      await syncDevice(leader)
      rig.drive.readOnly = true
      const said: string[] = []
      await member.sync.sync(progress => said.push(progress.message))

      expect(must(await member.db.getSetlist(setlist.id)).name).to.equal('Leader change')
      expect(member.sync.resetSetlists).to.have.length(1)
      expect(member.sync.heldBack).to.equal(0)
      expect(said.at(-1)).to.equal('Sync complete (view-only: your changes stay on this device)')
    })

    it('takes what the leader changed in a setlist it did not change', async () => {
      const leader = await makeDevice('leader')
      const setlist = await addSetlist(leader, { name: 'Sunday' })
      await syncDevice(leader)
      const member = await makeDevice('member')
      await syncDevice(member)
      await editSetlist(leader, setlist.id, { name: 'Leader change' })
      await syncDevice(leader)
      rig.drive.readOnly = true
      await syncDevice(member)
      expect(must(await member.db.getSetlist(setlist.id)).name).to.equal('Leader change')
      expect(member.sync.heldBack).to.equal(0)
    })

    it('keeps a chart it changed when the leader changed it too', async () => {
      const leader = await makeDevice('leader')
      await addSong(leader, { uuid: 'song-1', title: 'Alpha', content: '{title: Alpha}\n[G]one' })
      await syncDevice(leader)
      const member = await makeDevice('member')
      await syncDevice(member)

      rig.drive.readOnly = true
      await editSong(member, 'song-1', '{title: Alpha}\n[G]mine')
      rig.drive.readOnly = false
      await editSong(leader, 'song-1', '{title: Alpha}\n[G]theirs')
      await syncDevice(leader)
      rig.drive.readOnly = true
      const said: string[] = []
      await member.sync.sync(progress => said.push(progress.message))

      const song = must(await member.db.getSong('song-1'))
      expect(must(await member.db.getChordPro(song.chordproFileId)).content).to.contain('mine')
      expect(member.sync.heldBack).to.equal(1)
      expect(said.at(-1)).to.contain('1 differ from Drive')
    })

    it('uploads again once the user is given write access', async () => {
      const member = await makeDevice('member')
      const local = await addSetlist(member, { name: 'Waiting' })
      rig.drive.readOnly = true
      await syncDevice(member)
      expect(driveSetlistFiles()).to.have.length(0)

      rig.drive.readOnly = false
      await syncDevice(member)
      expect(driveSetlist(local.id).name).to.equal('Waiting')
      expect(member.memberCache.readOnly).to.equal(false)
    })
  })
})
