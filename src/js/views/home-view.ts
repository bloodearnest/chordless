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
  SetlistDetailsSaveEvent,
} from '../../components/setlist-details-form.ts'
import '../../components/setlist-details-form.ts'
import type { SetlistGroup, SetlistRow } from '../../components/setlist-group.ts'
import '../../components/setlist-group.ts'
import '../../components/space-tabs.ts'
import '../../components/status-message.ts'
import type { Setlist } from '../data-types.ts'
import { watchData } from '../data-watcher.ts'
import { createSetlist, determineSetlistType, getCurrentDB, getNextSunday } from '../db.ts'
import { goTo } from '../navigation.ts'
import { getSignedInUser, getSpacePeople, settleLeader } from '../people.ts'
import { listSharedWithMe } from '../share-receiver.ts'
import { toast } from '../toast.ts'
import { setlistTitle, toLocalDateString } from '../utils/date-utils.ts'
import { errorMessage } from '../utils/errors.ts'
import { PageView, type ViewState } from './page-view.ts'

/** The heading of the group of setlists received by link (its "year", as the home page groups them) */
export const SHARED_GROUP = 'Shared with me'

/** One year's setlists, for a <setlist-group> */
export interface SetlistYear {
  year: string
  expanded: boolean
  setlists: SetlistRow[]
}

/** What the home page keeps of itself: which years are open, and the scroll */
interface HomeViewState extends ViewState {
  expanded?: Record<string, boolean>
}

/**
 * The setlists, grouped by year, newest first, for <setlist-group>s: the
 * current year starts expanded.
 */
export function groupSetlistsByYear(
  setlists: Setlist[],
  currentYear: number = new Date().getFullYear()
): SetlistYear[] {
  const byYear = new Map<string, Setlist[]>()
  for (const setlist of setlists) {
    const year = setlist.date.match(/^(\d{4})/)?.[1] ?? 'Unknown'
    const inYear = byYear.get(year) ?? []
    inYear.push(setlist)
    byYear.set(year, inYear)
  }

  return [...byYear.keys()]
    .sort((a, b) => Number(b) - Number(a))
    .map(year => ({
      year,
      expanded: Number(year) === currentYear,
      setlists: (byYear.get(year) as Setlist[])
        .sort((a, b) => b.date.localeCompare(a.date))
        .map(setlist => ({
          id: setlist.id,
          url: `/setlist/${setlist.id}`,
          displayName: setlistTitle(setlist, 'short'),
          songCount: Array.isArray(setlist.songs) ? setlist.songs.length : 0,
        })),
    }))
}

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
        displayName: `${setlistTitle(setlist, 'short')}${setlist.received?.leaderName ? ` · ${setlist.received.leaderName}` : ''}`,
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
    task: async (): Promise<{ groups: SetlistYear[]; shared: SetlistYear[] }> => {
      if (this.#sharedOnly) {
        return { groups: [], shared: sharedGroup(await listSharedWithMe().catch(() => [])) }
      }
      const db = await getCurrentDB()
      return {
        groups: groupSetlistsByYear(await db.getAllSetlists()),
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

  async #openCreate(): Promise<void> {
    const { people, me } = await getSpacePeople(await getCurrentDB())
    const date = toLocalDateString(getNextSunday())
    // Defaults: next Sunday, a Sunday morning service, led by you
    const form = this.#form.value as SetlistDetailsForm
    form.people = people
    form.setlist = {
      date,
      time: '10:30',
      type: determineSetlistType(date, ''),
      name: '',
      leaderId: me?.id || '',
    }
    this.#modal.value?.show()
  }

  async #create(event: SetlistDetailsSaveEvent): Promise<void> {
    try {
      const db = await getCurrentDB()
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
      toast("Couldn't create the setlist.", {
        kind: 'error',
        details: errorMessage(error),
        action: { label: 'Try again', run: () => this.#create(event) },
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
  #renderGroups({ groups, shared }: { groups: SetlistYear[]; shared: SetlistYear[] }) {
    if (groups.length === 0 && shared.length === 0) {
      // A new user's first sight: loaded only now, as most visits have setlists
      void import('../../components/welcome-card.ts')
      return html`<welcome-card></welcome-card>`
    }
    return repeat(
      [...groups, ...shared],
      group => group.year,
      group => html`<setlist-group
        .year=${group.year}
        .setlists=${group.setlists}
        .expanded=${this.restoredState?.expanded?.[group.year] ?? group.expanded}
      ></setlist-group>`
    )
  }

  override render() {
    return html`
      <app-header id="home-app-header" heading="Setlists">
        <button
              slot="actions"
              class="create-setlist-button"
              id="create-setlist-button"
              aria-label="Create new setlist"
              @click=${() => this.#openCreate()}
            >
              <app-icon name="add" size="24"></app-icon>
            </button>
      </app-header>
      <space-tabs ?shared=${this.#sharedOnly}></space-tabs>

      <main class="home-content">
        <div id="setlist-list" class="setlist-list">
          ${this.#groups.render({
            pending: () =>
              this.#groups.value
                ? this.#renderGroups(this.#groups.value)
                : html`<status-message state="loading" message="Loading setlists..."></status-message>`,
            complete: groups => this.#renderGroups(groups),
            error: error => {
              console.error('Error loading setlists:', error)
              return html`<status-message
                state="error"
                message="Error loading setlists. Please check the console."
              ></status-message>`
            },
          })}
        </div>
      </main>

      <app-modal id="create-setlist-modal" heading="Create New Setlist" ${ref(this.#modal)}>
        <setlist-details-form
          id="create-setlist-form"
          submit-label="Create Setlist"
          auto-type
          ${ref(this.#form)}
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
