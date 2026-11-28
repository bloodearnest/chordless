/**
 * Countries, as the ISO 3166-1 two-letter codes (a church's country is one: docs/CHURCH_TEAM_DESIGN.md). The names are the
 * browser's, in the person's language (`Intl.DisplayNames`), so none are kept here. DOM-free: the Worker checks a code against the
 * same list.
 */
const CODES =
  'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'.split(
    ' '
  )

export const COUNTRY_CODES: readonly string[] = CODES

const KNOWN = new Set(CODES)

export const isCountryCode = (value: unknown): value is string =>
  typeof value === 'string' && KNOWN.has(value)

/** A country's name in a language (the code itself if the browser has no name for it) */
export function countryName(code: string, language?: string): string {
  try {
    return (
      new Intl.DisplayNames(language ? [language] : undefined, { type: 'region' }).of(code) ?? code
    )
  } catch {
    return code
  }
}

/** The countries with their names, in the order of the names in that language */
export function countryChoices(language?: string): { code: string; name: string }[] {
  return CODES.map(code => ({ code, name: countryName(code, language) })).sort((a, b) =>
    a.name.localeCompare(b.name, language)
  )
}

/**
 * The country a person's browser suggests: the region of the first of their languages that names one (`en-GB` says GB; `en` says
 * nothing, and is not taken for the United States). Nothing is asked of the person and nothing leaves the device; a suggestion
 * only, for them to change.
 */
export function guessCountry(languages: readonly string[]): string | null {
  for (const tag of languages) {
    try {
      const region = new Intl.Locale(tag).region
      if (region && isCountryCode(region)) return region
    } catch {
      // (not a language tag: the next)
    }
  }
  return null
}
