import { LitElement, html } from 'lit';
import {
  convertChordToNashville,
  isNashvilleChord,
  transposeChordBySemitones,
} from '../js/transpose.js';
import { convertAccidentalsToSymbols, isBarMarker } from '../js/utils/chord-utils.js';
import { getUseUnicodeAccidentals } from '../js/preferences.js';
import { splitChordDisplaySegments } from '../js/utils/lyrics-normalizer.js';

/**
 * Small utility component that renders a chord with optional extensions.
 * Keeps extension markup consistent across all chord displays.
 */
export class ChordDisplay extends LitElement {
  static properties = {
    chord: { type: String },
    invalid: { type: Boolean, reflect: true },
    displayAsNashville: { type: Boolean, attribute: 'display-as-nashville' },
    displayKey: { type: String, attribute: 'display-key' },
    useUnicodeAccidentals: { type: Boolean, state: true },
    capo: { type: Number },
    capoKey: { type: String, attribute: 'capo-key' },
  };

  constructor() {
    super();
    this.chord = '';
    this.invalid = false;
    this.displayAsNashville = false;
    this.displayKey = '';
    this.useUnicodeAccidentals = getUseUnicodeAccidentals();
    this.capo = 0;
    this.capoKey = '';
    this._onAccidentalPreferenceChange = event => {
      this.useUnicodeAccidentals = !!event.detail;
      this.requestUpdate();
    };
  }

  createRenderRoot() {
    // Render into light DOM so existing chord styles continue to apply
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener('accidental-preference-changed', this._onAccidentalPreferenceChange);
  }

  disconnectedCallback() {
    window.removeEventListener('accidental-preference-changed', this._onAccidentalPreferenceChange);
    super.disconnectedCallback();
  }

  render() {
    const text = this._getDisplayText();
    if (!text) {
      return html``;
    }
    if (isBarMarker(text)) {
      return html`${text}`;
    }
    const segments = this._buildSegments(text);
    if (!segments.length) {
      return html`${text}`;
    }
    return html`${segments.map(segment => {
      const value = this.useUnicodeAccidentals
        ? convertAccidentalsToSymbols(segment.value)
        : segment.value;
      return segment.type === 'extension'
        ? html`<sup class="chord-extension">${value}</sup>`
        : value;
    })}`;
  }

  _getDisplayText() {
    if (!this.chord) return '';
    if (this.displayAsNashville && this.displayKey) {
      return convertChordToNashville(this.chord, this.displayKey);
    }
    const capoShift = this._getCapoShift();
    if (capoShift !== 0) {
      const result = transposeChordBySemitones(this.chord, capoShift, this.capoKey || null);
      if (result?.chord) {
        return result.chord;
      }
    }
    return this.chord;
  }

  _getCapoShift() {
    const capoValue = Number.isFinite(this.capo) ? Math.round(this.capo) : 0;
    if (capoValue <= 0) {
      return 0;
    }
    return -Math.min(capoValue, 11);
  }

  _buildSegments(text) {
    if (isNashvilleChord(text)) {
      return this._buildNashvilleSegments(text);
    }
    return this._buildStandardSegments(text);
  }

  _buildStandardSegments(text) {
    const segments = splitChordDisplaySegments(text);
    if (!segments.length) {
      return [{ type: 'base', value: text }];
    }
    return segments;
  }

  _buildNashvilleSegments(text) {
    let trimmed = text.trim();
    let prefix = '';
    let suffix = '';
    if (trimmed.startsWith('(') && trimmed.endsWith(')') && trimmed.length > 2) {
      prefix = '(';
      suffix = ')';
      trimmed = trimmed.slice(1, -1);
    }

    const [main, bass] = trimmed.split('/');
    const segments = [];

    if (prefix) {
      segments.push({ type: 'base', value: prefix });
    }

    segments.push(...this._buildNashvilleCore(main));

    if (bass) {
      segments.push({ type: 'base', value: '/' });
      segments.push(...this._buildNashvilleCore(bass));
    }

    if (suffix) {
      segments.push({ type: 'base', value: suffix });
    }

    return segments;
  }

  _buildNashvilleCore(value) {
    const match = value.match(/^([#b♯♭]?)([1-7])(.*)$/);
    if (!match) {
      return [{ type: 'base', value }];
    }
    const [, accidental = '', degree, extension = ''] = match;
    const segments = [{ type: 'base', value: `${accidental}${degree}` }];
    if (extension) {
      segments.push(...this._splitExtensionSegments(extension));
    }
    return segments;
  }

  _splitExtensionSegments(extensionText) {
    const mockChord = `C${extensionText}`;
    const parsed = splitChordDisplaySegments(mockChord);
    if (!parsed.length) {
      return [{ type: 'extension', value: extensionText }];
    }
    return parsed.slice(1);
  }
}

customElements.define('chord-display', ChordDisplay);
