/**
 * The question asked before a space is deleted everywhere (space-delete-everywhere.ts): who sees it,
 * and that nothing is done until a backup has been made and the name typed. The backup and the
 * deletion are given in, as they are tested where they are (space-deletion.test.ts).
 */
import { expect, fixture, html, waitUntil } from '@open-wc/testing'
import type { AppModal } from '../src/components/app-modal.ts'
import '../src/components/space-delete-everywhere.ts'
import type {
  SpaceDeletedEvent,
  SpaceDeleteEverywhere,
} from '../src/components/space-delete-everywhere.ts'
import type { Space } from '../src/js/data-types.ts'
import type { SignInState } from '../src/js/google-auth.ts'
import type { BackupFile } from '../src/js/space-backup.ts'
import type { TeamRole } from '../src/js/team-roles.ts'
import { must } from './must.ts'

const { describe, it } = window

const space = (name: string, role?: TeamRole): Space => ({
  id: 'space-under-test',
  name,
  createdDate: '',
  modifiedDate: '',
  ...(role ? { team: { id: 'space-bbbb2222', role } } : {}),
})

describe('space-delete-everywhere', () => {
  async function make(
    target: Space,
    options: {
      signIn?: SignInState
      backup?: (space: Space) => Promise<BackupFile>
      deleter?: (space: Space) => Promise<{ wasCurrent: boolean }>
    } = {}
  ) {
    const deleted: boolean[] = []
    const el = await fixture<SpaceDeleteEverywhere>(
      html`<space-delete-everywhere
        .space=${target}
        .summary=${{ songs: 12, setlists: 1, bytes: 100 }}
        .signIn=${options.signIn ?? 'signed-in'}
        .backup=${options.backup ?? (async () => ({ fileName: 'backup.zip', bytes: 2048 }))}
        .deleter=${options.deleter ?? (async () => ({ wasCurrent: false }))}
        @space-delete-everywhere:deleted=${(event: SpaceDeletedEvent) =>
          deleted.push(event.wasCurrent)}
      ></space-delete-everywhere>`
    )
    return { el, deleted }
  }
  const q = <T extends HTMLElement>(el: SpaceDeleteEverywhere, selector: string) =>
    must(el.shadowRoot?.querySelector<T>(selector))
  const text = (el: SpaceDeleteEverywhere) =>
    (el.shadowRoot?.textContent ?? '').replace(/\s+/g, ' ')
  const modal = (el: SpaceDeleteEverywhere) => q<AppModal>(el, 'app-modal')
  const type = async (el: SpaceDeleteEverywhere, value: string) => {
    const input = q<HTMLInputElement>(el, '#confirm-name')
    input.value = value
    input.dispatchEvent(new Event('input'))
    await el.updateComplete
  }
  const open = async (el: SpaceDeleteEverywhere) => {
    q<HTMLButtonElement>(el, '#delete-everywhere').click()
    await el.updateComplete
  }
  const deleteButton = (el: SpaceDeleteEverywhere) => q<HTMLButtonElement>(el, '#do-delete')

  it('is offered to someone with a personal space, and to a Team’s admin and owner', async () => {
    for (const target of [space('Mine'), space('Church', 'admin'), space('Church', 'owner')]) {
      const { el } = await make(target)
      expect(q<HTMLButtonElement>(el, '#delete-everywhere').disabled).to.equal(false)
    }
  })

  it('is not offered to a Team’s writer or reader, who are told why', async () => {
    for (const role of ['writer', 'reader'] as const) {
      const { el } = await make(space('Church', role))
      expect(el.shadowRoot?.querySelector('#delete-everywhere')).to.equal(null)
      expect(text(el)).to.contain('Only an admin can delete a Team everywhere')
    }
  })

  it('needs Drive to be reached: a sign-in with Drive, or for a Team a sign-in alone', async () => {
    const signedOut = await make(space('Mine'), { signIn: 'signed-out' })
    expect(q<HTMLButtonElement>(signedOut.el, '#delete-everywhere').disabled).to.equal(true)
    expect(text(signedOut.el)).to.contain('Sign in with Google')
    const noDrive = await make(space('Mine'), { signIn: 'no-drive' })
    expect(q<HTMLButtonElement>(noDrive.el, '#delete-everywhere').disabled).to.equal(true)
    const team = await make(space('Church', 'admin'), { signIn: 'no-drive' })
    expect(q<HTMLButtonElement>(team.el, '#delete-everywhere').disabled).to.equal(false)
  })

  it('says what will be lost, for a space and for a Team', async () => {
    const { el } = await make(space('Mine'))
    await open(el)
    expect(modal(el).open).to.equal(true)
    expect(text(el)).to.contain('from this device and from Google Drive')
    expect(text(el)).to.contain('12 songs and 1 setlist')
    expect(text(el)).to.contain('thirty days')
    const team = await make(space('Church', 'admin'))
    await open(team.el)
    expect(text(team.el)).to.contain('ends sharing for everyone in the Team')
  })

  it('does nothing until a backup has been made and the name typed, as it is', async () => {
    let backups = 0
    let deletions = 0
    const { el } = await make(space('Mine'), {
      backup: async () => {
        backups++
        return { fileName: 'chordless-export-mine.zip', bytes: 2048 }
      },
      deleter: async () => {
        deletions++
        return { wasCurrent: false }
      },
    })
    await open(el)
    expect(deleteButton(el).disabled).to.equal(true)

    await type(el, 'Mine')
    expect(deleteButton(el).disabled, 'name typed, but no backup').to.equal(true)

    q<HTMLButtonElement>(el, '#make-backup').click()
    await waitUntil(() => text(el).includes('chordless-export-mine.zip'), 'the backup')
    expect(text(el)).to.contain('2 KB')
    expect(backups).to.equal(1)
    expect(deleteButton(el).disabled, 'backup, and the name').to.equal(false)

    await type(el, 'Min')
    expect(deleteButton(el).disabled, 'the wrong name').to.equal(true)
    await type(el, '  Mine ')
    expect(deleteButton(el).disabled, 'spaces at the ends do not count').to.equal(false)
    expect(deletions).to.equal(0)
  })

  it('deletes when asked, and says whether it was the space in use', async () => {
    const targets: Space[] = []
    const { el, deleted } = await make(space('Mine'), {
      deleter: async target => {
        targets.push(target)
        return { wasCurrent: true }
      },
    })
    await open(el)
    q<HTMLButtonElement>(el, '#make-backup').click()
    await waitUntil(() => text(el).includes('backup.zip'), 'the backup')
    await type(el, 'Mine')
    deleteButton(el).click()
    await waitUntil(() => deleted.length === 1, 'deleted')
    expect(deleted).to.deep.equal([true])
    expect(targets.map(each => each.id)).to.deep.equal(['space-under-test'])
    expect(modal(el).open).to.equal(false)
  })

  it('does nothing when asked to without the backup or the name, whatever is pressed', async () => {
    let deletions = 0
    const { el } = await make(space('Mine'), {
      deleter: async () => {
        deletions++
        return { wasCurrent: false }
      },
    })
    await open(el)
    await el._delete()
    await type(el, 'Mine')
    await el._delete()
    expect(deletions).to.equal(0)
  })

  it('says nothing of what a space holds when it does not know', async () => {
    const el = await fixture<SpaceDeleteEverywhere>(
      html`<space-delete-everywhere .space=${space('Mine')} .signIn=${'signed-in'}></space-delete-everywhere>`
    )
    await open(el)
    expect(text(el)).to.contain('This deletes it from this device and from Google Drive.')
    expect(text(el)).to.not.contain('It holds')
  })

  it('says why, and can be tried again, when the deletion does not work', async () => {
    let fail = true
    const { el, deleted } = await make(space('Mine'), {
      deleter: async () => {
        if (fail) throw new Error('Drive is not answering')
        return { wasCurrent: false }
      },
    })
    await open(el)
    q<HTMLButtonElement>(el, '#make-backup').click()
    await waitUntil(() => text(el).includes('backup.zip'), 'the backup')
    await type(el, 'Mine')
    deleteButton(el).click()
    await waitUntil(() => text(el).includes('Drive is not answering'), 'the reason')
    expect(deleted).to.deep.equal([])
    expect(modal(el).open).to.equal(true)
    expect(deleteButton(el).disabled).to.equal(false)

    fail = false
    deleteButton(el).click()
    await waitUntil(() => deleted.length === 1, 'deleted')
  })

  it('says when the backup could not be made, and does not let it be deleted without one', async () => {
    const { el } = await make(space('Mine'), {
      backup: async () => {
        throw new Error('The database is closed')
      },
    })
    await open(el)
    await type(el, 'Mine')
    q<HTMLButtonElement>(el, '#make-backup').click()
    await waitUntil(() => text(el).includes('The backup could not be made'), 'the reason')
    expect(text(el)).to.contain('The database is closed')
    expect(deleteButton(el).disabled).to.equal(true)
  })

  it('starts again each time it is opened, and can be cancelled', async () => {
    const { el } = await make(space('Mine'))
    await open(el)
    q<HTMLButtonElement>(el, '#make-backup').click()
    await waitUntil(() => text(el).includes('backup.zip'), 'the backup')
    await type(el, 'Mine')
    q<HTMLButtonElement>(el, '#cancel-delete').click()
    await el.updateComplete
    expect(modal(el).open).to.equal(false)

    await open(el)
    expect(q<HTMLInputElement>(el, '#confirm-name').value).to.equal('')
    expect(text(el)).to.not.contain('backup.zip')
    expect(text(el)).to.contain('Needed before you can delete')
    expect(deleteButton(el).disabled).to.equal(true)
    expect(text(el)).to.contain('Download a backup')
  })

  it('offers the backup again once it has been made', async () => {
    const { el } = await make(space('Mine'))
    await open(el)
    q<HTMLButtonElement>(el, '#make-backup').click()
    await waitUntil(() => text(el).includes('Download it again'), 'the second offer')
  })
})
