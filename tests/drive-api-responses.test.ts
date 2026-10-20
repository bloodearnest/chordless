/**
 * What drive-api.ts does with the answers Drive can give that the fake (fake-drive.ts) does not:
 * errors with no JSON in them, lists with no files, a page of a list at a time. The fetch is a
 * script of responses, one for each request in turn.
 */
import { expect } from '@open-wc/testing'
import {
  batchDeleteFiles,
  batchUploadFiles,
  checkDriveAccess,
  countWriteRefusals,
  createFile,
  createShareFile,
  downloadChordProFile,
  downloadFileBinary,
  downloadSetlist,
  driveRequest,
  endShareFile,
  ensurePadSetFolder,
  findOrCreateRootFolder,
  findOrCreateSpaceFolder,
  findSharesFolder,
  findSpaceFolderByName,
  getFile,
  getPadsRootFolder,
  getSetlistsFolder,
  getSharesFolder,
  getSongsFolder,
  listFolderPermissions,
  listPadSetFiles,
  listPadSetFolders,
  listSetlists,
  listShareFiles,
  listSpaces,
  setAccessTokenProvider,
  trashFilesInFolder,
  updateFile,
} from '../src/js/drive-api.ts'
import { suppressConsoleLogs } from './test-helpers.ts'

const { describe, it, beforeEach, afterEach } = window

suppressConsoleLogs()

describe('drive-api, given what Drive answers', () => {
  const realFetch = window.fetch
  let calls: Array<{ url: string; init?: RequestInit }>
  let responses: Array<Response | Error>

  /** Answer the next requests with these, in order */
  const script = (...next: Array<Response | Error | object>) => {
    responses = next.map(item =>
      item instanceof Response || item instanceof Error
        ? item
        : Response.json(item as Record<string, unknown>)
    )
  }
  const failure = (status: number, body?: object, statusText = 'Because') =>
    new Response(body ? JSON.stringify(body) : 'not json', { status, statusText })

  beforeEach(() => {
    calls = []
    responses = []
    setAccessTokenProvider(async () => 'token')
    window.fetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init })
      const next = responses.shift()
      if (!next) throw new Error(`No response scripted for ${url}`)
      if (next instanceof Error) throw next
      return next
    }) as typeof fetch
  })

  afterEach(() => {
    window.fetch = realFetch
    setAccessTokenProvider(null)
  })

  const messageOf = async (promise: Promise<unknown>) => {
    try {
      await promise
    } catch (error) {
      return (error as Error).message
    }
    return 'did not fail'
  }

  describe('requests', () => {
    it('says what Drive says went wrong, or its status text when it said nothing readable', async () => {
      script(failure(400, { error: { message: 'Bad thing' } }), failure(502))
      expect(await messageOf(driveRequest('/x'))).to.equal('Drive API error: Bad thing')
      expect(await messageOf(driveRequest('/x'))).to.equal('Drive API error: Because')
    })

    it('says what Drive says when its error has no message, too', async () => {
      script(failure(500, {}))
      expect(await messageOf(driveRequest('/x'))).to.equal('Drive API error: Because')
    })

    it('counts a refused write, but not a refused read or a rate limit', async () => {
      const before = countWriteRefusals()
      script(
        failure(403, { error: { message: 'no', errors: [{ reason: 'forbidden' }] } }),
        failure(403, { error: { message: 'slow', errors: [{ reason: 'userRateLimitExceeded' }] } }),
        failure(403, { error: { message: 'no' } })
      )
      await messageOf(driveRequest('/x', { method: 'PATCH' }))
      expect(countWriteRefusals()).to.equal(before + 1)
      await messageOf(driveRequest('/x', { method: 'PATCH' }))
      expect(countWriteRefusals()).to.equal(before + 1)
      await messageOf(driveRequest('/x'))
      expect(countWriteRefusals()).to.equal(before + 1)
    })

    it('gives nothing for an answer with no content', async () => {
      script(
        new Response(null, { status: 204 }),
        new Response('', { headers: { 'content-length': '0' } })
      )
      expect(await driveRequest('/x')).to.equal(null)
      expect(await driveRequest('/x')).to.equal(null)
    })
  })

  describe('files and people', () => {
    it('finds no file for a 404, and fails for anything else', async () => {
      script(failure(404, {}), failure(500, {}), { id: 'f1' })
      expect(await getFile('gone')).to.equal(null)
      expect(await messageOf(getFile('broken'))).to.contain('Drive API error')
      expect((await getFile('here'))?.id).to.equal('f1')
    })

    it('lists the users a folder is shared with, as they are named', async () => {
      script({
        permissions: [
          {
            id: '1',
            type: 'user',
            role: 'owner',
            emailAddress: 'a@example.com',
            displayName: 'Ann',
          },
          { id: '2', type: 'user', role: 'writer', emailAddress: 'b@example.com' },
          { id: '3', type: 'group', role: 'reader', emailAddress: 'g@example.com' },
          {
            id: '4',
            type: 'user',
            role: 'reader',
            emailAddress: 'gone@example.com',
            deleted: true,
          },
          { id: '5', type: 'user', role: 'reader' },
        ],
      })
      expect(await listFolderPermissions('folder')).to.deep.equal([
        { email: 'a@example.com', name: 'Ann', role: 'owner' },
        { email: 'b@example.com', name: 'b@example.com', role: 'writer' },
      ])
      script({})
      expect(await listFolderPermissions('folder')).to.deep.equal([])
    })
  })

  describe('deleting a batch', () => {
    it('does nothing for no files', async () => {
      expect(await batchDeleteFiles([])).to.equal(undefined)
      expect(calls).to.have.length(0)
    })

    it('counts what Drive says it deleted', async () => {
      script(new Response('HTTP/1.1 204 No Content\n\nHTTP/1.1 404 Not Found'))
      expect(await batchDeleteFiles(['a', 'b'])).to.equal(1)
      script(new Response('nothing recognisable'))
      expect(await batchDeleteFiles(['a'])).to.equal(0)
    })

    it('fails when the batch is refused', async () => {
      script(failure(500))
      expect(await messageOf(batchDeleteFiles(['a']))).to.equal('Batch delete failed: Because')
    })
  })

  describe('uploading many files', () => {
    const upload = (name: string, extra = {}) => ({ metadata: { name }, content: 'x', ...extra })

    it('uploads nothing for no files', async () => {
      expect(await batchUploadFiles([])).to.deep.equal([])
    })

    it('keeps a failed upload in its place, whatever Drive said of it', async () => {
      script(
        { id: 'one' },
        failure(500, { error: { message: 'Quota' } }),
        failure(500),
        failure(403, { error: { errors: [{ reason: 'forbidden' }] } })
      )
      const results = await batchUploadFiles([
        upload('a', { contentType: 'application/json' }),
        upload('b'),
        upload('c'),
        upload('d'),
      ])
      expect(results[0]?.id).to.equal('one')
      expect(results.slice(1)).to.deep.equal([null, null, null])
    })

    it('uploads more than a chunk of files, 30 at a time', async () => {
      script(...Array.from({ length: 31 }, (_, i) => ({ id: `f${i}` })))
      const results = await batchUploadFiles(Array.from({ length: 31 }, (_, i) => upload(`n${i}`)))
      expect(results.map(file => file?.id)).to.have.length(31)
      expect(results[30]?.id).to.equal('f30')
    })
  })

  describe('creating and updating a file', () => {
    const bodyOf = async (call: { init?: RequestInit }) =>
      new Response(call.init?.body as Blob).text()

    it('sends the content of any of the kinds it takes', async () => {
      script({ id: '1' }, { id: '2' }, { id: '3' }, { id: '4' })
      await createFile({ name: 'a' }, 'text')
      await createFile({ name: 'b' }, new Blob(['blob']), 'application/octet-stream')
      await createFile(
        { name: 'c' },
        new TextEncoder().encode('buffer').buffer,
        'application/octet-stream'
      )
      // A view of part of a buffer sends only that part
      const whole = new TextEncoder().encode('xxviewxx')
      await createFile({ name: 'd' }, whole.subarray(2, 6), 'application/octet-stream')
      const bodies = await Promise.all(calls.map(bodyOf))
      expect(bodies[0]).to.contain('text')
      expect(bodies[1]).to.contain('blob')
      expect(bodies[2]).to.contain('buffer')
      expect(bodies[3]).to.contain('view')
      expect(bodies[3]).to.not.contain('xxview')
    })

    it('refuses content of a kind it does not know', async () => {
      expect(await messageOf(createFile({ name: 'a' }, 42 as unknown as string))).to.equal(
        'Unsupported content type for Drive upload'
      )
    })

    it('says what went wrong when it is refused', async () => {
      script(
        failure(500, { error: { message: 'Quota' } }),
        failure(500),
        failure(500, {}),
        failure(500, { error: { message: 'Quota' } }),
        failure(500),
        failure(500, {})
      )
      expect(await messageOf(createFile({ name: 'a' }, 'x'))).to.equal('Drive upload error: Quota')
      expect(await messageOf(createFile({ name: 'a' }, 'x'))).to.equal(
        'Drive upload error: Because'
      )
      expect(await messageOf(createFile({ name: 'a' }, 'x'))).to.equal(
        'Drive upload error: Because'
      )
      expect(await messageOf(updateFile('id', { name: 'a' }, 'x'))).to.equal(
        'Drive update error: Quota'
      )
      expect(await messageOf(updateFile('id', { name: 'a' }, 'x'))).to.equal(
        'Drive update error: Because'
      )
      expect(await messageOf(updateFile('id', { name: 'a' }, 'x'))).to.equal(
        'Drive update error: Because'
      )
    })
  })

  describe('downloading', () => {
    it('gives the content, or fails with the status text', async () => {
      script(
        new Response('chart'),
        failure(404),
        new Response(new Uint8Array([1, 2]).buffer),
        failure(500)
      )
      expect(await downloadChordProFile('f')).to.equal('chart')
      expect(await messageOf(downloadChordProFile('f'))).to.equal('Drive download error: Because')
      expect(new Uint8Array(await downloadFileBinary('f'))).to.deep.equal(new Uint8Array([1, 2]))
      expect(await messageOf(downloadFileBinary('f'))).to.equal('Drive download error: Because')
    })

    it('reads a setlist', async () => {
      script(new Response('{"id":"s1","songs":[]}'))
      expect((await downloadSetlist('f')).id).to.equal('s1')
    })
  })

  describe('folders', () => {
    it('finds the root folder, or makes it', async () => {
      script({ files: [{ id: 'root' }] })
      expect(await findOrCreateRootFolder()).to.equal('root')
      script({ files: [] }, { id: 'new-root' })
      expect(await findOrCreateRootFolder()).to.equal('new-root')
    })

    it('finds a space folder by name, or none', async () => {
      script({ files: [{ id: 'root' }] }, { files: [{ id: 'space', name: 'Church' }] })
      expect((await findSpaceFolderByName('Church'))?.id).to.equal('space')
      script({ files: [{ id: 'root' }] }, { files: [] })
      expect(await findSpaceFolderByName('Nobody')).to.equal(null)
    })

    it('finds a space folder, or makes it with its subfolders', async () => {
      script({ files: [{ id: 'root' }] }, { files: [{ id: 'space' }] })
      expect(await findOrCreateSpaceFolder('Church', 'org-1')).to.deep.equal({
        folderId: 'space',
        isNew: false,
      })
      script(
        { files: [{ id: 'root' }] },
        { files: [] },
        { id: 'org2' },
        { id: 'songs' },
        { id: 'setlists' }
      )
      expect(await findOrCreateSpaceFolder('Church', 'org-1')).to.deep.equal({
        folderId: 'org2',
        isNew: true,
      })
    })

    it('finds the subfolders of a space, or makes them', async () => {
      script({ files: [{ id: 'songs-folder' }] })
      expect(await getSongsFolder('space')).to.equal('songs-folder')
      script({ files: [] }, { id: 'new-songs' })
      expect(await getSongsFolder('space')).to.equal('new-songs')
      script({ files: [{ id: 'setlists-folder' }] })
      expect(await getSetlistsFolder('space')).to.equal('setlists-folder')
      script({ files: [] }, { id: 'new-setlists' })
      expect(await getSetlistsFolder('space')).to.equal('new-setlists')
      script({ files: [{ id: 'shares-folder' }] })
      expect(await getSharesFolder('space')).to.equal('shares-folder')
      script({ files: [] }, { id: 'new-shares' })
      expect(await getSharesFolder('space')).to.equal('new-shares')
      script({ files: [] })
      expect(await findSharesFolder('space')).to.equal(null)
    })

    it('finds the pads folder, or makes it', async () => {
      script({ files: [{ id: 'root' }] }, { files: [{ id: 'pads' }] })
      expect(await getPadsRootFolder()).to.equal('pads')
      script({ files: [{ id: 'root' }] }, { files: [] }, { id: 'new-pads' })
      expect(await getPadsRootFolder()).to.equal('new-pads')
    })
  })

  describe('pad sets', () => {
    const padsRoot = [{ files: [{ id: 'root' }] }, { files: [{ id: 'pads' }] }]

    it('lists the pad sets and their files, with none when Drive lists none', async () => {
      script(...padsRoot, { files: [{ id: 'set1' }] })
      expect(await listPadSetFolders()).to.deep.equal([{ id: 'set1' }])
      script(...padsRoot, { files: [] })
      expect(await listPadSetFolders()).to.deep.equal([])
      script({ files: [{ id: 'pad1' }] })
      expect(await listPadSetFiles('set')).to.deep.equal([{ id: 'pad1' }])
      script({ files: [] })
      expect(await listPadSetFiles('set')).to.deep.equal([])
    })

    it('uses the folder of a pad set that exists, and makes one that does not', async () => {
      script(...padsRoot, { files: [{ id: 'set1' }] }, { id: 'set1' })
      expect(await ensurePadSetFolder('Warm')).to.equal('set1')
      expect(calls.at(-1)?.init?.method).to.equal('PATCH')
      script(...padsRoot, { files: [] }, { id: 'set2' })
      expect(await ensurePadSetFolder('Cool')).to.equal('set2')
    })

    it('moves the files of a pad set to the trash, or nothing when it has none', async () => {
      script({ files: [{ id: 'p1' }, { id: 'p2' }] }, {}, {})
      await trashFilesInFolder('set')
      expect(calls).to.have.length(3)
      expect(calls.slice(1).map(call => [call.init?.method, call.init?.body])).to.deep.equal([
        ['PATCH', JSON.stringify({ trashed: true })],
        ['PATCH', JSON.stringify({ trashed: true })],
      ])
      calls = []
      script({ files: [] })
      await trashFilesInFolder('set')
      expect(calls).to.have.length(1)
    })
  })

  describe('setlists, shares and spaces', () => {
    it('follows the pages of the setlists', async () => {
      script(
        { files: [{ id: 'sl-folder' }] },
        { files: [{ id: 'a' }], nextPageToken: 'next' },
        { files: [{ id: 'b' }] }
      )
      expect((await listSetlists('space')).map(file => file.id)).to.deep.equal(['a', 'b'])
      expect(calls.at(-1)?.url).to.contain('pageToken=next')
    })

    it('has no setlists when Drive lists none', async () => {
      script({ files: [{ id: 'sl-folder' }] }, { files: [] })
      expect(await listSetlists('space')).to.deep.equal([])
    })

    it('follows the pages of the shares', async () => {
      script({ files: [{ id: 'a' }], nextPageToken: 'next' }, { files: [{ id: 'b' }] })
      expect((await listShareFiles('shares')).map(file => file.id)).to.deep.equal(['a', 'b'])
      script({ files: [] })
      expect(await listShareFiles('shares')).to.deep.equal([])
    })

    it('lists only the folders that are spaces', async () => {
      script(
        { files: [{ id: 'root' }] },
        {
          files: [
            { id: 'o1', appProperties: { type: 'space' } },
            { id: 'f2', appProperties: { type: 'other' } },
            { id: 'f3' },
          ],
        }
      )
      expect((await listSpaces()).map(file => file.id)).to.deep.equal(['o1'])
      script({ files: [{ id: 'root' }] }, { files: [] })
      expect(await listSpaces()).to.deep.equal([])
    })

    it('trashes a share file that could not be made public, and fails as the permission did', async () => {
      script({ id: 'share' }, failure(403, { error: { message: 'Blocked' } }), failure(500))
      expect(
        await messageOf(createShareFile('folder', { name: 's' }, new Uint8Array([1])))
      ).to.equal(
        'Google would not make the link public: your organisation may not allow links that anyone can open. The song list to paste still works. (Drive API error: Blocked)'
      )
      expect(calls.at(-1)?.init?.body).to.contain('trashed')
    })

    it('ends a share, and takes one already gone as ended', async () => {
      script(new Response(null, { status: 204 }), new Response(null, { status: 204 }))
      await endShareFile('f')
      script(failure(404, {}))
      await endShareFile('f')
      script(failure(500, {}))
      expect(await messageOf(endShareFile('f'))).to.contain('Drive API error')
    })
  })

  describe('checking for Drive access', () => {
    it('is true when Drive answers, and false when it does not', async () => {
      script({ user: {} })
      expect(await checkDriveAccess()).to.equal(true)
      script(failure(401, {}))
      expect(await checkDriveAccess()).to.equal(false)
      setAccessTokenProvider(() => Promise.reject('no token'))
      expect(await checkDriveAccess()).to.equal(false)
    })
  })
})
