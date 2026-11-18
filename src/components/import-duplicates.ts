/**
 * The songs of an import that the library has already (song-import.ts): how each compares with the
 * library's chart, what is suggested, and the choice of what to do with it.
 */

import { html, type TemplateResult } from 'lit'
import type { SongRecord } from '../js/data-types.ts'
import type { KeptMelody, LeadSheetOutcome, MelodyRead } from '../js/lead-sheet.ts'
import type { ChartComparison } from '../js/library-repair.ts'
import { describeOrigin, SONGSELECT } from '../js/song-source.ts'
import { t } from '../js/text.ts'
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
    update: t('import-status-updated'),
    'as-original': t('import-status-original'),
    'as-variant': t('import-status-variant'),
    'use-existing': t('import-status-not-imported'),
  }
  if (!item.isDuplicate) return t('import-status-new')
  if (item.auto && item.choice === 'update') return t('import-status-same-song')
  if (item.comparison?.verdict === 'identical') {
    return t(item.sourceSet ? 'import-status-identical-source' : 'import-status-identical')
  }
  return (item.choice && status[item.choice]) || t('import-status-in-library')
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
    identical: t('import-verdict-identical'),
    'same-chart': t('import-verdict-same-chart'),
    'other-key': t('import-verdict-other-key'),
    'different-chords': t('import-verdict-different-chords'),
    'different-words': t('import-verdict-different-words'),
  }[verdict]
  // (the library's chart, and the imported one)
  const charts: [string, string] = [item.existingText as string, item.chordproText]
  const labels: [ChartLabel, ChartLabel] = [
    { heading: t('import-chart-library'), detail: describeOrigin(item.song) },
    {
      heading: t('import-chart-importing'),
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
      title: t('import-pick-original'),
      help: t('import-pick-original-help'),
    },
    {
      value: 'as-variant',
      title: t('import-pick-variant'),
      help: t('import-pick-variant-help'),
    },
    {
      value: 'update',
      title: t('import-pick-update'),
      help: t('import-pick-update-help'),
    },
    {
      value: 'use-existing',
      title: t('import-pick-skip'),
      help: t('import-pick-skip-help'),
    },
  ]
  const naming = item.pick === 'as-original' || item.pick === 'as-variant'
  return html`
    <p class="verdict">${sentence}</p>
    ${alone ? on.range(item) : ''}
    <fieldset class="picks">
      <legend>${t('import-pick-legend')}</legend>
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
            ${t(item.pick === 'as-original' ? 'import-label-current' : 'import-label-imported')}
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
        ${t('import-button')}
      </button>
    </div>
    <details ?open=${verdict === 'different-chords' || verdict === 'different-words'}>
      <summary>${t('import-compare')}</summary>
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
            ? t('import-duplicate-one')
            : t('import-duplicate-many', { count: unresolved.length })
        }
      </strong>
      ${
        single
          ? ''
          : html`
            ${
              unresolved.length > 1
                ? html`
                  <div class="bulk-picks" role="group" aria-label=${t('import-bulk-label')}>
                    <span>${t('import-bulk')}</span>
                    <button class="btn bulk-update-all" type="button" @click=${() => on.pickAll('update')}>
                      ${t('import-bulk-update', { count: unresolved.length })}
                    </button>
                    <button class="btn bulk-skip" type="button" @click=${() => on.pickAll('use-existing')}>
                      ${t('import-bulk-skip')}
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
                ${t('import-bulk-apply')}
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
