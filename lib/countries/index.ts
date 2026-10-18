import { COUNTRIES } from './data'
import type { CountryConfig } from './types'

export type { CountryConfig, LanguageCode, PaymentOption } from './types'
export { COUNTRIES }

// Shops in a country that has no entry yet: English, US-style formatting, card payments, no tax assumed.
// (Their own currency is chosen at sign-up; see lib/local-platform.ts.)
export const DEFAULT_COUNTRY: CountryConfig = {
  ...COUNTRIES.find((country) => country.code === 'US')!,
  code: 'ZZ',
  name: 'Other country',
  locale: 'en',
  timezone: 'UTC',
  phonePrefix: '',
  tax: { name: null, rate: null, inclusive: true },
  receipt: { invoicePrefix: '', numberPadding: 0, showTaxId: false, footer: 'Thank you for shopping with us!' },
  seo: { headline: 'The simple POS system for small shops', intro: 'Sales, stock, customer credit and daily profit for independent shops anywhere.', keywords: ['POS system'] },
}

const BY_CODE = new Map(COUNTRIES.map((country) => [country.code, country]))

export const isCountryCode = (value: unknown): value is string => typeof value === 'string' && /^[A-Z]{2}$/.test(value) && ISO_CODES.includes(value)

// The config for a shop's country: its own entry, or the default (keeping the shop's real code).
export function getCountry(code: string | null | undefined): CountryConfig {
  const upper = (code ?? '').toUpperCase()
  return BY_CODE.get(upper) ?? { ...DEFAULT_COUNTRY, code: isCountryCode(upper) ? upper : 'ZZ' }
}

// The visitor's country from Cloudflare's CF-IPCountry header (the app is reached through Cloudflare);
// 'ZZ' when unknown (XX, T1 = Tor, or no header in development).
export function visitorCountry(headers: Pick<Headers, 'get'>) {
  const code = (headers.get('cf-ipcountry') ?? '').toUpperCase()
  return isCountryCode(code) ? code : 'ZZ'
}

export const hasCountryConfig =(code: string | null | undefined) => BY_CODE.has((code ?? '').toUpperCase())

// Every ISO 3166-1 country, for the sign-up and settings pickers. Names come from Intl.DisplayNames.
export const ISO_CODES = ('AD AE AF AG AI AL AM AO AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GT GU GW GY HK HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW').split(' ')

export function countryOptions(displayLocale = 'en') {
  let names: Intl.DisplayNames | null = null
  try { names = new Intl.DisplayNames([displayLocale, 'en'], { type: 'region' }) } catch { names = null }
  return ISO_CODES.map((code) => ({ code, name: BY_CODE.get(code)?.name ?? names?.of(code) ?? code })).sort((a, b) => a.name.localeCompare(b.name))
}
