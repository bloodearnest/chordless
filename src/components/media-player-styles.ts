import { css } from 'lit'

/** The media player's own styles */
export const mediaPlayerStyles = css`
  :host {
    display: inline-block;
    /*
     * The host keeps its box where the player is by default: dragging moves the player
     * with a transform, which moves nothing of the layout. Left to take pointer events, that
     * empty box would sit over the page. Only the player itself (and the settings modal) do.
     */
    pointer-events: none;
  }

  .player,
  .collapsed-pill,
  app-modal {
    pointer-events: auto;
  }

  .player {
    background: var(--player-bg, #34495e);
    border-radius: 10px;
    color: var(--player-text, white);
    width: fit-content;
    animation: fadeIn 0.2s ease-in-out;
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  .title-bar {
    display: flex;
    align-items: stretch;
    justify-content: space-between;
    background: rgba(0, 0, 0, 0.2);
    border-radius: 10px 10px 0 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    cursor: move;
    user-select: none;
  }

  .title-bar-content {
    flex: 1;
    font-size: var(--font-ui);
    font-weight: 500;
    opacity: 0.8;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    padding: 0.25rem 0.5rem;
    display: flex;
    align-items: center;
  }

  .title-bar-buttons {
    display: flex;
    gap: 0;
    flex-shrink: 0;
  }

  .title-bar-button {
    width: 3rem;
    height: auto;
    border-radius: 0;
    border: none;
    border-left: 3px solid rgba(255, 255, 255, 0.1);
    background: transparent;
    color: var(--player-text, white);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: var(--font-icon);
    opacity: 0.7;
    transition:
      opacity 0.2s,
      background 0.2s;
    padding: 0;
    line-height: 1;
  }

  .title-bar-button:last-child {
    border-radius: 0 10px 0 0;
  }

  .title-bar-button:hover {
    opacity: 1;
    background: rgba(255, 255, 255, 0.1);
  }

  .title-bar-button:active {
    background: rgba(255, 255, 255, 0.2);
  }

  .container {
    display: grid;
    grid-template-columns: auto 1px auto;
    grid-template-rows: auto auto;
    column-gap: 0.5rem;
    row-gap: 0.8rem;
    padding: 1rem;
  }

  .divider {
    grid-column: 2;
    grid-row: 1 / -1;
    width: 1px;
  }

  .led-display-section {
    grid-column: 1;
    grid-row: 1;
  }

  .play-stop-section {
    grid-column: 1;
    grid-row: 2;
  }

  .knobs-section {
    grid-column: 3;
    grid-row: 1;
    display: flex;
    height: 100%;
  }

  .toggles-section {
    grid-column: 3;
    grid-row: 2;
  }

  .transport-row {
    display: flex;
    align-items: center;
    gap: 0;
  }

  .cassette-buttons {
    display: flex;
    gap: 0;
    width: 100%;
    box-sizing: border-box;
  }

  .cassette-buttons .play-button {
    border-top-right-radius: 0;
    border-bottom-right-radius: 0;
  }

  .cassette-buttons .stop-button {
    border-top-left-radius: 0;
    border-bottom-left-radius: 0;
    margin-left: -2px;
  }

  .cassette-buttons .stop-button:not(:last-child) {
    border-top-right-radius: 0;
    border-bottom-right-radius: 0;
  }

  .cassette-buttons .led-button {
    border-top-left-radius: 0;
    border-bottom-left-radius: 0;
    margin-left: -2px;
  }

  .cassette-buttons .led-button.middle {
    border-top-right-radius: 0;
    border-bottom-right-radius: 0;
  }

  .toggles-section .cassette-buttons {
    gap: 1rem;
  }

  .toggles-section .cassette-buttons .led-button {
    border-radius: 4px;
    margin-left: 0;
  }

  .toggles-section .cassette-buttons .led-button.middle {
    border-radius: 4px;
  }

  .knobs-row {
    display: flex;
    align-items: stretch;
    gap: 1rem;
    height: 100%;
  }

  .led-display {
    display: grid;
    grid-template-columns: auto auto auto;
    gap: 0.1rem 0.5rem;
    background: #1a1a1a;
    border: 2px solid var(--player-text, white);
    border-radius: 4px;
    padding: 0.25rem 0.5rem;
    font-family: 'Courier New', monospace;
    box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.5);
    width: 100%;
    box-sizing: border-box;
    font-size: var(--font-icon);
    color: #00ff00;
    text-shadow:
      0 0 3px #00ff00,
      0 0 6px #00ff00;
  }

  .led-label {
    opacity: 0.5;
    text-align: right;
  }

  .led-value {
    text-align: center;
  }

  .led-value.pad-error {
    color: #ff5c5c;
    text-shadow:
      0 0 3px #ff5c5c,
      0 0 6px #ff5c5c;
    font-weight: 700;
  }

  .led-value.status-downloading {
    color: #ffd479;
    animation: pad-download-blink 1s linear infinite;
    font-weight: 700;
  }

  @keyframes pad-download-blink {
    0% {
      opacity: 1;
    }
    50% {
      opacity: 0.25;
    }
    100% {
      opacity: 1;
    }
  }

  .led-header {
    text-transform: uppercase;
    font-weight: 600;
  }

  .play-button {
    width: 5.4rem;
    height: 3.6rem;
    border-radius: 4px;
    border: 2px solid var(--player-text, white);
    background: transparent;
    color: var(--player-text, white);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: var(--font-icon);
    line-height: 1;
    box-sizing: border-box;
    transition: all 0.2s;
    outline: none;
  }

  .play-button:active {
    background: rgba(255, 255, 255, 0.2);
  }

  .play-button.playing {
    background: rgba(0, 0, 0, 0.3);
    box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.5);
  }

  .play-button:disabled {
    cursor: not-allowed;
    background: transparent;
  }

  .play-button:disabled:active {
    background: transparent;
  }

  .play-button.playing:disabled {
    background: rgba(0, 0, 0, 0.3);
    box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.5);
  }

  .play-button.playing:disabled:active {
    background: rgba(0, 0, 0, 0.3);
    box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.5);
  }

  .stop-button {
    width: 5.4rem;
    height: 3.6rem;
    border-radius: 4px;
    border: 2px solid var(--player-text, white);
    background: transparent;
    color: var(--player-text, white);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: var(--font-icon);
    line-height: 1;
    box-sizing: border-box;
    transition: all 0.2s;
    outline: none;
  }

  .stop-button:active {
    background: rgba(255, 255, 255, 0.2);
  }

  .stop-button:disabled {
    cursor: not-allowed;
    background: transparent;
  }

  .stop-button:disabled:active {
    background: transparent;
  }

  .toggle-button {
    width: 3.6rem;
    height: 3.6rem;
    border-radius: 50%;
    border: 2px solid var(--player-text, white);
    background: transparent;
    color: var(--player-text, white);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: var(--font-icon);
    font-weight: 600;
    line-height: 1;
    box-sizing: border-box;
    transition: all 0.2s;
  }

  .toggle-button:active {
    background: rgba(255, 255, 255, 0.2);
  }

  .toggle-button.active {
    background: rgba(0, 0, 0, 0.3);
    box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.5);
  }

  .metronome-button {
    width: 3.6rem;
    height: 3.6rem;
    border-radius: 50%;
    border: 2px solid var(--player-text, white);
    background: transparent;
    color: var(--player-text, white);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: var(--font-ui);
    line-height: 1;
    padding-left: 1.8rem;
    padding-bottom: 0.12rem;
    box-sizing: border-box;
    transition: all 0.2s;
  }

  .metronome-button:active {
    background: rgba(255, 255, 255, 0.2);
  }

  .metronome-button.active {
    background: rgba(0, 0, 0, 0.3);
    box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.5);
  }

  .split-button {
    width: 3.6rem;
    height: 3.6rem;
    border-radius: 50%;
    border: 2px solid var(--player-text, white);
    background: transparent;
    color: var(--player-text, white);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: var(--font-icon);
    line-height: 1;
    box-sizing: border-box;
    transition: all 0.2s;
  }

  .split-button:active {
    background: rgba(255, 255, 255, 0.2);
  }

  .split-button.active {
    background: rgba(0, 0, 0, 0.3);
    box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.5);
  }

  .volume-knob {
    position: relative;
    width: 3.9rem;
    height: 3.9rem;
    border-radius: 50%;
    border: 2px solid var(--player-text, white);
    background: linear-gradient(135deg, rgba(255, 255, 255, 0.1) 0%, rgba(0, 0, 0, 0.2) 100%);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    user-select: none;
    touch-action: none;
    box-sizing: border-box;
    transition: all 0.2s;
    box-shadow:
      inset 0 1px 2px rgba(255, 255, 255, 0.2),
      inset 0 -1px 2px rgba(0, 0, 0, 0.3);
  }

  .volume-knob.dragging {
    background: linear-gradient(135deg, rgba(255, 255, 255, 0.2) 0%, rgba(0, 0, 0, 0.1) 100%);
  }

  .volume-indicator {
    position: absolute;
    top: 0.25rem;
    width: 2px;
    height: 0.5rem;
    background: var(--player-text, white);
    border-radius: 1px;
    transform-origin: center 1.7rem; /* the knob's centre: half its height, less the top */
    transition: transform 0.1s;
  }

  .volume-value {
    font-size: var(--font-icon);
    font-weight: 600;
    color: var(--player-text, white);
    z-index: 1;
  }

  .led-button {
    width: 3.6rem;
    height: 3.6rem;
    border-radius: 4px;
    border: 2px solid var(--player-text, white);
    background: transparent;
    color: var(--player-text, white);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    transition: all 0.2s;
    position: relative;
    outline: none;
  }

  .led-button:active {
    background: rgba(255, 255, 255, 0.2);
  }

  .led-button.active {
    background: rgba(0, 0, 0, 0.3);
    box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.5);
  }

  /* The transport is as wide as the display above, less the 2× button at its right edge,
     which reaches towards the click's buttons (it is a click setting) and away from Stop */
  .play-stop-section {
    display: flex;
    align-items: stretch;
  }

  .play-stop-section .cassette-buttons {
    flex: 1 1 0;
    min-width: 0;
  }

  .play-stop-section .cassette-buttons .play-button,
  .play-stop-section .cassette-buttons .stop-button {
    flex: 1 1 0;
    min-width: 0;
    width: auto;
  }

  .speed-button {
    flex: 0 0 3.6rem;
    margin-left: 1.1rem;
    margin-right: -0.75rem;
  }

  .speed-button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .led-button {
    flex-direction: column;
    gap: 0.3rem;
  }

  .led-caption {
    font-size: var(--font-ui-small);
    font-weight: 600;
    line-height: 1;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    opacity: 0.8;
  }

  .led-light {
    width: 1.6rem;
    height: 1.6rem;
    border-radius: 50%;
    border: 1px solid var(--player-text, white);
    background: rgba(255, 255, 255, 0.1);
    transition: all 0.2s;
    box-shadow: inset 0 0 3px rgba(0, 0, 0, 0.3);
  }

  .led-light.pads-on {
    background: #27ae60;
    border-color: #27ae60;
    box-shadow:
      0 0 6px rgba(39, 174, 96, 0.8),
      inset 0 0 3px rgba(0, 0, 0, 0.3);
  }

  .led-light.click-on {
    background: #3498db;
    border-color: #3498db;
    box-shadow:
      0 0 6px rgba(52, 152, 219, 0.8),
      inset 0 0 3px rgba(0, 0, 0, 0.3);
  }

  .button-group {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.3rem;
  }

  .button-info {
    font-size: var(--font-icon);
    color: var(--player-text, white);
    opacity: 0.6;
    text-align: center;
  }

  .knob-column {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: space-evenly;
    width: 3.6rem;
    height: 100%;
  }

  .knob-label {
    font-size: var(--font-icon);
    font-weight: 600;
    color: var(--player-text, white);
    opacity: 0.7;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .collapsed-pill {
    display: flex;
    height: 4rem;
    border-radius: 2rem;
    overflow: hidden;
    background: rgba(52, 73, 94, 0.4);
    -webkit-backdrop-filter: blur(4px);
    backdrop-filter: blur(4px);
    animation: fadeIn 0.2s ease-in-out;
  }

  .pill-button {
    width: 3.5rem;
    border: 0;
    background: transparent;
    color: var(--player-text, white);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    line-height: 1;
    transition: background 0.2s;
  }

  /* The play side is the main target. A triangle's weight is at its base, so it sits right of
     centre to look centred, and the pill's round end takes some of the room on the left */
  .pill-button:first-child {
    width: 4.5rem;
    padding-left: 0.6rem;
  }

  .pill-button + .pill-button {
    border-left: 1px solid rgba(255, 255, 255, 0.25);
  }

  .pill-button:active:not(:disabled) {
    background: rgba(52, 73, 94, 0.8);
  }

  .pill-button:disabled {
    opacity: 0.35;
    cursor: default;
  }

`
