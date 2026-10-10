import { css } from 'lit'

/**
 * Styles shared by components, to add to their static styles:
 *
 *   static styles = [panelStyles, buttonStyles, css`...`]
 *
 * Colours come from theme tokens (theme-manager.js), and subtle backgrounds
 * from the --tint-* tokens (style.css), which follow the text colour, so all
 * of these work in light and dark themes.
 */

/** A settings panel: <div class="panel"><h3>Title</h3><p>What it's for</p>...</div> */
export const panelStyles = css`
  .panel {
    background: var(--panel-bg, #f5f6f7);
    border: 1px solid var(--panel-border, transparent);
    border-radius: 8px;
    padding: 1.5rem;
    color: var(--text-color, #1a1a1a);
  }

  .panel h3 {
    font-size: var(--font-ui-small);
    font-weight: 600;
    margin: 0 0 1rem;
  }

  .panel p {
    font-size: var(--font-ui-small);
    line-height: 1.4;
    margin: 0 0 1rem;
    opacity: 0.75;
  }
`

/**
 * Buttons: <button class="btn">, plus .primary, .danger or .success, and .block
 * for full width.
 */
export const buttonStyles = css`
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 0.75rem 1.5rem;
    border: none;
    border-radius: 4px;
    background: var(--tint);
    color: inherit;
    font: inherit;
    font-size: var(--font-ui);
    font-weight: 600;
    cursor: pointer;
    transition: background 0.2s;
  }

  .btn:hover:not(:disabled) {
    background: var(--tint-strong);
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn:focus-visible {
    outline: 2px solid var(--focus-ring, #3498db);
    outline-offset: 2px;
  }

  .btn.primary {
    background: var(--button-bg, #2477ad);
    color: var(--button-text, white);
  }

  .btn.primary:hover:not(:disabled) {
    background: var(--button-hover, #1f6a9a);
  }

  .btn.danger {
    background: color-mix(in srgb, var(--color-danger, #e74c3c) 20%, transparent);
  }

  .btn.danger:hover:not(:disabled) {
    background: color-mix(in srgb, var(--color-danger, #e74c3c) 30%, transparent);
  }

  .btn.success {
    background: color-mix(in srgb, var(--color-success, #27ae60) 20%, transparent);
  }

  .btn.success:hover:not(:disabled) {
    background: color-mix(in srgb, var(--color-success, #27ae60) 30%, transparent);
  }

  .btn.block {
    width: 100%;
  }
`

/** Text inputs and selects: <input class="field">, <select class="field"> */
export const fieldStyles = css`
  .field {
    box-sizing: border-box;
    width: 100%;
    padding: 0.6rem 0.75rem;
    border: 1px solid var(--border-color, #d5dbdb);
    border-radius: 4px;
    background: var(--bg-color, white);
    color: var(--text-color, #1a1a1a);
    font: inherit;
    font-size: var(--font-ui);
  }

  .field::placeholder {
    color: var(--text-secondary, #5f6b6d);
  }

  .field:focus {
    outline: none;
    border-color: var(--focus-ring, #3498db);
  }
`

/**
 * An on/off switch: <button role="switch" class="toggle-switch"> with .active
 * when on. Add .master for the green one that turns a whole feature on.
 */
export const switchStyles = css`
  .toggle-switch {
    position: relative;
    flex-shrink: 0;
    width: 50px;
    height: 28px;
    padding: 0;
    border: none;
    border-radius: 14px;
    background: var(--tint-border);
    cursor: pointer;
    transition: background 0.2s;
  }

  .toggle-switch::after {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: white;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
    transition: transform 0.2s;
  }

  .toggle-switch:focus-visible {
    outline: 2px solid var(--focus-ring, #3498db);
    outline-offset: 2px;
  }

  .toggle-switch:disabled {
    cursor: not-allowed;
  }

  .toggle-switch.active {
    background: var(--button-bg, #2477ad);
  }

  .toggle-switch.master.active {
    background: var(--color-success, #27ae60);
  }

  .toggle-switch.active::after {
    transform: translateX(22px);
  }
`

/** A spinner in the current text colour: <span class="spinner"></span> */
export const spinnerStyles = css`
  .spinner {
    display: inline-block;
    width: 1em;
    height: 1em;
    border: 2px solid var(--tint-border);
    border-top-color: currentColor;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
`
