import { expect } from '@esm-bundle/chai'
import { driveRequest } from '../public/js/drive-api.js'
import { installFakeDrive } from './fake-drive.js'

const { describe, it, beforeEach, afterEach } = window

// The sync tests are only as good as the fake's fidelity, so pin down the
// Drive behaviours they rely on.
describe('FakeDrive', () => {
  let drive

  beforeEach(() => {
    drive = installFakeDrive()
  })

  afterEach(() => {
    drive.uninstall()
  })

  const list = q => driveRequest(`/files?q=${encodeURIComponent(q)}&fields=files(id,name)`)

  it('returns only default fields when none are requested', async () => {
    const created = await driveRequest('/files', {
      method: 'POST',
      body: JSON.stringify({ name: 'a.json', appProperties: { setlistId: 's1' } }),
    })
    expect(Object.keys(created).sort()).to.deep.equal(['id', 'kind', 'mimeType', 'name'])
  })

  it('keeps appProperties and properties separate in queries', async () => {
    await driveRequest('/files', {
      method: 'POST',
      body: JSON.stringify({ name: 'app.json', appProperties: { setlistId: 's1' } }),
    })

    const byProperties = await list(`properties has { key='setlistId' and value='s1' }`)
    const byAppProperties = await list(`appProperties has { key='setlistId' and value='s1' }`)

    expect(byProperties.files).to.deep.equal([])
    expect(byAppProperties.files.map(f => f.name)).to.deep.equal(['app.json'])
  })

  it('rejects query clauses it does not model instead of matching everything', async () => {
    let error
    try {
      await list(`starred = true`)
    } catch (e) {
      error = e
    }
    expect(error).to.be.an('error')
    expect(drive.errors.map(e => e.message)).to.deep.equal([
      'FakeDrive cannot evaluate query clause: starred = true',
    ])
  })

  it('uses the server clock for modifiedTime', async () => {
    drive.clockOffsetMs = -60 * 60 * 1000
    const created = await driveRequest('/files?fields=modifiedTime', {
      method: 'POST',
      body: JSON.stringify({ name: 'a.json' }),
    })
    const skew = Date.now() - new Date(created.modifiedTime).getTime()
    expect(skew).to.be.within(60 * 60 * 1000 - 1000, 60 * 60 * 1000 + 1000)
  })
})
