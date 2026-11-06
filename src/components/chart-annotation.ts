import { css, html, nothing } from 'lit'
import type { ShownAnnotation } from '../js/data-types.ts'

/** The look of a annotation on a chart, for a component's shadow styles (docs/ANNOTATIONS.md): handwriting, pencil or ink */
export const annotationStyles = css`
  .annotation {
    font-family: var(--font-family-annotation);
    font-size: var(--font-annotation);
    font-weight: 500;
    font-style: normal;
    line-height: 1.05;
    color: var(--annotation-private-color);
    white-space: nowrap;
  }

  .annotation.shared {
    color: var(--annotation-shared-color);
  }

  /* (colour is not the only sign a annotation is the team's) */
  .annotation.shared::before {
    content: '\\2022\\00a0';
  }

  .annotation.orphan {
    font-style: italic;
    opacity: 0.8;
  }

  .annotation + .annotation {
    margin-left: 0.6em;
  }
`

/** Annotations as a run of handwriting; nothing for none */
export function renderAnnotations(annotations: ShownAnnotation[] | undefined, orphan = false) {
  if (!annotations?.length) return nothing
  return annotations.map(
    annotation =>
      html`<span
        class="annotation ${annotation.shared ? 'shared' : ''} ${orphan ? 'orphan' : ''}"
        data-annotation-id=${annotation.id}
        title=${annotation.shared ? 'Shared with the team' : 'Just you'}
        >${annotation.text}</span
      >`
  )
}
