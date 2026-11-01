import { css, html, nothing } from 'lit'
import type { ShownNote } from '../js/data-types.ts'

/** The look of a note on a chart, for a component's shadow styles (docs/NOTES.md): handwriting, pencil or ink */
export const noteStyles = css`
  .note {
    font-family: var(--font-family-note);
    font-size: var(--font-note);
    font-weight: 500;
    font-style: normal;
    line-height: 1.05;
    color: var(--note-private-color);
    white-space: nowrap;
  }

  .note.shared {
    color: var(--note-shared-color);
  }

  /* (colour is not the only sign a note is the team's) */
  .note.shared::before {
    content: '\\2022\\00a0';
  }

  .note.orphan {
    font-style: italic;
    opacity: 0.8;
  }

  .note + .note {
    margin-left: 0.6em;
  }
`

/** Notes as a run of handwriting; nothing for none */
export function renderNotes(notes: ShownNote[] | undefined, orphan = false) {
  if (!notes?.length) return nothing
  return notes.map(
    note =>
      html`<span
        class="note ${note.shared ? 'shared' : ''} ${orphan ? 'orphan' : ''}"
        data-note-id=${note.id}
        title=${note.shared ? 'Shared with the team' : 'Just you'}
        >${note.text}</span
      >`
  )
}
