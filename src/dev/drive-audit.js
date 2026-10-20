import { downloadFile, driveRequest } from '/js/drive-api.ts'

const FOLDER = 'application/vnd.google-apps.folder'
const status = document.getElementById('status')
const output = document.getElementById('output')
let report = null

const esc = s =>
  String(s ?? '').replace(
    /[&<>"]/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]
  )

async function listAll(query, fields) {
  const files = []
  let pageToken = null
  do {
    let url = `/files?q=${encodeURIComponent(query)}&spaces=drive&pageSize=1000&fields=nextPageToken,files(${fields})`
    if (pageToken) url += `&pageToken=${encodeURIComponent(pageToken)}`
    const result = await driveRequest(url)
    files.push(...(result.files || []))
    pageToken = result.nextPageToken || null
  } while (pageToken)
  return files
}

const children = (parentId, extra = '') =>
  listAll(
    `'${parentId}' in parents and trashed=false${extra}`,
    'id,name,mimeType,createdTime,modifiedTime,appProperties'
  )

// The same setlist stored under different ids (e.g. two devices each uploaded their own record
// of it): the same date, time, leader, type and name. Song count is deliberately not part of it.
const sameSetlistKey = f =>
  f.date
    ? [f.date, f.time ?? '', f.owner ?? '', f.setlistType ?? '', f.setlistName ?? ''].join('|')
    : null

async function auditSpace(space) {
  const subfolders = await children(space.id, ` and mimeType='${FOLDER}'`)
  const setlistsFolders = subfolders.filter(f => f.name === 'setlists')
  const driveFiles = []
  for (const folder of setlistsFolders) {
    driveFiles.push(...(await children(folder.id)).filter(f => f.mimeType !== FOLDER))
  }

  const files = []
  const CONCURRENCY = 10
  for (let i = 0; i < driveFiles.length; i += CONCURRENCY) {
    status.textContent = `${space.name}: downloading ${i + 1}–${Math.min(i + CONCURRENCY, driveFiles.length)} of ${driveFiles.length}`
    await Promise.all(
      driveFiles.slice(i, i + CONCURRENCY).map(async file => {
        let content = null
        let error = null
        try {
          content = JSON.parse(await downloadFile(file.id))
        } catch (e) {
          error = e.message
        }
        files.push({
          fileId: file.id,
          name: file.name,
          createdTime: file.createdTime,
          modifiedTime: file.modifiedTime,
          setlistId: file.appProperties?.setlistId ?? null,
          contentId: content?.id ?? null,
          date: content?.date ?? null,
          setlistName: content?.name ?? null,
          owner: content?.owner ?? null,
          setlistType: content?.type ?? null,
          time: content?.time ?? null,
          songCount: content?.songs?.length ?? null,
          error,
        })
      })
    )
  }

  const groupBy = key => {
    const map = new Map()
    for (const f of files) {
      const k = key(f)
      if (k == null) continue
      if (!map.has(k)) map.set(k, [])
      map.get(k).push(f)
    }
    return [...map.entries()].filter(([, group]) => group.length > 1)
  }

  return {
    space: space.name,
    spaceFolderId: space.id,
    setlistsFolderCount: setlistsFolders.length,
    fileCount: files.length,
    files: files.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '')),
    duplicateSetlistIds: groupBy(f => f.setlistId),
    duplicateContentIds: groupBy(f => f.contentId),
    mismatched: files.filter(f => f.setlistId && f.contentId && f.setlistId !== f.contentId),
    missingSetlistId: files.filter(f => !f.setlistId),
    sameSetlist: groupBy(sameSetlistKey),
    downloadErrors: files.filter(f => f.error),
  }
}

// Setlist files in the Drive trash: what earlier cleanups removed. A device that was syncing
// with a file that was later trashed re-uploads its setlist, so the trashed files' setlistIds
// show where a duplicate's id came from.
async function auditTrash() {
  const files = await listAll(
    "trashed=true and mimeType='application/json'",
    'id,name,createdTime,modifiedTime,appProperties'
  )
  const setlists = files
    .filter(f => f.appProperties?.setlistId)
    .map(f => ({
      fileId: f.id,
      name: f.name,
      createdTime: f.createdTime,
      setlistId: f.appProperties.setlistId,
    }))
    .sort((a, b) => a.createdTime.localeCompare(b.createdTime))
  const byDay = {}
  for (const f of setlists) {
    // Uploaded in one go: group by the hour a file was created
    const hour = f.createdTime.slice(0, 13)
    byDay[hour] = (byDay[hour] ?? 0) + 1
  }
  return { count: setlists.length, byDay, files: setlists }
}

function renderTrash(trash, spaces) {
  const liveIds = new Set(spaces.flatMap(o => o.files.map(f => f.setlistId)))
  const matching = trash.files.filter(f => liveIds.has(f.setlistId))
  const byId = new Map()
  for (const f of trash.files) byId.set(f.setlistId, [...(byId.get(f.setlistId) ?? []), f])
  const repeated = [...byId.values()].filter(group => group.length > 1)
  return `
    <h2>Trashed setlist files: ${trash.count}</h2>
    <p>Trashed files created per hour (an upload wave): ${
      Object.entries(trash.byDay)
        .map(([day, n]) => `${esc(day)}: ${n}`)
        .join(', ') || 'none'
    }</p>
    <p>${matching.length} have a setlistId that a live file also has.</p>
    <p>${repeated.length} setlistIds are on more than one trashed file (uploaded again under the same
      id after the earlier file was trashed):</p>
    <ul>${repeated
      .slice(0, 100)
      .map(
        group =>
          `<li><code>${esc(group[0].setlistId)}</code>: ${group.map(f => esc(f.createdTime)).join(', ')}</li>`
      )
      .join('')}</ul>
    <details><summary>Trashed files</summary><table>
      <tr><th>created</th><th>file</th><th>setlistId</th></tr>
      ${trash.files
        .map(
          f =>
            `<tr><td>${esc(f.createdTime)}</td><td>${esc(f.name)}</td><td>${esc(f.setlistId)}</td></tr>`
        )
        .join('')}
    </table></details>`
}

function renderGroup(title, groups) {
  if (!groups.length) return `<p class="ok">✓ No ${esc(title)}</p>`
  return `<p class="problem">✗ ${groups.length} ${esc(title)}</p><ul>${groups
    .map(
      ([key, group]) =>
        `<li><code>${esc(key)}</code>: ${group.map(f => `${esc(f.name)} (created ${esc(f.createdTime)})`).join('; ')}</li>`
    )
    .join('')}</ul>`
}

function renderList(title, files) {
  if (!files.length) return `<p class="ok">✓ No ${esc(title)}</p>`
  return `<p class="problem">✗ ${files.length} ${esc(title)}</p><ul>${files
    .map(
      f =>
        `<li>${esc(f.name)}: setlistId ${esc(f.setlistId)}, contents ${esc(f.contentId)} ${esc(f.error ?? '')}</li>`
    )
    .join('')}</ul>`
}

function render(spaces) {
  output.innerHTML = spaces
    .map(
      o => `
    <h2>${esc(o.org)}: ${o.fileCount} setlist files</h2>
    ${o.setlistsFolderCount === 1 ? '' : `<p class="problem">✗ ${o.setlistsFolderCount} setlists folders</p>`}
    ${renderGroup('setlistIds used by more than one file', o.duplicateSetlistIds)}
    ${renderGroup('setlists stored in more than one file (by contents id)', o.duplicateContentIds)}
    ${renderList('files whose contents are a different setlist than their setlistId', o.mismatched)}
    ${renderList('files without a setlistId', o.missingSetlistId)}
    ${renderList('download errors', o.downloadErrors)}
    ${renderGroup('setlists with the same date, time, leader, type and name in more than one file', o.sameSetlist)}
    <details><summary>All files</summary><table>
      <tr><th>date</th><th>name</th><th>songs</th><th>file</th><th>created</th><th>modified</th><th>setlistId</th><th>contents id</th></tr>
      ${o.files
        .map(
          f => `<tr><td>${esc(f.date)}</td><td>${esc(f.setlistName)}</td><td>${esc(f.songCount)}</td><td>${esc(f.name)}</td>
          <td>${esc(f.createdTime)}</td><td>${esc(f.modifiedTime)}</td><td>${esc(f.setlistId)}</td><td>${esc(f.contentId)}</td></tr>`
        )
        .join('')}
    </table></details>`
    )
    .join('')
}

// ---------- cleanup ----------

const cleanup = document.getElementById('cleanup')
const keepSelect = document.getElementById('keep-org')
const confirmBox = document.getElementById('cleanup-confirm')
const runButton = document.getElementById('cleanup-run')
const cleanupStatus = document.getElementById('cleanup-status')
let plan = null

function planCleanup(spaces, keepName) {
  const keep = spaces.find(o => o.org === keepName)
  const others = spaces.filter(o => o !== keep)
  const otherIds = new Set(others.flatMap(o => o.files.map(f => f.setlistId)).filter(Boolean))
  // Of files for the same setlist, keep the earliest created and trash the rest
  const newerCopies = new Set()
  for (const [, group] of keep.sameSetlist) {
    const [, ...rest] = [...group].sort((a, b) => a.createdTime.localeCompare(b.createdTime))
    for (const f of rest) newerCopies.add(f.fileId)
  }
  const files = keep.files.flatMap(f => {
    const reasons = []
    if (newerCopies.has(f.fileId)) reasons.push('newer copy of the same setlist')
    if (otherIds.has(f.setlistId)) reasons.push('copy of a setlist from another space')
    if (f.songCount === 0) reasons.push('empty setlist')
    return reasons.length ? [{ ...f, reason: reasons.join(', ') }] : []
  })
  return {
    keep,
    files,
    folders: others.map(o => ({ id: o.spaceFolderId, name: o.org, fileCount: o.fileCount })),
    remaining: keep.fileCount - files.length,
  }
}

function renderPlan() {
  plan = planCleanup(report.spaces, keepSelect.value)
  confirmBox.checked = false
  runButton.disabled = true
  document.getElementById('cleanup-plan').innerHTML = `
    <p><strong>${plan.files.length}</strong> setlist files in ${esc(plan.keep.org)} and
      <strong>${plan.folders.length}</strong> space folder(s) will go to the trash.
      ${esc(plan.keep.org)} will have <strong>${plan.remaining}</strong> setlist files left.</p>
    ${plan.folders.map(f => `<p>Folder <code>${esc(f.name)}</code> (${f.fileCount} setlist files, plus its songs)</p>`).join('')}
    <details><summary>Files</summary><table>
      <tr><th>date</th><th>file</th><th>created</th><th>songs</th><th>reason</th></tr>
      ${plan.files
        .map(
          f =>
            `<tr><td>${esc(f.date)}</td><td>${esc(f.name)}</td><td>${esc(f.createdTime)}</td><td>${esc(f.songCount)}</td><td>${esc(f.reason)}</td></tr>`
        )
        .join('')}
    </table></details>`
}

keepSelect.addEventListener('change', renderPlan)
confirmBox.addEventListener('change', () => {
  runButton.disabled = !confirmBox.checked
})

runButton.addEventListener('click', async () => {
  runButton.disabled = true
  confirmBox.disabled = true
  const targets = [
    ...plan.files.map(f => ({ id: f.fileId, label: f.name })),
    ...plan.folders.map(f => ({ id: f.id, label: `folder ${f.name}` })),
  ]
  const failed = []
  let done = 0
  for (let i = 0; i < targets.length; i += 10) {
    await Promise.all(
      targets.slice(i, i + 10).map(async t => {
        try {
          await driveRequest(`/files/${t.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ trashed: true }),
          })
        } catch (e) {
          failed.push(`${t.label}: ${e.message}`)
        }
        done++
        cleanupStatus.textContent = `Moved ${done} of ${targets.length} to trash...`
      })
    )
  }
  cleanupStatus.innerHTML = failed.length
    ? `<p class="problem">✗ ${failed.length} failed:</p><pre>${esc(failed.join('\n'))}</pre>`
    : `<p class="ok">✓ Moved ${targets.length} items to the trash. Run the audit again to check.</p>`
})

function showCleanup() {
  keepSelect.innerHTML = report.spaces.map(o => `<option>${esc(o.org)}</option>`).join('')
  // Default to the space with the most setlist files
  keepSelect.value = [...report.spaces].sort((a, b) => b.fileCount - a.fileCount)[0]?.org
  confirmBox.disabled = false
  cleanupStatus.textContent = ''
  cleanup.hidden = false
  renderPlan()
}

document.getElementById('run').addEventListener('click', async () => {
  output.innerHTML = ''
  cleanup.hidden = true
  status.textContent = 'Finding Chordless folder...'
  try {
    const roots = await listAll(
      `name='Chordless' and mimeType='${FOLDER}' and trashed=false`,
      'id,name'
    )
    if (roots.length !== 1)
      status.textContent = `Warning: found ${roots.length} Chordless folders. `
    const spaces = []
    for (const root of roots) {
      for (const space of await children(root.id, ` and mimeType='${FOLDER}'`)) {
        if (space.name === 'pads') continue
        spaces.push(await auditSpace(space))
      }
    }
    status.textContent = 'Listing the trash...'
    const trash = await auditTrash()
    report = {
      generatedAt: new Date().toISOString(),
      chordlessFolders: roots.length,
      spaces,
      trash,
    }
    render(spaces)
    output.insertAdjacentHTML('beforeend', renderTrash(trash, spaces))
    showCleanup()
    status.textContent += 'Done.'
    document.getElementById('copy').disabled = false
  } catch (error) {
    status.textContent = `Failed: ${error.message}`
  }
})

document.getElementById('copy').addEventListener('click', async () => {
  await navigator.clipboard.writeText(JSON.stringify(report, null, 2))
  status.textContent = 'Report copied to clipboard.'
})
