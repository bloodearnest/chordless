import { expect } from '@open-wc/testing'
import {
  COUNTRY_CODES,
  countryChoices,
  countryName,
  guessCountry,
  isCountryCode,
} from '../src/js/countries.ts'

const { describe, it } = window

describe('countries', () => {
  it('are the 249 two-letter ISO codes, each once', () => {
    expect(COUNTRY_CODES).to.have.length(249)
    expect(new Set(COUNTRY_CODES).size).to.equal(249)
    for (const code of COUNTRY_CODES) expect(code).to.match(/^[A-Z]{2}$/)
    expect(COUNTRY_CODES).to.include.members([
      'GB',
      'US',
      'AU',
      'NZ',
      'ZA',
      'CA',
      'IE',
      'NG',
      'KE',
      'IN',
    ])
  })

  it('accepts a code, and nothing else', () => {
    expect(isCountryCode('GB')).to.equal(true)
    for (const bad of ['gb', 'UK', 'England', 'GBR', '', ' GB', null, undefined, 44])
      expect(isCountryCode(bad), String(bad)).to.equal(false)
  })

  it('are named by the browser, in the language asked for', () => {
    expect(countryName('GB', 'en')).to.contain('United Kingdom')
    expect(countryName('DE', 'de')).to.equal('Deutschland')
    expect(countryName('FR', 'en')).to.equal('France')
    // (a code the browser cannot name is the code)
    expect(countryName('not a code!', 'en')).to.equal('not a code!')
  })

  it('are listed by name, every one with a name', () => {
    const choices = countryChoices('en')
    expect(choices).to.have.length(249)
    expect(choices.map(choice => choice.name)).to.deep.equal(
      [...choices.map(choice => choice.name)].sort((a, b) => a.localeCompare(b, 'en'))
    )
    expect(choices.find(choice => choice.code === 'GB')?.name).to.contain('United Kingdom')
    expect(choices.every(choice => choice.name.length > 0)).to.equal(true)
  })

  it('are suggested from the region of the first language that names one, and never guessed from a bare language', () => {
    expect(guessCountry(['en-GB', 'en'])).to.equal('GB')
    expect(guessCountry(['en', 'fr-CA'])).to.equal('CA')
    expect(guessCountry(['en'])).to.equal(null)
    expect(guessCountry([])).to.equal(null)
    expect(guessCountry(['en-ZZ'])).to.equal(null)
    expect(guessCountry(['not a tag!!', 'en-AU'])).to.equal('AU')
  })
})
