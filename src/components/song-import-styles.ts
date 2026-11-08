/** The styles of the import page (song-import.ts) */
import { css } from 'lit'
import { buttonStyles, spinnerStyles } from './shared-styles.ts'

export const songImportStyles = [
  buttonStyles,
  spinnerStyles,
  css`
    /* The page's own reset (* { margin: 0; padding: 0 }) beats :host, so the
       spacing goes on .page */
    :host {
      display: block;
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      color: var(--text-color);
    }

    .page {
      max-width: 600px;
      margin: 0 auto;
      padding: 2rem 1rem;
    }

    .space-picker {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      margin-bottom: 1rem;
      font-size: var(--font-ui-small);
    }

    .space-picker select {
      flex: 1;
      padding: 0.4rem 0.6rem;
      font: inherit;
      border: 2px solid var(--border-light, #ecf0f1);
      border-radius: 6px;
      background-color: var(--bg-secondary, #f8f9fa);
      color: var(--text-color);
    }

    .page.wide {
      max-width: none;
    }

    .status {
      text-align: center;
      color: var(--text-secondary, #5f6b6d);
    }

    .status.error {
      color: var(--color-danger, #e74c3c);
    }

    h2 {
      margin: 0 0 1.5rem;
      font-size: var(--font-ui);
    }

    /* The question of what to do with a duplicate: the theme's surface, with an info-coloured
       edge (a decision, not a warning), so it reads in light and dark */
    .duplicate {
      background: var(--bg-secondary);
      color: var(--text-color);
      border: 1px solid var(--border-color);
      border-left: 5px solid var(--color-info);
      border-radius: 8px;
      padding: 1.5rem;
    }

    .duplicate strong {
      display: block;
      margin-bottom: 0.75rem;
    }

    .duplicate p {
      margin: 0 0 1rem;
    }

    .duplicate-actions {
      display: flex;
      gap: 0.75rem;
      margin: 0.75rem 0;
    }

    .picks {
      margin: 0.5rem 0;
      padding: 0;
      border: none;
    }

    .picks legend {
      padding: 0;
      font-size: var(--font-ui-small);
      color: var(--text-secondary);
    }

    .pick {
      display: flex;
      gap: 0.6rem;
      align-items: flex-start;
      padding: 0.5rem 0.6rem;
      margin-top: 0.4rem;
      border: 1px solid var(--border-color);
      border-radius: 6px;
      cursor: pointer;
    }

    .pick:has(input:checked) {
      border-color: var(--color-info);
      background: color-mix(in srgb, var(--color-info) 12%, transparent);
    }

    .pick input {
      margin-top: 0.25rem;
    }

    .pick .help {
      display: block;
      font-size: var(--font-ui-small);
      color: var(--text-secondary);
    }

    .duplicate-actions .btn {
      flex: 1;
      font-size: var(--font-ui-small);
    }

    details.songselect {
      margin-top: 1.5rem;
    }

    details.songselect summary {
      cursor: pointer;
      font-size: var(--font-ui);
      color: var(--text-color);
    }

    details.songselect songselect-help {
      margin-top: 1rem;
    }

    .choices {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }

    .choice {
      position: relative;
      display: flex;
      align-items: center;
      gap: 1.5rem;
      padding: 1.5rem;
      background: var(--bg-color, white);
      color: var(--text-color);
      border: 2px solid var(--border-light, #ecf0f1);
      border-radius: 12px;
      font: inherit;
      text-align: left;
      width: 100%;
      box-sizing: border-box;
    }

    button.choice,
    label.choice,
    a.choice {
      cursor: pointer;
      transition:
        border-color 0.2s,
        background-color 0.2s;
    }

    a.choice {
      text-decoration: none;
    }

    label.choice:focus-within {
      outline: 2px solid var(--button-bg);
    }

    /* The whole label opens the picker; the input itself stays reachable by
       keyboard and screen readers */
    label.choice input {
      position: absolute;
      opacity: 0;
      width: 1px;
      height: 1px;
    }

    textarea {
      display: block;
      width: 100%;
      box-sizing: border-box;
      margin: 0.5rem 0;
      padding: 0.5rem 0.75rem;
      font-family: monospace;
      font-size: var(--font-ui-small);
      border: 2px solid var(--border-light, #ecf0f1);
      border-radius: 6px;
      background-color: var(--bg-secondary, #f8f9fa);
      color: var(--text-color);
      resize: vertical;
    }

    textarea:focus {
      outline: none;
      border-color: var(--button-bg);
    }

    .songs {
      margin: 0 0 1.5rem;
      padding-left: 1.5rem;
    }

    .songs li {
      margin-bottom: 0.25rem;
    }

    .songs .subtitle {
      display: inline;
    }

    /* what came of an import that had nothing to do: the result, so as big as the title */
    .already {
      margin: -0.75rem 0 1.25rem;
      font-size: var(--font-ui);
      font-weight: 700;
    }

    .songs-summary {
      margin: 0 0 0.5rem;
    }

    .songs-detail {
      margin-bottom: 1.5rem;
    }

    .songs-detail summary {
      cursor: pointer;
    }

    .bulk-picks {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.5rem;
      margin: 0.75rem 0;
    }

    .bookmarklet-wait {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 1rem;
      padding: 3rem 1rem;
      text-align: center;
    }

    .bookmarklet-wait .spinner {
      width: 2rem;
      height: 2rem;
    }

    .range {
      margin: 0.25rem 0;
      font-size: var(--font-ui-small);
      color: var(--text-secondary);
    }

    .range-set {
      margin: 0.25rem 0 0.5rem;
      font-size: var(--font-ui-small);
    }

    .range-set summary {
      cursor: pointer;
      color: var(--text-secondary);
    }

    .range-set .range-editor {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-end;
      gap: 1rem;
      margin: 0.5rem 0;
    }

    .range-picker {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }

    .range-picker select {
      min-height: 2.5rem;
      padding: 0 0.5rem;
      font: inherit;
      font-size: var(--font-ui);
    }

    /* (the danger colour, mixed toward the text colour: it reads on the light page and on the dark) */
    .range-error {
      color: color-mix(in srgb, var(--color-danger, #e74c3c) 65%, var(--text-color, #1a1a1a));
    }

    .range-how {
      margin: 0.25rem 0 0.5rem;
      font-size: var(--font-ui-small);
      color: var(--text-secondary);
    }

    .range-how ul {
      margin: 0.25rem 0;
      padding-left: 1.25rem;
    }

    .status.error + .duplicate,
    .status.error + .choices {
      margin-top: 1rem;
    }

    .duplicate ul {
      list-style: none;
      margin: 0 0 1rem;
      padding: 0;
    }

    .duplicate li {
      padding: 0.5rem 0;
      border-bottom: 1px solid var(--border-color);
    }

    .label-field {
      display: block;
      margin: 0.5rem 0;
      font-size: var(--font-ui-small);
    }

    .label-field input {
      display: block;
      width: 100%;
      box-sizing: border-box;
      margin-top: 0.25rem;
      padding: 0.4rem 0.6rem;
      font: inherit;
      border: 2px solid var(--border-light, #ecf0f1);
      border-radius: 6px;
      background-color: var(--bg-secondary, #f8f9fa);
      color: var(--text-color);
    }

    .verdict {
      margin: 0.25rem 0;
    }

    .duplicate details {
      margin: 0.5rem 0;
    }

    .duplicate li button {
      padding: 0.4rem 0.75rem;
    }

    button.choice:hover,
    label.choice:hover,
    a.choice:hover {
      background: var(--bg-secondary, #f8f9fa);
      border-color: var(--button-bg);
    }

    .icon,
    .title,
    .subtitle {
      display: block;
    }

    .icon {
      font-size: var(--font-ui);
      flex-shrink: 0;
    }

    .content {
      flex: 1;
      min-width: 0;
    }

    .title {
      font-size: var(--font-ui-small);
      font-weight: 600;
      margin-bottom: 0.25rem;
    }

    .subtitle {
      font-size: var(--font-ui-small);
      color: var(--text-secondary, #5f6b6d);
    }

    .setlist-picker {
      display: flex;
      gap: 0.5rem;
      margin-top: 0.5rem;
    }

    select {
      flex: 1;
      min-width: 0;
      padding: 0.5rem 0.75rem;
      font-size: var(--font-ui-small);
      border: 2px solid var(--border-light, #ecf0f1);
      border-radius: 6px;
      background-color: var(--bg-secondary, #f8f9fa);
      color: var(--text-color);
    }

    select:focus {
      outline: none;
      border-color: var(--button-bg);
    }

    .add {
      padding: 0.5rem 1.25rem;
      font-size: var(--font-ui-small);
    }
  `,
]
