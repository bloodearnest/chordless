import { LitElement, html, css } from 'lit';

/**
 * MediaPlayerSettings Component
 *
 * Global settings for the media player functionality.
 * Controls which features are enabled/disabled globally.
 *
 * Properties:
 * @property {Boolean} mediaPlayerEnabled - Master enable/disable for all media player features
 * @property {Boolean} padsEnabled - Enable/disable pad audio playback
 * @property {Boolean} metronomeEnabled - Enable/disable metronome/click track
 * @property {Boolean} stereoSplitEnabled - Enable L/R channel split (pads left, click right)
 *
 * Events:
 * @fires settings-change - When any setting changes
 */
export class MediaPlayerSettings extends LitElement {
    static properties = {
        mediaPlayerEnabled: { type: Boolean, state: true },
        padsEnabled: { type: Boolean, state: true },
        metronomeEnabled: { type: Boolean, state: true },
        stereoSplitEnabled: { type: Boolean, state: true }
    };

    static styles = css`
        :host {
            display: block;
        }

        .container {
            background: var(--settings-bg, #34495e);
            border-radius: 8px;
            padding: 1.5rem;
            color: var(--settings-text, white);
        }

        h2 {
            margin: 0 0 1rem 0;
            font-size: 1.2rem;
            font-weight: 600;
            color: var(--settings-text, white);
        }

        .setting-group {
            margin-bottom: 1.5rem;
        }

        .setting-group:last-child {
            margin-bottom: 0;
        }

        .setting-item {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 0.75rem;
            background: rgba(255, 255, 255, 0.05);
            border-radius: 4px;
            margin-bottom: 0.5rem;
        }

        .setting-item:last-child {
            margin-bottom: 0;
        }

        .setting-item.disabled {
            opacity: 0.5;
            pointer-events: none;
        }

        .setting-item.indent {
            margin-left: 1.5rem;
            background: rgba(255, 255, 255, 0.03);
        }

        .setting-label {
            font-size: 1rem;
            font-weight: 500;
        }

        .setting-description {
            font-size: 0.85rem;
            opacity: 0.7;
            margin-top: 0.25rem;
        }

        .toggle-switch {
            position: relative;
            width: 50px;
            height: 28px;
            background: rgba(0, 0, 0, 0.3);
            border-radius: 14px;
            cursor: pointer;
            transition: background 0.2s;
        }

        .toggle-switch.active {
            background: #3498db;
        }

        .toggle-switch::after {
            content: '';
            position: absolute;
            top: 2px;
            left: 2px;
            width: 24px;
            height: 24px;
            background: white;
            border-radius: 50%;
            transition: transform 0.2s;
        }

        .toggle-switch.active::after {
            transform: translateX(22px);
        }

        .master-toggle {
            background: rgba(0, 0, 0, 0.3);
        }

        .master-toggle.active {
            background: #27ae60;
        }
    `;

    constructor() {
        super();

        // Load settings from localStorage
        const savedSettings = localStorage.getItem('setalight-media-settings');

        if (savedSettings) {
            const settings = JSON.parse(savedSettings);
            this.mediaPlayerEnabled = settings.mediaPlayerEnabled !== false; // Default true
            this.padsEnabled = settings.padsEnabled !== false; // Default true
            this.metronomeEnabled = settings.metronomeEnabled !== false; // Default true
            this.stereoSplitEnabled = settings.stereoSplitEnabled === true; // Default false
        } else {
            // Defaults
            this.mediaPlayerEnabled = true;
            this.padsEnabled = true;
            this.metronomeEnabled = true;
            this.stereoSplitEnabled = false;
        }
    }

    _saveSettings() {
        const settings = {
            mediaPlayerEnabled: this.mediaPlayerEnabled,
            padsEnabled: this.padsEnabled,
            metronomeEnabled: this.metronomeEnabled,
            stereoSplitEnabled: this.stereoSplitEnabled
        };

        localStorage.setItem('setalight-media-settings', JSON.stringify(settings));

        // Dispatch event so media player can react
        this.dispatchEvent(new CustomEvent('settings-change', {
            detail: settings,
            bubbles: true,
            composed: true
        }));
    }

    _toggleMediaPlayer() {
        this.mediaPlayerEnabled = !this.mediaPlayerEnabled;
        this._saveSettings();
    }

    _togglePads() {
        this.padsEnabled = !this.padsEnabled;
        this._saveSettings();
    }

    _toggleMetronome() {
        this.metronomeEnabled = !this.metronomeEnabled;
        this._saveSettings();
    }

    _toggleStereoSplit() {
        this.stereoSplitEnabled = !this.stereoSplitEnabled;
        this._saveSettings();
    }

    render() {
        return html`
            <div class="container">
                <h2>🎵 Media Player Settings</h2>

                <!-- Master toggle -->
                <div class="setting-group">
                    <div class="setting-item">
                        <div>
                            <div class="setting-label">Enable Media Player</div>
                            <div class="setting-description">Master control for all media player features</div>
                        </div>
                        <div
                            class="toggle-switch master-toggle ${this.mediaPlayerEnabled ? 'active' : ''}"
                            @click=${this._toggleMediaPlayer}
                        ></div>
                    </div>
                </div>

                <!-- Pads settings -->
                <div class="setting-group">
                    <div class="setting-item ${!this.mediaPlayerEnabled ? 'disabled' : ''}">
                        <div>
                            <div class="setting-label">Enable Pads</div>
                            <div class="setting-description">Background pad audio playback</div>
                        </div>
                        <div
                            class="toggle-switch ${this.padsEnabled ? 'active' : ''}"
                            @click=${this._togglePads}
                        ></div>
                    </div>
                </div>

                <!-- Metronome settings -->
                <div class="setting-group">
                    <div class="setting-item ${!this.mediaPlayerEnabled ? 'disabled' : ''}">
                        <div>
                            <div class="setting-label">Enable Metronome</div>
                            <div class="setting-description">Click track with tempo and time signature</div>
                        </div>
                        <div
                            class="toggle-switch ${this.metronomeEnabled ? 'active' : ''}"
                            @click=${this._toggleMetronome}
                        ></div>
                    </div>

                    <!-- Stereo split (only when metronome enabled) -->
                    <div class="setting-item indent ${!this.mediaPlayerEnabled || !this.metronomeEnabled ? 'disabled' : ''}">
                        <div>
                            <div class="setting-label">Stereo Split (L/R)</div>
                            <div class="setting-description">Pads → Left, Click → Right</div>
                        </div>
                        <div
                            class="toggle-switch ${this.stereoSplitEnabled ? 'active' : ''}"
                            @click=${this._toggleStereoSplit}
                        ></div>
                    </div>
                </div>
            </div>
        `;
    }
}

// Define the custom element
customElements.define('media-player-settings', MediaPlayerSettings);
