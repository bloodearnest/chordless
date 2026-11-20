import { Task } from '@lit/task'
import { html } from 'lit'
import { createRef, ref } from 'lit/directives/ref.js'
import { repeat } from 'lit/directives/repeat.js'
import '../../components/app-header.ts'
import type { AppModal } from '../../components/app-modal.ts'
import '../../components/app-modal.ts'
import '../../components/icon.ts'
import type {
  SetlistDetailsForm,
  SetlistDetailsIdentifyEvent,
  SetlistDetailsSaveEvent,
} from '../../components/setlist-details-form.ts'
import '../../components/setlist-details-form.ts'
import type { SetlistGroup, SetlistRow } from '../../components/setlist-group.ts'
import '../../components/setlist-group.ts'
import '../../components/status-message.ts'
import { listAllSetlists, openDefaultSpace, withSpace } from '../all-spaces.ts'
import type { Person, Setlist, Space } from '../data-types.ts'
import { watchData } from '../data-watcher.ts'
import {
  type ChordlessDB,
  createSetlist,
  determineSetlistType,
  getNextSunday,
  openSpace,
} from '../db.ts'
import { importTargetOf } from '../default-space.ts'
import { emptySpaceKind } from '../empty-space-kind.ts'
import { leaderName } from '../leaders.ts'
import { goTo } from '../navigation.ts'
import { getSignedInUser, getSpacePeople, identifyMe, settleLeader } from '../people.ts'
import { listSharedWithMe } from '../share-receiver.ts'
import { ensureCurrentSpace, listSpaces } from '../space.ts'
import { SyncStatusEvent } from '../sync-status.ts'
import { t } from '../text.ts'
import { toast } from '../toast.ts'
import { setlistTitle, toLocalDateString } from '../utils/date-utils.ts'
import { errorMessage } from '../utils/errors.ts'
import { PageView, type ViewState } from './page-view.ts'

/** The heading of the group of setlists received by link (its "year", as the home page groups them) */
export const SHARED_GROUP = 'Shared with me'

/** One group of setlists, for a <setlist-group> */
export interface SetlistYear {
  year: string
  expanded: boolean
  setlists: SetlistRow[]
  current?: boolean
}

/** What the home page keeps of itself: which years are open, and the scroll */
interface HomeViewState extends ViewState {
  expanded?: Record<string, boolean>
}

/**
 * Today and future setlists first, nearest first; past setlists by year,
 * newest first, with every past year initially collapsed.
 */
export function groupSetlistsByDate(
  setlists: Setlist[],
  today: string = toLocalDateString(new Date()),
  people: Person[] | ((setlist: Setlist) => Person[]) = [],
  spaceName: (setlist: Setlist) => string | undefined = () => undefined
): SetlistYear[] {
  const row = (setlist: Setlist): SetlistRow => ({
    id: setlist.id,
    url: `/setlist/${setlist.id}`,
    displayName: setlistTitle(setlist, 'short'),
    leader: leaderName(typeof people === 'function' ? people(setlist) : people, setlist.leaderId),
    space: spaceName(setlist),
    type: setlist.type,
    songCount: Array.isArray(setlist.songs) ? setlist.songs.length : 0,
  })
  const upcoming: Setlist[] = []
  const byYear = new Map<string, Setlist[]>()
  for (const setlist of setlists) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(setlist.date) && setlist.date >= today) {
      upcoming.push(setlist)
      continue
    }
    const year = setlist.date.match(/^(\d{4})/)?.[1] ?? 'Unknown'
    const inYear = byYear.get(year) ?? []
    inYear.push(setlist)
    byYear.set(year, inYear)
  }

  const history = [...byYear.keys()]
    .sort((a, b) => Number(b) - Number(a))
    .map(year => ({
      year,
      expanded: false,
      setlists: (byYear.get(year) as Setlist[])
        .sort((a, b) => b.date.localeCompare(a.date))
        .map(row),
    }))
  return upcoming.length
    ? [
        {
          year: t('home-current-upcoming'),
          expanded: true,
          current: true,
          setlists: upcoming.sort((a, b) => a.date.localeCompare(b.date)).map(row),
        },
        ...history,
      ]
    : history
}

/** The leader a new setlist starts with: the person using the app, if they are one of the space's people */
const leaderOf = (me: Person | null | undefined): string => me?.id || ''

/** The setlists received by link, as one group for <setlist-group>: they open at their link */
export function sharedGroup(setlists: Setlist[]): SetlistYear[] {
  if (setlists.length === 0) return []
  return [
    {
      year: SHARED_GROUP,
      expanded: true,
      setlists: setlists.map(setlist => ({
        id: setlist.id,
        url: `/s/${encodeURIComponent(setlist.received?.fileId ?? '')}`,
        displayName: setlistTitle(setlist, 'short'),
        leader: setlist.received?.leaderName?.trim() ?? '',
        type: setlist.type,
        songCount: Array.isArray(setlist.songs) ? setlist.songs.length : 0,
      })),
    },
  ]
}

/** The home page: the setlists, and a button to create one */
export class HomeView extends PageView {
  declare restoredState: HomeViewState | undefined

  #modal = createRef<AppModal>()
  #form = createRef<SetlistDetailsForm>()

  /** The Shared tab was chosen (/?shared): the page shows what was shared with the user, in place of the space's setlists */
  get #sharedOnly(): boolean {
    return Boolean(this.route && 'shared' in this.route)
  }

  #groups = new Task(this, {
    task: async (): Promise<{
      groups: SetlistYear[]
      shared: SetlistYear[]
      space?: Space
    }> => {
      if (this.#sharedOnly) {
        return { groups: [], shared: sharedGroup(await listSharedWithMe().catch(() => [])) }
      }
      // Every space's setlists at once: no space is switched to (docs/CENTRAL_STORAGE.md, phase 0)
      // (a device's first visit makes its Personal space, as opening the current one used to)
      await ensureCurrentSpace()
      const spaces = await listSpaces()
      const entries = await listAllSetlists(spaces)
      const people = new Map(
        await Promise.all(
          spaces.map(
            async space => [space.id, await withSpace(space.id, db => db.getAllPeople())] as const
          )
        )
      )
      const where = new Map(entries.map(entry => [entry.setlist.id, entry.space]))
      return {
        space: importTargetOf(spaces),
        groups: groupSetlistsByDate(
          entries.map(entry => entry.setlist),
          toLocalDateString(new Date()),
          setlist => people.get(where.get(setlist.id)?.id ?? '') ?? [],
          setlist => (spaces.length > 1 ? where.get(setlist.id)?.name : undefined)
        ),
        shared: sharedGroup(await listSharedWithMe().catch(() => [])),
      }
    },
    args: () => [],
  })

  /** Setlists were saved or removed (by a sync, another tab, or the page itself): show the list as it is now (the old one stays until then) */
  constructor() {
    super()
    watchData(this, ['setlist'], () => {
      if (!this.#sharedOnly) void this.#groups.run()
    })
  }

  /** A space started or finished syncing: an empty one says which, and shows what came when it is done */
  #onSyncStatus = (event: SyncStatusEvent): void => {
    if (!this.#sharedOnly && event.spaceId) {
      void this.#groups.run()
    }
  }

  override connectedCallback(): void {
    super.connectedCallback()
    window.addEventListener(SyncStatusEvent.type, this.#onSyncStatus)
  }

  override disconnectedCallback(): void {
    window.removeEventListener(SyncStatusEvent.type, this.#onSyncStatus)
    super.disconnectedCallback()
  }

  /** The spaces a new setlist can go to (the ones that can be written to), when there is a choice */
  #targets: Space[] = []
  /** The one chosen in the create form; none is the default space (or the first that can be written to) */
  #targetId = ''

  /** The database a new setlist goes to */
  async #targetDB(): Promise<ChordlessDB> {
    const spaces = await listSpaces()
    const chosen = spaces.find(space => space.id === this.#targetId)
    return chosen ? openSpace(chosen.id) : openDefaultSpace()
  }

  /** The create form is opening: which spaces it can go to, starting at the default */
  async #loadTargets(): Promise<void> {
    const spaces = (await listSpaces()).filter(
      space => !space.readOnly && space.team?.role !== 'reader'
    )
    this.#targets = spaces.length > 1 ? spaces : []
    this.#targetId = this.#targets.length ? (importTargetOf(spaces)?.id ?? '') : ''
    this.requestUpdate()
  }

  /** The person chose another space for the new setlist: its people are the ones to pick a leader from */
  async #chooseTarget(spaceId: string): Promise<void> {
    this.#targetId = spaceId
    const form = this.#form.value as SetlistDetailsForm
    const me = await this.#fillPeople(form)
    form.setlist = { ...form.setlist, leaderId: leaderOf(me) }
  }

  /** Give the form the people there are now, and who is using the app among them */
  async #fillPeople(form: SetlistDetailsForm) {
    const { people, me, askWho } = await getSpacePeople(await this.#targetDB())
    form.people = people
    form.meId = me?.id ?? null
    form.askWho = askWho
    return me
  }

  /** The person said which of the people they are: it is kept, and they become the default leader if none is chosen */
  async #identify(event: SetlistDetailsIdentifyEvent): Promise<void> {
    const form = this.#form.value as SetlistDetailsForm
    await identifyMe(await this.#targetDB(), event.personId)
    const me = await this.#fillPeople(form)
    if (me && !form.setlist.leaderId) form.setlist = { ...form.setlist, leaderId: me.id }
  }

  async #openCreate(): Promise<void> {
    const form = this.#form.value as SetlistDetailsForm
    await this.#loadTargets()
    const me = await this.#fillPeople(form)
    const date = toLocalDateString(getNextSunday())
    // Defaults: next Sunday, a Sunday morning service, led by you
    form.setlist = {
      date,
      time: '10:30',
      type: determineSetlistType(date, ''),
      name: '',
      leaderId: leaderOf(me),
    }
    this.#modal.value?.show()
  }

  async #create(event: SetlistDetailsSaveEvent): Promise<void> {
    try {
      const db = await this.#targetDB()
      const newSetlist = createSetlist({
        ...(await settleLeader(db, event.details)),
        createdBy: (await getSignedInUser())?.email,
      })
      // biome-ignore lint/plugin: a new setlist, with no stored one to write over
      await db.saveSetlist(newSetlist)
      this.#modal.value?.close()
      await goTo(`/setlist/${newSetlist.id}`)
    } catch (error) {
      console.error('Failed to create setlist:', error)
      toast(t('toast-setlist-create-failed'), {
        kind: 'error',
        details: errorMessage(error),
        action: { label: t('action-try-again'), run: () => this.#create(event) },
      })
    }
  }

  /** The years left open (the user may have opened or closed them), and the scroll */
  override captureViewState(): HomeViewState {
    const expanded: Record<string, boolean> = {}
    for (const group of this.querySelectorAll<SetlistGroup>('setlist-group'))
      expanded[group.year] = group.expanded
    const scroll = this.querySelector('main')?.scrollTop
    return { expanded, scroll }
  }

  /**
   * The setlists of the space, and those shared with the user below them. For someone
   * with none of their own, the shared ones are all there is: they come first, in place of the
   * welcome card, if there are any.
   */
  #renderGroups({
    groups,
    shared,
    space,
  }: {
    groups: SetlistYear[]
    shared: SetlistYear[]
    space?: Space
  }) {
    if (groups.length === 0 && shared.length === 0) {
      // A space that is a team's, or being fetched, is not a new user's: it says what it is
      if (space && emptySpaceKind(space) !== 'first-use') {
        void import('../../components/empty-space.ts')
        return html`<empty-space .space=${space}></empty-space>`
      }
      // A new user's first sight: loaded only now, as most visits have setlists
      void import('../../components/welcome-card.ts')
      return html`<welcome-card></welcome-card>`
    }
    const current = groups.filter(group => group.current)
    const history = groups.filter(group => !group.current)
    const renderGroups = (items: SetlistYear[]) =>
      repeat(
        items,
        group => group.year,
        group => html`<setlist-group
        .year=${group.year}
        .setlists=${group.setlists}
        .expanded=${this.restoredState?.expanded?.[group.year] ?? group.expanded}
      ></setlist-group>`
      )
    return html`
      ${renderGroups(current)}
      ${
        history.length
          ? html`<section class="history-groups" aria-label=${t('home-history')}>
            <h2>${t('home-history')}</h2>
            ${renderGroups(history)}
          </section>`
          : ''
      }
      ${renderGroups(shared)}
    `
  }

  override render() {
    return html`
      <app-header id="home-app-header" heading=${t('menu-setlists')}>
        <button
              slot="actions"
              class="create-setlist-button"
              id="create-setlist-button"
              aria-label=${t('home-create')}
              @click=${() => this.#openCreate()}
            >
              <app-icon name="add" size="24"></app-icon>
            </button>
      </app-header>

      <main class="home-content">
        <div id="setlist-list" class="setlist-list">
          ${this.#groups.render({
            pending: () =>
              this.#groups.value
                ? this.#renderGroups(this.#groups.value)
                : html`<status-message state="loading" message=${t('status-setlists-loading')}></status-message>`,
            complete: groups => this.#renderGroups(groups),
            error: error => {
              console.error('Error loading setlists:', error)
              return html`<status-message
                state="error"
                message=${t('status-setlists-failed')}
              ></status-message>`
            },
          })}
        </div>
      </main>

      <app-modal id="create-setlist-modal" heading=${t('setlist-create-heading')} ${ref(this.#modal)}>
        ${
          this.#targets.length
            ? html`<label class="create-space">
                ${t('home-create-into')}
                <select
                  id="create-setlist-space"
                  .value=${this.#targetId}
                  @change=${(event: Event) => this.#chooseTarget((event.target as HTMLSelectElement).value)}
                >
                  ${this.#targets.map(
                    space =>
                      html`<option value=${space.id} ?selected=${space.id === this.#targetId}>
                        ${space.team ? t('import-space-team', { space: space.name }) : space.name}
                      </option>`
                  )}
                </select>
              </label>`
            : ''
        }
        <setlist-details-form
          id="create-setlist-form"
          submit-label=${t('home-create-submit')}
          auto-type
          ${ref(this.#form)}
          @setlist-details-form:identify=${this.#identify}
          @setlist-details-form:save=${this.#create}
          @setlist-details-form:cancel=${() => this.#modal.value?.close()}
        ></setlist-details-form>
      </app-modal>
    `
  }
}
customElements.define('home-view', HomeView)

declare global {
  interface HTMLElementTagNameMap {
    'home-view': HomeView
  }
}
