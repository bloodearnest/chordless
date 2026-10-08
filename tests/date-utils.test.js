import { expect } from '@esm-bundle/chai'
import { formatSetlistDate, getWeeksAgo, setlistTitle } from '../public/js/utils/date-utils.js'

const { describe, it } = window

describe('getWeeksAgo', () => {
  // Wednesday 8 October 2026, mid-afternoon local time
  const now = new Date(2026, 9, 8, 15, 30)

  it('describes past dates', () => {
    expect(getWeeksAgo('2026-10-08', now)).to.equal('today')
    expect(getWeeksAgo('2026-10-07', now)).to.equal('yesterday')
    expect(getWeeksAgo('2026-10-04', now)).to.equal('4 days ago')
    expect(getWeeksAgo('2026-09-27', now)).to.equal('1 week ago')
    expect(getWeeksAgo('2026-08-30', now)).to.equal('5 weeks ago')
    expect(getWeeksAgo('2025-10-01', now)).to.equal('1 year ago')
  })

  it('describes upcoming dates', () => {
    expect(getWeeksAgo('2026-10-09', now)).to.equal('tomorrow')
    expect(getWeeksAgo('2026-10-11', now)).to.equal('in 3 days')
    expect(getWeeksAgo('2026-10-18', now)).to.equal('in 1 week')
    expect(getWeeksAgo('2026-11-08', now)).to.equal('in 4 weeks')
  })

  it('counts calendar days, not 24-hour periods', () => {
    const lateEvening = new Date(2026, 9, 8, 23, 59)
    expect(getWeeksAgo('2026-10-09', lateEvening)).to.equal('tomorrow')
    const earlyMorning = new Date(2026, 9, 8, 0, 1)
    expect(getWeeksAgo('2026-10-07', earlyMorning)).to.equal('yesterday')
  })
})

describe('formatSetlistDate', () => {
  const now = new Date(2026, 9, 8)

  it('formats long dates in the given locale', () => {
    expect(formatSetlistDate('2026-10-18', 'long', { locale: 'en-GB', now })).to.equal(
      'Sunday, 18 October 2026'
    )
    expect(formatSetlistDate('2026-10-18', 'long', { locale: 'en-US', now })).to.equal(
      'Sunday, October 18, 2026'
    )
  })

  it('formats short dates, adding the year only when it is not this year', () => {
    expect(formatSetlistDate('2026-10-18', 'short', { locale: 'en-GB', now })).to.equal(
      'Sun 18 Oct'
    )
    expect(formatSetlistDate('2025-10-12', 'short', { locale: 'en-GB', now })).to.equal(
      'Sun, 12 Oct 2025'
    )
  })

  it('reads YYYY-MM-DD as a local date', () => {
    // As UTC this would be Saturday evening in timezones behind UTC
    expect(formatSetlistDate('2026-10-18', 'short', { locale: 'en-GB', now })).to.match(/^Sun/)
  })

  it('returns anything unparseable unchanged', () => {
    expect(formatSetlistDate('not a date', 'long', { locale: 'en-GB', now })).to.equal('not a date')
  })
})

describe('setlistTitle', () => {
  const now = new Date(2026, 9, 8)
  const options = { locale: 'en-GB', now }

  it('is the date, plus the name if there is one', () => {
    expect(setlistTitle({ date: '2026-10-18' }, 'short', options)).to.equal('Sun 18 Oct')
    expect(setlistTitle({ date: '2026-10-18', name: 'Harvest' }, 'long', options)).to.equal(
      'Sunday, 18 October 2026 - Harvest'
    )
  })
})
