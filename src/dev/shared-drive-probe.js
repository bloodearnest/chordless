import {
  batchDeleteFiles,
  createFile,
  downloadChordProFile,
  driveRequest,
  listFolderPermissions,
  updateFile,
} from '/js/drive-api.ts'
import { getAccessToken } from '/js/google-auth.ts'

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

// ==================== The Google Picker ====================

const apiKeyInput = document.getElementById('api-key')
const appIdInput = document.getElementById('app-id')
const parentInput = document.getElementById('parent')
const picked = document.getElementById('picked')
try {
  apiKeyInput.value = localStorage.getItem('probe-picker-api-key') ?? ''
} catch {
  // (no storage: the key is typed each time)
}

/** Load Google's Picker, once */
let pickerLoaded = null
function loadPicker() {
  pickerLoaded ??= new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://apis.google.com/js/api.js'
    script.onerror = () => reject(new Error('Could not load the Google Picker script'))
    script.onload = () =>
      window.gapi.load('picker', {
        callback: resolve,
        onerror: () => reject(new Error('The Picker would not load')),
      })
    document.head.append(script)
  })
  return pickerLoaded
}

/** Ask the user to pick a folder (in My Drive or a shared drive): resolves with it, or null */
async function pickFolder(apiKey, appId) {
  await loadPicker()
  const token = await getAccessToken()
  const { picker } = window.google
  return new Promise(resolve => {
    const view = new picker.DocsView(picker.ViewId.FOLDERS)
      .setIncludeFolders(true)
      .setSelectFolderEnabled(true)
      .setMimeTypes(FOLDER)
      .setEnableDrives(true)
    new picker.PickerBuilder()
      .addView(view)
      .enableFeature(picker.Feature.SUPPORT_DRIVES)
      .setOAuthToken(token)
      .setDeveloperKey(apiKey)
      .setAppId(appId)
      .setCallback(data => {
        if (data.action === picker.Action.PICKED) resolve(data.docs[0])
        else if (data.action === picker.Action.CANCEL) resolve(null)
      })
      .build()
      .setVisible(true)
  })
}

document.getElementById('pick').addEventListener('click', async () => {
  const apiKey = apiKeyInput.value.trim()
  if (!apiKey) {
    picked.textContent = 'Enter an API key first.'
    return
  }
  try {
    localStorage.setItem('probe-picker-api-key', apiKey)
  } catch {
    // (kept only for this visit)
  }
  try {
    const folder = await pickFolder(apiKey, appIdInput.value.trim())
    if (!folder) {
      picked.textContent = 'Nothing picked.'
      return
    }
    parentInput.value = folder.id
    // What Drive says about it, as this app is allowed to see it
    const info = await driveRequest(
      `/files/${folder.id}?fields=id,name,driveId,capabilities(canAddChildren,canEdit)`
    )
    picked.textContent = `Picked "${info.name}" (${info.id}): ${
      info.driveId ? `in the shared drive ${info.driveId}` : 'in My Drive'
    }; this app may ${info.capabilities?.canAddChildren ? '' : 'NOT '}add to it.`
  } catch (error) {
    picked.textContent = `The Picker failed: ${error.message}`
  }
})

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

  if (parent !== 'root') {
    await step('read the parent folder (files.get)', async () => {
      const info = await driveRequest(
        `/files/${parent}?fields=id,name,driveId,mimeType,capabilities(canAddChildren)`
      )
      return {
        ok: info.mimeType === FOLDER,
        detail: `"${info.name}", ${info.driveId ? `shared drive ${info.driveId}` : 'My Drive'}, can add: ${info.capabilities?.canAddChildren}`,
      }
    })
    await step('list the parent folder (what drive.file lets this app see in it)', async () => {
      const query = `'${parent}' in parents and trashed=false`
      const result = await driveRequest(
        `/files?q=${encodeURIComponent(query)}&spaces=drive&fields=files(id,name)`
      )
      return {
        detail: `${result.files.length} item(s): ${result.files.map(f => f.name).join(', ')}`,
      }
    })
  }

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
    // Make a change after the token, then ask what changed since. The feed can lag the change by
    // a few seconds, so ask again for a while before deciding it never shows it.
    const file = await createFile({ name: 'probe-change.txt', parents: [folderId] }, 'x')
    const asked = Date.now()
    let seen = false
    let total = 0
    while (!seen && Date.now() - asked < 20000) {
      const changes = await driveRequest(
        `/changes?pageToken=${encodeURIComponent(start.startPageToken)}&supportsAllDrives=true&includeItemsFromAllDrives=true&fields=newStartPageToken,changes(fileId,removed,file(name))`
      )
      total = (changes.changes || []).length
      seen = (changes.changes || []).some(change => change.fileId === file.id)
      if (!seen) await new Promise(resolve => setTimeout(resolve, 2000))
    }
    await batchDeleteFiles([file.id])
    const seconds = ((Date.now() - asked) / 1000).toFixed(1)
    return {
      ok: seen,
      detail: seen
        ? `saw the new file after ${seconds}s (${total} change(s))`
        : `did not see the new file in ${seconds}s (${total} change(s)): poll by listing instead`,
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
    await step('what this account may do with the file (capabilities)', async () => {
      const info = await driveRequest(
        `/files/${fileId}?fields=capabilities(canDelete,canTrash,canEdit,canMoveItemWithinDrive),driveId`
      )
      return { detail: JSON.stringify(info.capabilities) }
    })
    await step('delete the file in a batch (the batch endpoint)', async () => {
      const count = await batchDeleteFiles([fileId])
      if (count === 1) return { detail: '1 deleted' }
      // The batch only says how many worked: ask for the reason with a single delete
      let reason = ''
      try {
        await driveRequest(`/files/${fileId}`, { method: 'DELETE' })
        reason = 'a single delete worked, so only the batch call was refused'
      } catch (error) {
        reason = `a single delete says: ${error.message} (HTTP ${error.status})`
      }
      return { ok: false, detail: `${count} deleted; ${reason}` }
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
