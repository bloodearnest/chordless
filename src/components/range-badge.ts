import { css, html, svg } from 'lit'
import type { RangeNote } from '../js/voice-range.ts'

/**
 * A key's fit to the melody's range as an icon in a round badge of the tone (docs/RANGE.md): a
 * tick when it fits, a triangle up for too high and down for too low, two stacked when it is too
 * far (red), and one of each when both ends are out. The icon is drawn to the same size in every
 * case, so the badges line up whatever they say, which side-by-side arrows (▲▲) would not. The
 * words are in the hover tip: a screen reader has them from the option's label, so this is hidden.
 */
export function rangeBadge(note: RangeNote) {
  return html`<span
    class="range-badge tone-${note.tone}"
    data-direction=${note.direction}
    title=${note.words || 'in range'}
    aria-hidden="true"
    >${icon(note)}</span
  >`
}

// (a 16 by 16 box: each triangle is as wide as the next, and the pairs fill the same height)
const UP = '8,1.5 12.5,7 3.5,7'
const DOWN = '8,14.5 12.5,9 3.5,9'

function icon({ tone, direction }: RangeNote) {
  const far = tone === 'red'
  switch (direction) {
    case 'high':
      return far
        ? svg`<svg viewBox="0 0 16 16"><polygon points="8,1.5 12.5,7 3.5,7" /><polygon points="8,9 12.5,14.5 3.5,14.5" /></svg>`
        : svg`<svg viewBox="0 0 16 16"><polygon points="8,3 13.5,12 2.5,12" /></svg>`
    case 'low':
      return far
        ? svg`<svg viewBox="0 0 16 16"><polygon points="8,14.5 12.5,9 3.5,9" /><polygon points="8,7 12.5,1.5 3.5,1.5" /></svg>`
        : svg`<svg viewBox="0 0 16 16"><polygon points="8,13 13.5,4 2.5,4" /></svg>`
    case 'both':
      return svg`<svg viewBox="0 0 16 16"><polygon points=${UP} /><polygon points=${DOWN} /></svg>`
    default:
      return svg`<svg viewBox="0 0 16 16"><path d="M3.5 8.5 L6.8 11.8 L12.5 4.8" fill="none" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" /></svg>`
  }
}

/** The badge's look: put it in the styles of a component that uses rangeBadge */
export const rangeBadgeStyles = css`
    /*
     * A key's range: a round badge of the tone, with an icon that says which way, in dark on the
     * solid colour. That reads the same on the popup's navy and on the lighter row of the key in
     * use, which coloured text does not (it fails the contrast check there). Every badge is the
     * same size, so they line up.
     */
    .range-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: none;
      width: 1.75rem;
      height: 1.75rem;
      border-radius: 50%;
      color: #14202b;
    }

    .range-badge svg {
      width: 1rem;
      height: 1rem;
      fill: currentColor;
      stroke: currentColor;
    }

    .range-badge svg polygon {
      stroke: none;
    }

    .tone-green {
      background: var(--color-success, #27ae60);
    }

    .tone-yellow {
      background: var(--color-warning, #f39c12);
    }

    .tone-red {
      background: color-mix(in srgb, var(--color-danger, #e74c3c) 70%, white);
    }
`
