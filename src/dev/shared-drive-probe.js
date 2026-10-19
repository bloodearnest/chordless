import {
  batchDeleteFiles,
  createFile,
  downloadChordProFile,
  driveRequest,
  listFolderPermissions,
  updateFile,
} from '/js/drive-api.ts'

const FOLDER = 'application/vnd.google-apps.folder'
const status = document.getElementById('status')
const table = document.getElementById('results')
const rows = table.querySelector('tbody')
const copyButton = document.getElementById('copy')
let report = []

const esc = s =>
  String(s ?? '').replace(
    /[&<>"]/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]
  )

/** Record one step: run it, and say whether Drive accepted it (and gave what was expected) */
async function step(name, work) {
  status.textContent = name
  let result = 'pass'
  let detail = ''
  let value
  try {
    const outcome = await work()
    value = outcome?.value
    detail = outcome?.detail ?? ''
    if (outcome?.ok === false) result = 'fail'
  } catch (error) {
    result = 'fail'
    detail = `${error.message}${error.status ? ` (HTTP ${error.status})` : ''}`
  }
  report.push({ step: name, result, detail })
  rows.insertAdjacentHTML(
    'beforeend',
    `<tr><td>${esc(name)}</td><td class="${result}">${result}</td><td>${esc(detail)}</td></tr>`
  )
  return { result, value }
}

async function run() {
  report = []
  rows.innerHTML = ''
  table.hidden = false
  copyButton.disabled = true
  const parent = document.getElementById('parent').value.trim() || 'root'
  const tryPublic = document.getElementById('public').checked
  const where = parent === 'root' ? 'My Drive' : `folder ${parent}`
  let folderId = null
  let fileId = null

  const made = await step(`create a folder in ${where}`, async () => {
    const folder = await driveRequest('/files', {
      method: 'POST',
      body: JSON.stringify({
        name: `chordless-probe-${new Date().toISOString().slice(0, 19)}`,
        mimeType: FOLDER,
        parents: [parent],
      }),
    })
    return { value: folder.id, detail: folder.id }
  })
  folderId = made.value
  if (!folderId) {
    status.textContent = 'Stopped: no folder could be made'
    copyButton.disabled = false
    return
  }

  const created = await step('create a file (multipart upload)', async () => {
    const file = await createFile(
      { name: 'probe.txt', parents: [folderId], appProperties: { probe: '1' } },
      'first'
    )
    return { value: file.id, detail: `md5 ${file.md5Checksum}` }
  })
  fileId = created.value

  await step('create a subfolder', async () => {
    const sub = await driveRequest('/files', {
      method: 'POST',
      body: JSON.stringify({ name: 'sub', mimeType: FOLDER, parents: [folderId] }),
    })
    return { detail: sub.id }
  })

  await step('list the folder (files.list)', async () => {
    const query = `'${folderId}' in parents and trashed=false`
    const result = await driveRequest(
      `/files?q=${encodeURIComponent(query)}&spaces=drive&fields=files(id,name,mimeType)`
    )
    const names = result.files.map(f => f.name).sort()
    return {
      ok: names.join(',') === 'probe.txt,sub',
      detail: `found: ${names.join(', ') || 'nothing'} (expected probe.txt, sub)`,
    }
  })

  if (fileId) {
    await step('get the file (files.get)', async () => {
      const file = await driveRequest(`/files/${fileId}?fields=id,name,appProperties`)
      return { ok: file.appProperties?.probe === '1', detail: JSON.stringify(file.appProperties) }
    })

    await step('update the file (multipart patch)', async () => {
      const file = await updateFile(fileId, { name: 'probe.txt' }, 'second')
      return { detail: `md5 ${file.md5Checksum}` }
    })

    await step('download the file (alt=media)', async () => {
      const text = await downloadChordProFile(fileId)
      return { ok: text === 'second', detail: `got "${text}", expected "second"` }
    })
  }

  await step("read the folder's permissions", async () => {
    const people = await listFolderPermissions(folderId)
    return { detail: `${people.length} people: ${people.map(p => p.email).join(', ')}` }
  })

  if (fileId && tryPublic) {
    await step('make the file readable by anyone with the link', async () => {
      await driveRequest(`/files/${fileId}/permissions`, {
        method: 'POST',
        body: JSON.stringify({ type: 'anyone', role: 'reader', allowFileDiscovery: false }),
      })
      return { detail: 'created' }
    })
    await step('remove that permission', async () => {
      await driveRequest(`/files/${fileId}/permissions/anyoneWithLink`, { method: 'DELETE' })
      return { detail: 'removed' }
    })
  }

  await step('changes.list (what a periodic pull could use)', async () => {
    const start = await driveRequest('/changes/startPageToken?supportsAllDrives=true')
    // Make a change after the token, then ask what changed since
    const file = await createFile({ name: 'probe-change.txt', parents: [folderId] }, 'x')
    const changes = await driveRequest(
      `/changes?pageToken=${encodeURIComponent(start.startPageToken)}&supportsAllDrives=true&includeItemsFromAllDrives=true&fields=newStartPageToken,changes(fileId,removed,file(name))`
    )
    const seen = (changes.changes || []).some(change => change.fileId === file.id)
    await batchDeleteFiles([file.id])
    return {
      ok: seen,
      detail: seen
        ? `saw the new file among ${changes.changes.length} change(s)`
        : `did not see the new file (${(changes.changes || []).length} change(s)): poll by listing instead`,
    }
  })

  await step('/about (no flags: what checkDriveAccess sends)', async () => {
    const about = await driveRequest('/about?fields=user')
    return { detail: about.user?.emailAddress }
  })
  // Not sent by the app: to see whether Drive would have refused these parameters there
  await step('/about with supportsAllDrives (the app does not send this)', async () => {
    const about = await driveRequest('/about?fields=user&supportsAllDrives=true')
    return { detail: `accepted: ${about.user?.emailAddress}` }
  })

  if (fileId) {
    await step('delete the file in a batch (the batch endpoint)', async () => {
      const count = await batchDeleteFiles([fileId])
      return { ok: count === 1, detail: `${count} deleted` }
    })
  }

  await step('trash the probe folder', async () => {
    await driveRequest(`/files/${folderId}`, {
      method: 'PATCH',
      body: JSON.stringify({ trashed: true }),
    })
    return { detail: 'in the Drive trash' }
  })

  const failed = report.filter(r => r.result === 'fail').length
  status.textContent =
    failed === 0 ? 'All steps passed' : `${failed} of ${report.length} steps failed`
  copyButton.disabled = false
}

document.getElementById('run').addEventListener('click', () => {
  run().catch(error => {
    status.textContent = `Stopped: ${error.message}`
  })
})
copyButton.addEventListener('click', () => {
  navigator.clipboard.writeText(JSON.stringify(report, null, 2))
})
