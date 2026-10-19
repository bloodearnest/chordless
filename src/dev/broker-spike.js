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

$('copy-report').addEventListener('click', () =>
  navigator.clipboard.writeText(JSON.stringify(report, null, 2))
)
