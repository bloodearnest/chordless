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
import '../../components/status-message.ts'
import type { Setlist } from '../data-types.ts'
import { createSetlist, determineSetlistType, getCurrentDB, getNextSunday } from '../db.ts'
import { goTo } from '../navigation.ts'
import { getCurrentOrganisation } from '../organisation.ts'
import { claimSetlistsOnce, getOrganisationPeople } from '../people.ts'
import { setlistTitle, toLocalDateString } from '../utils/date-utils.ts'
import { errorMessage } from '../utils/errors.ts'
import { PageView, type ViewState } from './page-view.ts'

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
      setlists: (byYear.get(year) ?? [])
        .sort((a, b) => b.date.localeCompare(a.date))
        .map(setlist => ({
          id: setlist.id,
          url: `/setlist/${setlist.id}`,
          displayName: setlistTitle(setlist, 'short'),
          songCount: Array.isArray(setlist.songs) ? setlist.songs.length : 0,
        })),
    }))
}

/** The home page: the setlists, and a button to create one */
export class HomeView extends PageView {
  declare restoredState: HomeViewState | undefined

  #modal = createRef<AppModal>()
  #form = createRef<SetlistDetailsForm>()

  #groups = new Task(this, {
    task: async () => {
      const db = await getCurrentDB()
      // One-off: record leader ids on setlists from before they existed
      await claimSetlistsOnce(db, db.organisationId)
      return groupSetlistsByYear(await db.getAllSetlists())
    },
    args: () => [],
  })

  async #openCreate(): Promise<void> {
    const { people, me } = await getOrganisationPeople()
    const date = toLocalDateString(getNextSunday())
    // Defaults: next Sunday, a Sunday morning service, led by you
    const form = this.#form.value
    if (!form) return
    form.people = people
    form.setlist = {
      date,
      time: '10:30',
      type: determineSetlistType(date, ''),
      name: '',
      owner: me?.name || '',
      ownerId: me?.id || '',
    }
    this.#modal.value?.show()
  }

  async #create(event: SetlistDetailsSaveEvent): Promise<void> {
    try {
      const newSetlist = createSetlist(event.details)
      await (await getCurrentDB()).saveSetlist(newSetlist)
      this.#modal.value?.close()
      await goTo(`/setlist/${newSetlist.id}`)
    } catch (error) {
      console.error('Failed to create setlist:', error)
      alert(`Failed to create setlist: ${errorMessage(error)}`)
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

  #renderGroups(groups: SetlistYear[]) {
    if (groups.length === 0) {
      // A new user's first sight: loaded only now, as most visits have setlists
      void import('../../components/welcome-card.ts')
      return html`<welcome-card></welcome-card>`
    }
    return repeat(
      groups,
      group => group.year,
      group => html`<setlist-group
        .year=${group.year}
        .setlists=${group.setlists}
        .expanded=${this.restoredState?.expanded?.[group.year] ?? group.expanded}
      ></setlist-group>`
    )
  }

  override render() {
    const { name } = getCurrentOrganisation()
    return html`
      <app-header id="home-app-header" heading="Setlists - ${name}">
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

      <main class="home-content">
        <div id="setlist-list" class="setlist-list">
          ${this.#groups.render({
            pending: () =>
              html`<status-message state="loading" message="Loading setlists..."></status-message>`,
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
