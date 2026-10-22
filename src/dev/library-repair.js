import { ChordlessDB } from '/js/db.ts'
import { getCurrentUserInfo } from '/js/google-auth.ts'
import { applyRepair, planRepair } from '/js/library-repair.ts'
import { listSpaces } from '/js/space.ts'
import { createExport, exportFileName } from '/js/space-export.ts'
import { isTeamMember } from '/js/storage/space-storage.ts'

const spaceSelect = document.getElementById('space')
const writtenBy = document.getElementById('written-by')
const backup = document.getElementById('backup')
const previewButton = document.getElementById('preview')
const applyButton = document.getElementById('apply')
const output = document.getElementById('output')

const esc = text =>
  String(text ?? '').replace(
    /[&<>"]/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]
  )

/** Run something with a space's database open */
async function withDb(spaceId, use) {
  const db = new ChordlessDB(spaceId)
  await db.init()
  try {
    return await use(db)
  } finally {
    db.db?.close()
  }
}

/** The plan for a space, read now; nothing is changed */
async function plan(spaceId, by) {
  return withDb(spaceId, db => planRepair(db, by))
}

/** Apply a plan to a space, downloading an export of it first if asked */
async function apply(spaceId, thePlan, { download = true } = {}) {
  const space = (await listSpaces()).find(each => each.id === spaceId)
  return withDb(spaceId, async db => {
    if (download && space) {
      const link = document.createElement('a')
      link.href = URL.createObjectURL(await createExport(db, space.name))
      link.download = exportFileName(space.name)
      link.click()
      setTimeout(() => URL.revokeObjectURL(link.href), 10_000)
    }
    return applyRepair(db, thePlan)
  })
}

// For the console: await libraryRepair.plan(id, 'Name'); await libraryRepair.apply(id, thePlan)
globalThis.libraryRepair = { spaces: listSpaces, plan, apply }

let current = null

function describe(thePlan) {
  const removed = thePlan.merges.reduce((total, group) => total + group.remove.length, 0)
  const byCcli = thePlan.sources.filter(change => change.becauseCcli).length
  const byHand = thePlan.sources.length - byCcli
  const keyChange = thePlan.merges.filter(group =>
    group.remove.some(record => (record.key ?? '') !== (group.keep.key ?? ''))
  ).length
  const merges = thePlan.merges
    .map(
      group =>
        `<tr><td>${esc(group.title)}</td><td>${esc(group.keep.key ?? '')}</td><td>${group.remove
          .map(record => esc(record.key ?? '?'))
          .join(', ')}</td></tr>`
    )
    .join('')
  const byHandRows = thePlan.sources
    .filter(change => !change.becauseCcli)
    .map(change => `<li>${esc(change.title)}</li>`)
    .join('')
  return `
    <h2>The plan</h2>
    <p>${thePlan.songs} songs and ${thePlan.setlists} setlists in this space.</p>
    <ul>
      <li><strong>${thePlan.merges.length}</strong> songs are repeated: ${removed} extra records would be
        removed, leaving ${thePlan.songs - removed} (${keyChange} of the repeats are in another key).</li>
      <li><strong>${thePlan.sources.length}</strong> songs would be given a source:
        ${byCcli} SongSelect, ${byHand} “${esc(thePlan.writtenBy)}”.</li>
      <li>${thePlan.distinct.length} songs have different arrangements, which are kept.</li>
    </ul>
    <details open><summary>Songs to merge (title, key kept, keys removed)</summary>
      <table><tr><th>Song</th><th>Kept</th><th>Removed</th></tr>${merges}</table>
    </details>
    <details><summary>Songs that would be “${esc(thePlan.writtenBy)}” (no CCLI material)</summary>
      <ul>${byHandRows || '<li class="note">None</li>'}</ul>
    </details>
    <details><summary>Different arrangements kept</summary>
      <ul>${thePlan.distinct.map(each => `<li>${esc(each.title)} (${each.arrangements})</li>`).join('') || '<li class="note">None</li>'}</ul>
    </details>`
}

async function preview() {
  applyButton.disabled = true
  applyButton.textContent = 'Apply'
  output.innerHTML = '<p class="note">Reading…</p>'
  try {
    const spaceId = spaceSelect.value
    const by = writtenBy.value.trim()
    current = { spaceId, plan: await plan(spaceId, by) }
    output.innerHTML = describe(current.plan)
    applyButton.disabled = false
  } catch (error) {
    output.innerHTML = `<p class="problem">Could not read the space: ${esc(error.message)}</p>`
  }
}

let confirming = false
async function applyClicked() {
  if (!current) return
  if (!confirming) {
    // (a second click, rather than a dialog: this page may be driven from the keyboard or a script)
    confirming = true
    applyButton.textContent = 'Click again to apply'
    setTimeout(() => {
      confirming = false
      applyButton.textContent = 'Apply'
    }, 5000)
    return
  }
  confirming = false
  applyButton.disabled = true
  applyButton.textContent = 'Apply'
  try {
    const report = await apply(current.spaceId, current.plan, { download: backup.checked })
    output.innerHTML = `<p class="done">Done: ${report.songsRemoved} songs removed, ${report.sourcesSet} sources set,
      ${report.entriesMoved} setlist entries moved in ${report.setlistsChanged} setlists.</p>
      <p>Now sync this space (Account and Teams, Sync) so Drive gets it: the removed songs' files go in the Drive trash.</p>`
    current = null
  } catch (error) {
    output.innerHTML = `<p class="problem">Failed: ${esc(error.message)}. Nothing more was changed after the failure; the preview can be run again.</p>`
    applyButton.disabled = false
  }
}

async function start() {
  const spaces = await listSpaces()
  for (const space of spaces) {
    const option = document.createElement('option')
    option.value = space.id
    // (deleting songs in a Team is for its admin and owner)
    const blocked = isTeamMember(space) && space.team?.role !== 'admin'
    option.disabled = blocked
    option.textContent = `${space.name}${space.team ? ' (Team)' : ''}${blocked ? ' — not an admin' : ''}`
    spaceSelect.append(option)
  }
  const user = await getCurrentUserInfo().catch(() => null)
  writtenBy.value = user?.name ?? ''
}

previewButton.addEventListener('click', preview)
applyButton.addEventListener('click', applyClicked)
start()
