import { getCurrentDB } from '/js/db.ts'
import { readEmail } from '/js/email-mime.ts'
import { importFromEmail } from '/js/email-setlist.ts'
import {
  explainUnmatched,
  parseNameRules,
  proposeLeaders,
  resolveNameRules,
  withProposedLeader,
} from '/js/leader-reconcile.ts'
import { getCurrentPerson } from '/js/people.ts'

const $ = id => document.getElementById(id)
const esc = s =>
  String(s ?? '').replace(
    /[&<>"]/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]
  )

let proposals = []

getCurrentPerson().then(me => {
  if (me) {
    $('me-name').value = me.name
    $('me-id').value = me.id
  }
})

/** The current organisation's setlists, each with its songs' titles and CCLI numbers */
async function setlistsToCheck(db) {
  const songs = new Map((await db.getAllSongs()).map(song => [song.uuid, song]))
  return (await db.getAllSetlists()).map(setlist => ({
    id: setlist.id,
    date: setlist.date,
    name: setlist.name,
    owner: setlist.owner,
    ownerId: setlist.ownerId,
    songs: setlist.songs.map(entry => {
      const song = songs.get(entry.songUuid)
      return { title: song?.title ?? '', ccli: song?.ccliNumber ?? null }
    }),
  }))
}

async function readEmails(files) {
  const emails = []
  const problems = []
  for (const file of files) {
    if (!/\.eml$/i.test(file.name)) continue
    try {
      const email = await readEmail(await file.arrayBuffer())
      emails.push({ file: file.name, setlist: importFromEmail(email) })
    } catch (error) {
      problems.push(`${file.name}: ${error?.message ?? error}`)
    }
  }
  return { emails, problems }
}

function render(emails, problems, db, unmatched, setlistCount) {
  const changing = proposals.filter(p => p.status !== 'same')
  const same = proposals.length - changing.length
  const rows = changing
    .map(
      (p, i) => `<tr class="${p.status}">
        <td><input type="checkbox" data-index="${i}" ${p.status === 'change' || p.status === 'likely' ? 'checked' : ''} /></td>
        <td>${esc(p.date)}</td>
        <td><a href="/setlist/${encodeURIComponent(p.setlistId)}" target="_blank" rel="noopener">${esc(p.name || '(no name)')}</a></td>
        <td>${esc(p.current.owner)} ${esc(p.current.ownerId)}</td>
        <td>${esc(p.leader.name)} ${esc(p.leader.email)}</td>
        <td>${p.by === 'name' ? 'by its name' : `${p.matched} of ${p.of}`}${p.status === 'weak' ? ' (emails for this date disagree on the leader: check)' : ''}${p.status === 'likely' ? ' (no email for this date: matched by its songs)' : ''}</td>
        <td>${esc(p.file || '(name rule)')}</td></tr>`
    )
    .join('')
  $('output').innerHTML = `
    <p>${emails.length} emails read; ${setlistCount} setlists in this organisation;
    ${proposals.length} setlists matched an email by date (${same} already have that leader).</p>
    ${problems.length ? `<p class="problem">Could not read: ${problems.map(esc).join('; ')}</p>` : ''}
    ${
      changing.length
        ? `<table><tr><th></th><th>Date</th><th>Setlist</th><th>Now led by</th><th>Email's leader</th><th>Songs</th><th>Email</th></tr>${rows}</table>`
        : '<p>Nothing to change.</p>'
    }`
  $('output').innerHTML += explain(unmatched)
  $('apply').hidden = !changing.length
  $('apply').onclick = () => apply(db, changing)
}

const REASONS = {
  'no-setlist': 'no setlist on its date or in the four weeks after it was sent',
  'few-songs': 'closest setlist in the four weeks after it was sent, with too few songs in common:',
  'not-mine': 'led by someone else, so skipped:',
  taken: 'fits a setlist that another email matched:',
}

/** The emails that matched no setlist, and why (this is where to look if too few were found) */
function explain(unmatched) {
  if (!unmatched.length) return ''
  const dated = unmatched.filter(u => u.date)
  const rows = unmatched
    .map(
      u => `<tr><td>${esc(u.date || '(none)')}</td><td>${esc(u.name)}</td>
        <td>${esc(u.leader.name)}</td><td>${REASONS[u.reason]} ${esc(u.other)}</td>
        <td>${esc(u.file)}</td></tr>`
    )
    .join('')
  return `<h2>${unmatched.length} emails matched no setlist (${dated.length} dated)</h2>
    <table><tr><th>Email date</th><th>Subject</th><th>Leader</th><th>Why</th><th>Email</th></tr>${rows}</table>`
}

async function apply(db, changing) {
  const chosen = [...document.querySelectorAll('#output input[data-index]:checked')].map(
    box => changing[Number(box.dataset.index)]
  )
  if (!chosen.length) return
  $('apply').disabled = true
  let saved = 0
  for (const proposal of chosen) {
    const setlist = await db.getSetlist(proposal.setlistId)
    if (!setlist) continue
    await db.saveSetlist({
      ...withProposedLeader(setlist, proposal),
      modifiedDate: new Date().toISOString(),
    })
    saved++
  }
  $('status').innerHTML =
    `<p class="done">${saved} setlists changed. They go to Drive at the next sync.</p>`
  $('output').innerHTML = ''
  $('apply').hidden = true
  $('apply').disabled = false
}

$('run').addEventListener('click', async () => {
  $('status').textContent = 'Reading…'
  $('output').textContent = ''
  try {
    const files = [...$('files').files, ...$('folder').files]
    if (!files.length) {
      $('status').textContent = 'Choose some .eml files first.'
      return
    }
    const db = await getCurrentDB()
    const { emails, problems } = await readEmails(files)
    const me = { id: $('me-id').value.trim(), name: $('me-name').value.trim() }
    const setlists = await setlistsToCheck(db)
    const { resolved, unresolved } = resolveNameRules(parseNameRules($('name-rules').value), emails)
    proposals = proposeLeaders(setlists, emails, {
      me: me.id || me.name ? me : null,
      includeAll: $('include-all').checked,
      nameRules: resolved,
    })
    if (unresolved.length) {
      problems.push(
        `no leader in the emails fits ${unresolved.map(rule => `"${rule.who}"`).join(', ')}: those rules were not used`
      )
    }
    $('status').textContent = ''
    render(
      emails,
      problems,
      db,
      explainUnmatched(setlists, emails, proposals, {
        me: me.id || me.name ? me : null,
        includeAll: $('include-all').checked,
      }),
      setlists.length
    )
  } catch (error) {
    $('status').innerHTML = `<p class="problem">${esc(error?.message ?? error)}</p>`
    console.error(error)
  }
})
