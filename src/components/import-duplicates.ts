/**
 * The songs of an import that the library has already (song-import.ts): how each compares with the
 * library's chart, what is suggested, and the choice of what to do with it.
 */
import { html, type TemplateResult } from 'lit'
import type { SongRecord } from '../js/data-types.ts'
import type { KeptMelody, LeadSheetOutcome, MelodyRead } from '../js/lead-sheet.ts'
import type { ChartComparison } from '../js/library-repair.ts'
import { describeOrigin, SONGSELECT } from '../js/song-source.ts'
import type { ChartLabel } from './chart-diff.ts'

/**
 * What to do with a chart of a song the library has: import it as the original (the library's
 * chart becomes a variant), import it as a variant (the library's stays the original), update
 * the library's chart with it, or not import it
 */
export type DuplicateChoice = 'as-original' | 'as-variant' | 'update' | 'use-existing'

/** A song that was imported, and what to do if it was already in the library */
export interface ImportItem {
  song: SongRecord
  chordproText: string
  isDuplicate: boolean
  choice: DuplicateChoice | null
  /** The library's chart, for a duplicate */
  existingText?: string
  /** How the chart compares with the one the library has, for a duplicate */
  comparison?: ChartComparison
  /** What is picked, not yet done: set when it is read, to the suggestion */
  pick?: DuplicateChoice | null
  /** The name of the chart that becomes a variant: the library's if imported as the original, else the imported one */
  label?: string
  /** The same chart as the library's, which only said it was a file: its source is now SongSelect */
  sourceSet?: boolean
  /** The same song as the library's: it was updated with no question asked */
  auto?: boolean
  /** Its range was set by the person, not read from a lead sheet */
  rangeSetByHand?: boolean
  /** What came of the lead sheet that came with it, if one did */
  leadSheet?: LeadSheetOutcome
  /** What was read from it, to show how */
  melody?: MelodyRead
  /** Its whole melody, in the chart's key, to be kept with the song the chart goes to (docs/LEAD_SHEETS.md) */
  notes?: KeptMelody
  /** Whether it was saved just now (a new song's); undefined while it waits on a choice about a song the library has */
  melodySaved?: boolean
  /** Where the chart came from, and who is importing it */
  source?: string
  importUser?: string
  /** The key to play it in when added to a setlist (a shared chart's), else the song's own */
  key?: string | null
}

/** What the page does when a choice is made: song-import's own */
export interface DuplicateActions {
  pick(item: ImportItem, pick: DuplicateChoice): void
  pickAll(pick: DuplicateChoice): void
  apply(items: ImportItem[]): void
  /** What the page says of the song's range */
  range(item: ImportItem): TemplateResult | string
}

/** What came of a song, as the list of them says */
export function statusOf(item: ImportItem): string {
  const status: Record<string, string> = {
    update: 'updated',
    'as-original': 'imported as the original',
    'as-variant': 'imported as a variant',
    'use-existing': 'not imported',
  }
  if (!item.isDuplicate) return 'new'
  if (item.auto && item.choice === 'update') return 'updated: the same song as in your library'
  if (item.comparison?.verdict === 'identical') {
    return `identical version already in library${item.sourceSet ? ', now recorded as from SongSelect' : ''}`
  }
  return (item.choice && status[item.choice]) || 'already in library'
}

/** A song the library has, with a choice to be made for it (not one that is being updated with no question) */
export function isUnresolved(item: ImportItem): boolean {
  return item.isDuplicate && !item.choice && !item.auto
}

/** Which choice to lead with, from how the charts differ; none when the words differ */
export function suggested(item: ImportItem): DuplicateChoice | null {
  switch (item.comparison?.verdict) {
    case 'different-chords':
      return 'as-variant'
    case 'same-chart':
    case 'other-key':
      // (the same song, which is updated with no question unless the library's chart is the
      // better authority: so what is asked about is whether to replace it)
      return 'use-existing'
    default:
      return null
  }
}

/**
 * Whether a song the library has is updated with no question: it is the same song (the same
 * words and chords, whatever else differs, even the key), and the chart coming is no less the
 * authority than the library's: a chart from SongSelect is not replaced by one that is not
 */
export function updatesWithoutAsking(item: ImportItem): boolean {
  const verdict = item.comparison?.verdict
  const sameSong = verdict === 'same-chart' || verdict === 'other-key'
  const lesser = item.song.importSource === SONGSELECT && item.source !== SONGSELECT
  return sameSong && !lesser
}

/** One song the library has: how the charts compare, and what to do. `alone`: the page is about this one song, so it says its range here (a list of songs does) */
function renderDuplicate(item: ImportItem, index: number, alone: boolean, on: DuplicateActions) {
  const { comparison } = item
  /* v8 ignore next -- every duplicate is given its comparison when it is read */
  const verdict = comparison?.verdict ?? 'different-words'
  const sentence = {
    identical: 'The same song.',
    'same-chart': 'The same words and chords, with other details.',
    'other-key': 'The same song in another key.',
    'different-chords': 'The same words, with different chords.',
    'different-words': 'Different words: another version or arrangement.',
  }[verdict]
  // (the library's chart, and the imported one)
  const charts: [string, string] = [item.existingText as string, item.chordproText]
  const labels: [ChartLabel, ChartLabel] = [
    { heading: 'In your library', detail: describeOrigin(item.song) },
    {
      heading: 'Importing',
      detail: describeOrigin({
        importUser: item.importUser,
        importDate: new Date().toISOString(),
        importSource: item.source,
      }),
    },
  ]
  const options: { value: DuplicateChoice; title: string; help: string }[] = [
    {
      value: 'as-original',
      title: 'Import as original song version',
      help: 'The imported song becomes the original. Your current song is kept as a variant.',
    },
    {
      value: 'as-variant',
      title: 'Import as variant of original',
      help: 'Your current song stays the original. The imported song is kept as a variant.',
    },
    {
      value: 'update',
      title: 'Update current song',
      help: 'Replace your current song with the imported one, in its key. Setlists keep using it, and keep the keys they have it in.',
    },
    {
      value: 'use-existing',
      title: 'Do not import',
      help: 'Keep your current song as it is.',
    },
  ]
  const naming = item.pick === 'as-original' || item.pick === 'as-variant'
  return html`
    <p class="verdict">${sentence}</p>
    ${alone ? on.range(item) : ''}
    <fieldset class="picks">
      <legend>What to do with it</legend>
      ${options.map(
        ({ value, title, help }) => html`
          <label class="pick">
            <input
              type="radio"
              class="pick-${value}"
              name="pick-${index}"
              .checked=${item.pick === value}
              @change=${() => on.pick(item, value)}
            />
            <span><strong>${title}</strong><span class="help">${help}</span></span>
          </label>
        `
      )}
    </fieldset>
    ${
      naming
        ? html`
          <label class="label-field">
            ${item.pick === 'as-original' ? 'Variant name for your current song' : 'Variant name for the imported song'}
            <input
              class="variant-label"
              type="text"
              .value=${item.label ?? 'Alternate chords'}
              @input=${(event: Event) => {
                item.label = (event.target as HTMLInputElement).value
              }}
            />
          </label>
        `
        : ''
    }
    <div class="duplicate-actions">
      <button
        class="btn primary apply"
        ?disabled=${!item.pick}
        @click=${() => on.apply([item])}
      >
        Import
      </button>
    </div>
    <details ?open=${verdict === 'different-chords' || verdict === 'different-words'}>
      <summary>Compare</summary>
      <chart-diff
        .charts=${charts}
        .keys=${comparison?.keys}
        .labels=${labels}
      ></chart-diff>
    </details>
  `
}

/** The songs the library has, each with what to do with it; for several, a choice for all of them */
export function renderDuplicates(unresolved: ImportItem[], total: number, on: DuplicateActions) {
  const single = unresolved.length === 1 && total === 1
  return html`
    <div class="duplicate">
      <strong>
        ${
          single
            ? 'This song already exists in your library'
            : `${unresolved.length} of these songs ${unresolved.length > 1 ? 'are' : 'is'} already in your library`
        }
      </strong>
      ${
        single
          ? ''
          : html`
            ${
              unresolved.length > 1
                ? html`
                  <div class="bulk-picks" role="group" aria-label="The same choice for all of them">
                    <span>For all of them:</span>
                    <button class="btn bulk-update-all" type="button" @click=${() => on.pickAll('update')}>
                      Update all ${unresolved.length}
                    </button>
                    <button class="btn bulk-skip" type="button" @click=${() => on.pickAll('use-existing')}>
                      Do not import any
                    </button>
                  </div>
                `
                : ''
            }
            <div class="duplicate-actions">
              <button
                class="btn apply-all"
                ?disabled=${unresolved.some(item => !item.pick)}
                @click=${() => on.apply(unresolved)}
              >
                Import all with these choices
              </button>
            </div>
          `
      }
      <ul>
        ${unresolved.map(
          (item, index) => html`
            <li>
              ${single ? '' : html`<strong>${item.song.title}</strong>`}
              ${renderDuplicate(item, index, single, on)}
            </li>
          `
        )}
      </ul>
    </div>
  `
}
