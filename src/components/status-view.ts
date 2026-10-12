import { html } from 'lit'
import type { IconName } from '../js/icons.ts'

/** What a status shows: its colour, an icon, a word, and why */
export interface StatusShown {
  look: 'good' | 'warn' | 'bad' | 'none'
  icon: IconName
  label: string
  detail: string
}

/**
 * The markup of a status (styled by statusStyles in shared-styles.ts). `id` and `state` are for
 * tests and for finding it: state is set as data-state.
 */
export function renderStatus(
  shown: StatusShown,
  { id, state }: { id?: string; state?: string } = {}
) {
  return html`
    <div
      class="status"
      id=${id ?? ''}
      role="status"
      data-state=${state ?? ''}
      data-look=${shown.look}
    >
      <span class="status-badge"><app-icon name=${shown.icon} size="28"></app-icon></span>
      <span class="status-text">
        <span class="status-label">${shown.label}</span>
        <span class="status-detail">${shown.detail}</span>
      </span>
    </div>
  `
}
