import { pickFolder } from '/dev/picker.js'
import { createFile, driveRequest } from '/js/drive-api.ts'
import { getIdToken, getStoredBlob } from '/js/google-auth.ts'

const FOLDER = 'application/vnd.google-apps.folder'
const $ = id => document.getElementById(id)
let team = null // what the owner made, to clean up
let report = []

const esc = s =>
  String(s ?? '').replace(
    /[&<>"]/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]
  )

/** The ID token, or an error saying what to do if Google's popup does not answer */
function idTokenWithin(ms) {
  return Promise.race([
    getIdToken(),
    new Promise((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(
              'No answer from the Google popup. Look for "Sign in as …" near the profile icon, or reload and try again (Chrome holds off showing it after it has been closed a few times)'
            )
          ),
        ms
      )
    ),
  ])
}

async function post(path, body) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return response
}

// ==================== The owner ====================

try {
  $('api-key').value = localStorage.getItem('probe-picker-api-key') ?? ''
} catch {
  // (no storage)
}

$('pick').addEventListener('click', async () => {
  const apiKey = $('api-key').value.trim()
  if (!apiKey) {
    $('picked').textContent = 'Enter an API key first.'
    return
  }
  try {
    localStorage.setItem('probe-picker-api-key', apiKey)
  } catch {
    // (kept for this visit only)
  }
  try {
    const folder = await pickFolder(apiKey, '376758830135')
    if (!folder) return
    $('parent').value = folder.id
    $('picked').textContent = `Picked "${folder.name}"`
  } catch (error) {
    $('picked').textContent = `The Picker failed: ${error.message}`
  }
})

function parseMembers(text) {
  return text
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const [email, role] = line.split(/\s+/)
      return { email, role }
    })
}

$('enable').addEventListener('click', async () => {
  const status = $('owner-status')
  try {
    status.textContent = 'Making the team folder…'
    const parent = $('parent').value.trim() || 'root'
    const folder = await driveRequest('/files', {
      method: 'POST',
      body: JSON.stringify({
        name: `chordless-broker-spike-${new Date().toISOString().slice(0, 19)}`,
        mimeType: FOLDER,
        parents: [parent],
      }),
    })
    const song = await createFile(
      { name: 'song.cho', parents: [folder.id] },
      '{title: Spike Song}\n[G]la la'
    )
    await createFile({ name: 'setlist.json', parents: [folder.id] }, '{"name":"Spike"}')
    const sub = await driveRequest('/files', {
      method: 'POST',
      body: JSON.stringify({ name: 'sub', mimeType: FOLDER, parents: [folder.id] }),
    })
    const deep = await createFile({ name: 'deep.cho', parents: [sub.id] }, 'deep')
    // A file the team folder does not hold, to see that it is refused
    const outside = await createFile({ name: 'outside.txt', parents: [parent] }, 'secret')
    team = { folderId: folder.id, outsideId: outside.id }

    status.textContent = 'Getting your Google ID token: choose the account in the Google popup…'
    const stored = await getStoredBlob()
    if (!stored) throw new Error('Not signed in: connect with Google on the Storage page first')
    const idToken = await idTokenWithin(30_000)
    status.textContent = 'Handing the Worker the folder…'
    const response = await post('/dev/spike/enable', {
      blob: stored.blob,
      id_token: idToken,
      folderId: folder.id,
      members: parseMembers($('members').value),
    })
    const result = await response.json()
    if (!response.ok) throw new Error(`${response.status}: ${JSON.stringify(result)}`)

    const code = {
      spaceId: result.spaceId,
      folderId: folder.id,
      songId: song.id,
      deepId: deep.id,
      outsideId: outside.id,
    }
    $('member-code').textContent = JSON.stringify(code)
    $('copy-code').disabled = false
    $('cleanup').disabled = false
    status.textContent = 'Ready: give the member code to the member part.'
  } catch (error) {
    status.textContent = `Failed: ${error.message}`
  }
})

$('copy-code').addEventListener('click', () =>
  navigator.clipboard.writeText($('member-code').textContent)
)

$('cleanup').addEventListener('click', async () => {
  if (!team) return
  try {
    for (const id of [team.folderId, team.outsideId]) {
      await driveRequest(`/files/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ trashed: true }),
      })
    }
    $('owner-status').textContent = 'Both are in the Drive trash.'
    $('cleanup').disabled = true
  } catch (error) {
    $('owner-status').textContent = `Could not trash them: ${error.message}`
  }
})

// ==================== The member ====================

const rows = $('results').querySelector('tbody')

function record(step, ok, detail) {
  report.push({ step, result: ok ? 'pass' : 'fail', detail })
  rows.insertAdjacentHTML(
    'beforeend',
    `<tr><td>${esc(step)}</td><td class="${ok ? 'pass' : 'fail'}">${ok ? 'pass' : 'fail'}</td><td>${esc(detail)}</td></tr>`
  )
}

$('run').addEventListener('click', async () => {
  report = []
  rows.innerHTML = ''
  $('results').hidden = false
  $('copy-report').disabled = true
  const status = $('member-status')
  try {
    const code = JSON.parse($('code').value)
    const expect = $('expect').value
    status.textContent = 'Getting your Google ID token…'
    const idToken = await idTokenWithin(30_000)
    const call = (op, extra = {}) =>
      post('/dev/spike/drive', { spaceId: code.spaceId, id_token: idToken, op, ...extra })

    // Reading: a member gets it, a non-member is refused
    const allowed = expect !== 'none'
    status.textContent = 'Listing…'
    let response = await call('list')
    const who = response.headers.get('X-Spike-Member') ?? 'unknown'
    record(
      'who the Worker took you for',
      expect === 'none' ? who.endsWith('(not a member)') : who.endsWith(`(${expect})`),
      `${who}; this page expected ${expect === 'none' ? 'a stranger' : `a ${expect}`}`
    )
    let text = await response.text()
    const names =
      allowed && response.ok
        ? JSON.parse(text)
            .files.map(f => f.name)
            .sort()
        : []
    record(
      'list the team folder',
      allowed
        ? response.ok && names.join(',') === 'setlist.json,song.cho,sub'
        : response.status === 403,
      allowed ? `${response.status}: ${names.join(', ')}` : `${response.status}: ${text}`
    )

    for (const [label, id, want] of [
      ['read a file in the folder', code.songId, '{title: Spike Song}\n[G]la la'],
      ['read a file in a folder inside it', code.deepId, 'deep'],
    ]) {
      status.textContent = `${label}…`
      const started = performance.now()
      response = await call('read', { fileId: id })
      text = await response.text()
      const ms = Math.round(performance.now() - started)
      record(
        label,
        allowed ? response.ok && text === want : response.status === 403,
        `${response.status}, ${text.length} bytes, ${ms} ms${allowed && text !== want ? `, got "${text.slice(0, 40)}"` : ''}`
      )
    }

    status.textContent = 'Asking for a file outside the folder…'
    response = await call('read', { fileId: code.outsideId })
    text = await response.text()
    record(
      'read a file outside the team folder (must be refused)',
      response.status === 403 && !text.includes('secret'),
      `${response.status}: ${text.slice(0, 80)}`
    )

    status.textContent = 'Trying to write…'
    response = await call('create', { name: `from-member-${Date.now()}.txt`, content: 'hello' })
    text = await response.text()
    record(
      expect === 'writer' ? 'create a file (a writer may)' : 'create a file (must be refused)',
      expect === 'writer' ? response.ok : response.status === 403,
      `${response.status}: ${text.slice(0, 80)}`
    )

    const failed = report.filter(r => r.result === 'fail').length
    status.textContent = failed === 0 ? 'All checks passed' : `${failed} of ${report.length} failed`
    $('copy-report').disabled = false
  } catch (error) {
    status.textContent = `Stopped: ${error.message}`
  }
})

/** SHA-256 of some bytes, as hex */
async function sha256(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}

const megabytesPerSecond = (bytes, ms) => (bytes / (1024 * 1024) / (ms / 1000)).toFixed(1)

$('big').addEventListener('click', async () => {
  const status = $('member-status')
  $('results').hidden = false
  try {
    const code = JSON.parse($('code').value)
    const mb = Math.min(140, Math.max(1, Number($('mb').value) || 20))
    const size = Math.round(mb * 1024 * 1024)
    status.textContent = `Making ${mb} MB of random bytes…`
    const data = new Uint8Array(size)
    for (let at = 0; at < size; at += 65536) {
      crypto.getRandomValues(data.subarray(at, Math.min(at + 65536, size)))
    }
    const sent = await sha256(data)
    const idToken = await idTokenWithin(30_000)

    status.textContent = `Sending ${mb} MB through the Worker…`
    let started = performance.now()
    let response = await fetch(
      `/dev/spike/upload?space=${encodeURIComponent(code.spaceId)}&name=big-${mb}mb-${Date.now()}.bin`,
      { method: 'POST', headers: { 'X-Id-Token': idToken }, body: new Blob([data]) }
    )
    const uploadMs = performance.now() - started
    const stored = await response.json().catch(() => ({}))
    record(
      `send ${mb} MB through the Worker to Drive`,
      response.ok && Number(stored.size) === size,
      `${response.status}, ${Math.round(uploadMs)} ms, ${megabytesPerSecond(size, uploadMs)} MB/s, as ${response.headers.get('X-Spike-Member')}, Drive says ${stored.size ?? JSON.stringify(stored)} bytes`
    )
    if (!response.ok) return

    status.textContent = `Reading it back through the Worker…`
    started = performance.now()
    response = await post('/dev/spike/drive', {
      spaceId: code.spaceId,
      id_token: idToken,
      op: 'read',
      fileId: stored.id,
    })
    const firstByteMs = performance.now() - started
    const back = new Uint8Array(await response.arrayBuffer())
    const downloadMs = performance.now() - started
    record(
      `read ${mb} MB back through the Worker`,
      response.ok && back.length === size && (await sha256(back)) === sent,
      `${response.status}, answer started after ${Math.round(firstByteMs)} ms, all of it after ${Math.round(downloadMs)} ms, ${megabytesPerSecond(size, downloadMs)} MB/s, ${back.length} bytes, ${(await sha256(back)) === sent ? 'identical to what was sent' : 'DIFFERENT from what was sent'}`
    )
    status.textContent = 'Done'
    $('copy-report').disabled = false
  } catch (error) {
    status.textContent = `Stopped: ${error.message}`
  }
})

// ==================== Item 6: my own token, no Worker ====================

/** Ask Drive for a file with this account's own token: the answer, or the reason it was refused */
async function ownAccess(id) {
  try {
    const file = await driveRequest(`/files/${id}?fields=id,name`)
    return { seen: true, detail: `SEEN as "${file.name}"` }
  } catch (error) {
    return { seen: false, detail: `refused (HTTP ${error.status})` }
  }
}

async function ownListing(folderId) {
  try {
    const query = encodeURIComponent(`'${folderId}' in parents and trashed=false`)
    const result = await driveRequest(`/files?q=${query}&spaces=drive&fields=files(id,name)`)
    return {
      count: result.files.length,
      detail: `${result.files.length} item(s): ${result.files.map(f => f.name).join(', ')}`,
    }
  } catch (error) {
    return { count: 0, detail: `refused (HTTP ${error.status})` }
  }
}

$('own').addEventListener('click', async () => {
  const status = $('member-status')
  $('results').hidden = false
  try {
    const code = JSON.parse($('code').value)
    status.textContent = 'Trying my own token on the team folder…'
    // 6a: this account's own Chordless sign-in cannot see what the owner's Chordless made
    const listing = await ownListing(code.folderId)
    record(
      '6a: list the team folder with my own token (expect nothing)',
      listing.count === 0,
      listing.detail
    )
    for (const [label, id] of [
      ['the team folder itself', code.folderId],
      ['a file in it', code.songId],
      ['a file in a folder inside it', code.deepId],
    ]) {
      const result = await ownAccess(id)
      record(`6a: read ${label} with my own token (expect refused)`, !result.seen, result.detail)
    }
    status.textContent = 'Done'
    $('copy-report').disabled = false
  } catch (error) {
    status.textContent = `Stopped: ${error.message}`
  }
})

$('adopt').addEventListener('click', async () => {
  const status = $('member-status')
  $('results').hidden = false
  try {
    const code = JSON.parse($('code').value)
    const apiKey = $('api-key').value.trim()
    if (!apiKey) throw new Error('Enter the Picker API key in the owner part first')
    status.textContent = 'Pick the team folder in the Google Picker…'
    const folder = await pickFolder(apiKey, '376758830135')
    if (!folder) throw new Error('Nothing picked')
    record(
      '6b: picked a folder',
      folder.id === code.folderId,
      `"${folder.name}" ${folder.id}${folder.id === code.folderId ? ' (the team folder)' : ' (NOT the team folder in the code)'}`
    )
    // A new owner would have this folder, and want its files
    const seen = await ownAccess(folder.id)
    record(
      '6b: read the picked folder with my own token (the pick grants it)',
      seen.seen,
      seen.detail
    )
    const listing = await ownListing(folder.id)
    record(
      '6b: list the picked folder (expect nothing: the files are the old owner’s)',
      listing.count === 0,
      listing.detail
    )
    const song = await ownAccess(code.songId)
    record('6b: read a file in it after picking (expect refused)', !song.seen, song.detail)
    status.textContent = 'Done'
    $('copy-report').disabled = false
  } catch (error) {
    status.textContent = `Stopped: ${error.message}`
  }
})

$('copy-report').addEventListener('click', () =>
  navigator.clipboard.writeText(JSON.stringify(report, null, 2))
)
