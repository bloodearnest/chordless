/**
 * Utility functions for date formatting and calculations
 */

/**
 * Get a human-readable string for how long ago (or until) a date is, in
 * calendar days
 * @param {string} dateString - ISO date string, or YYYY-MM-DD (read as local)
 * @param {Date} [now] - Defaults to the current time
 * @returns {string} Human-readable relative time (e.g., "2 weeks ago", "yesterday", "in 3 days")
 */
export function getWeeksAgo(dateString, now = new Date()) {
  const days = calendarDaysBetween(parseLocalDate(dateString), now)

  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days === -1) return 'tomorrow'
  if (days < 0) {
    const ahead = -days
    if (ahead < 7) return `in ${ahead} days`
    const weeks = Math.floor(ahead / 7)
    return weeks === 1 ? 'in 1 week' : `in ${weeks} weeks`
  }
  if (days < 7) return `${days} days ago`

  const weeks = Math.floor(days / 7)
  if (weeks === 1) return '1 week ago'
  if (weeks < 52) return `${weeks} weeks ago`

  const years = Math.floor(weeks / 52)
  if (years === 1) return '1 year ago'
  return `${years} years ago`
}

/** A Date as a local YYYY-MM-DD (toISOString would give the UTC date) */
export function toLocalDateString(date) {
  const pad = n => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/**
 * Parse a date. A plain YYYY-MM-DD (as setlists use) is read as a local date;
 * new Date() would read it as UTC midnight, which is the previous day in
 * timezones behind UTC.
 */
export function parseLocalDate(dateString) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateString)
  if (match) {
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  }
  return new Date(dateString)
}

/** Whole calendar days from `date` to `now` (negative if `date` is in the future) */
function calendarDaysBetween(date, now) {
  const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate())
  return Math.round((startOfDay(now) - startOfDay(date)) / (24 * 60 * 60 * 1000))
}

/**
 * Format a setlist (or play) date, in the device's language conventions.
 * The one place setlist dates are formatted for display.
 *
 * - 'short' (lists, headers): weekday, day and month, plus the year if it isn't
 *   this year. en-GB: "Sun 18 Oct", "Sun, 12 Oct 2025"; en-US: "Sun, Oct 18".
 * - 'long' (dialogs, history): en-GB "Sunday, 18 October 2026",
 *   en-US "Sunday, October 18, 2026".
 *
 * @param {string} dateString - YYYY-MM-DD (read as a local date)
 * @param {'short'|'long'} [style]
 * @param {object} [options]
 * @param {string} [options.locale] - Defaults to the device's
 * @param {Date} [options.now] - For deciding whether the year is shown
 */
export function formatSetlistDate(dateString, style = 'long', { locale, now = new Date() } = {}) {
  const date = parseLocalDate(dateString)
  if (Number.isNaN(date.getTime())) return dateString ?? ''

  const options =
    style === 'short'
      ? {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
          ...(date.getFullYear() !== now.getFullYear() && { year: 'numeric' }),
        }
      : { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }
  return date.toLocaleDateString(locale, options)
}

/** A setlist's display title: its date, plus its name if it has one */
export function setlistTitle(setlist, style = 'long', options = {}) {
  const date = formatSetlistDate(setlist.date, style, options)
  return setlist.name ? `${date} - ${setlist.name}` : date
}
