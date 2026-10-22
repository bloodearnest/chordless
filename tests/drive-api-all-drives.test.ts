import { expect } from '@open-wc/testing'
import { allDrivesUrl, createTeamFolder } from '../src/js/drive-api.ts'
import { useFakeDriveRig } from './drive-harness.ts'
import { suppressConsoleLogs } from './test-helpers.ts'

const { describe, it } = window

suppressConsoleLogs()

describe('Shared drives (docs/SPACES.md)', () => {
  describe('allDrivesUrl', () => {
    it('lets calls on one file and its permissions meet files in a shared drive', () => {
      expect(allDrivesUrl('/files/abc?fields=id', 'PATCH')).to.equal(
        '/files/abc?fields=id&supportsAllDrives=true'
      )
      expect(allDrivesUrl('/files/abc/permissions', 'POST')).to.equal(
        '/files/abc/permissions?supportsAllDrives=true'
      )
      expect(allDrivesUrl('/files', 'POST')).to.equal('/files?supportsAllDrives=true')
      expect(allDrivesUrl('/files/abc', 'DELETE')).to.equal('/files/abc?supportsAllDrives=true')
    })

    it('has a listing ask for the shared drives’ items as well', () => {
      expect(allDrivesUrl('/files?q=x&spaces=drive')).to.equal(
        '/files?q=x&spaces=drive&supportsAllDrives=true&includeItemsFromAllDrives=true'
      )
    })

    it('leaves other endpoints alone, which would not take the parameters', () => {
      expect(allDrivesUrl('/about?fields=user')).to.equal('/about?fields=user')
      expect(allDrivesUrl('/filesx')).to.equal('/filesx')
    })
  })

  describe('a sync', () => {
    const rig = useFakeDriveRig()

    it('says so on every call on files, whatever it does', async () => {
      const phone = await rig.makeDevice('phone')
      const setlist = await rig.addSetlist(phone, { name: 'Sunday' })
      await rig.syncDevice(phone)
      await rig.editSetlist(phone, setlist.id, { name: 'Edited' })
      await rig.syncDevice(phone)
      const tablet = await rig.makeDevice('tablet')
      await rig.syncDevice(tablet)

      const onFiles = rig.drive.requests.filter(request => /\/drive\/v3\/files/.test(request.path))
      expect(onFiles.length).to.be.greaterThan(10)
      const without = onFiles.filter(request => request.params?.get('supportsAllDrives') !== 'true')
      expect(without.map(request => `${request.method} ${request.path}`)).to.deep.equal([])
      const listings = onFiles.filter(
        request => request.method === 'GET' && request.params?.has('q')
      )
      expect(listings.length).to.be.greaterThan(0)
      expect(
        listings.every(request => request.params?.get('includeItemsFromAllDrives') === 'true')
      ).to.equal(true)
    })

    it('makes a team folder inside a picked parent, as a folder the app made', async () => {
      const phone = await rig.makeDevice('phone')
      const parent = await createTeamFolder('root', 'Parent')
      const id = await createTeamFolder(parent, 'St Mary’s')
      const file = rig.drive.files.get(id)
      expect(file?.name).to.equal('St Mary’s')
      expect(file?.parents).to.deep.equal([parent])
      const posts = rig.drive.requests.filter(request => request.method === 'POST')
      expect(posts.every(request => request.params?.get('supportsAllDrives') === 'true')).to.equal(
        true
      )
      expect(phone).to.not.equal(undefined)
    })
  })
})
