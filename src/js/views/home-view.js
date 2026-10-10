import { Task } from '@lit/task'
import { html } from 'lit'
import { createRef, ref } from 'lit/directives/ref.js'
import { repeat } from 'lit/directives/repeat.js'
import '../../components/app-header.js'
import '../../components/app-modal.js'
import '../../components/icon.js'
import '../../components/setlist-details-form.js'
import '../../components/setlist-group.ts'
import '../../components/status-message.ts'
import { createSetlist, determineSetlistType, getCurrentDB, getNextSunday } from '../db.ts'
import { goTo } from '../navigation.ts'
import { getCurrentOrganisation } from '../organisation.ts'
import { claimSetlistsOnce, getOrganisationPeople } from '../people.ts'
import { setlistTitle, toLocalDateString } from '../utils/date-utils.ts'
import { PageView } from './page-view.ts'

/**
 * The setlists, grouped by year, newest first, for <setlist-group>s: the
 * current year starts expanded.
 * @param {object[]} setlists
 * @param {number} [currentYear]
 * @returns {{year: string, expanded: boolean, setlists: object[]}[]}
 */
export function groupSetlistsByYear(setlists, currentYear = new Date().getFullYear()) {
  const byYear = new Map()
  for (const setlist of setlists) {
    const year = setlist.date.match(/^(\d{4})/)?.[1] ?? 'Unknown'
    if (!byYear.has(year)) byYear.set(year, [])
    byYear.get(year).push(setlist)
  }

  return [...byYear.keys()]
    .sort((a, b) => b - a)
    .map(year => ({
      year,
      expanded: Number(year) === currentYear,
      setlists: byYear
        .get(year)
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
  #modal = createRef()
  #form = createRef()

  #groups = new Task(this, {
    task: async () => {
      const db = await getCurrentDB()
      // One-off: record leader ids on setlists from before they existed
      await claimSetlistsOnce(db, db.organisationId)
      return groupSetlistsByYear(await db.getAllSetlists())
    },
    args: () => [],
  })

  async #openCreate() {
    const { people, me } = await getOrganisationPeople()
    const date = toLocalDateString(getNextSunday())
    // Defaults: next Sunday, a Sunday morning service, led by you
    this.#form.value.people = people
    this.#form.value.setlist = {
      date,
      time: '10:30',
      type: determineSetlistType(date, ''),
      name: '',
      owner: me?.name || '',
      ownerId: me?.id || '',
    }
    this.#modal.value.show()
  }

  async #create(event) {
    try {
      const newSetlist = createSetlist(event.details)
      await (await getCurrentDB()).saveSetlist(newSetlist)
      this.#modal.value.close()
      await goTo(`/setlist/${newSetlist.id}`)
    } catch (error) {
      console.error('Failed to create setlist:', error)
      alert(`Failed to create setlist: ${error.message}`)
    }
  }

  /** The years left open (the user may have opened or closed them), and the scroll */
  captureViewState() {
    const expanded = {}
    for (const group of this.querySelectorAll('setlist-group'))
      expanded[group.year] = group.expanded
    const scroll = this.querySelector('main')?.scrollTop
    return { expanded, scroll }
  }

  #renderGroups(groups) {
    if (groups.length === 0) {
      return html`<status-message
        state="empty"
        message="No setlists found in database."
        detail="Go to Settings to import setlists."
      ></status-message>`
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

  render() {
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
          @setlist-details-form:cancel=${() => this.#modal.value.close()}
        ></setlist-details-form>
      </app-modal>
    `
  }
}
customElements.define('home-view', HomeView)
