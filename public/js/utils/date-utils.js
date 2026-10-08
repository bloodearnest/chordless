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

/**
 * Parse a date. A plain YYYY-MM-DD (as setlists use) is read as a local date;
 * new Date() would read it as UTC midnight, which is the previous day in
 * timezones behind UTC.
 */
function parseLocalDate(dateString) {
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
