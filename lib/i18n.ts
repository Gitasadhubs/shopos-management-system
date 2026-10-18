// Translations for the app: messages/<language>.json, keyed by English-free ids ("nav.dashboard").
// t() looks the key up in the shop's language, then English, then shows the key itself. {name} in a
// message is replaced from vars. Safe for the browser; the auth provider sets the language once the
// account is loaded (applyLanguage), and changing it in Settings reloads the page.
import ar from '@/messages/ar.json'
import en from '@/messages/en.json'
import fr from '@/messages/fr.json'
import hi from '@/messages/hi.json'
import sw from '@/messages/sw.json'
import ur from '@/messages/ur.json'
import { LANGUAGES, RTL_LANGUAGES, type LanguageCode } from '@/lib/countries'

type Messages = Record<string, string>
const MESSAGES: Record<LanguageCode, Messages> = { en, ur, hi, ar, fr, sw }

let current: LanguageCode = 'en'

export const isLanguage = (value: unknown): value is LanguageCode => typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value)
export const currentLanguage = () => current

// Sets the language for t() and the page's lang/dir (right to left for Urdu and Arabic).
export function applyLanguage(language: string | null | undefined) {
  current = isLanguage(language) ? language : 'en'
  if (typeof document !== 'undefined') {
    document.documentElement.lang = current
    document.documentElement.dir = RTL_LANGUAGES.includes(current) ? 'rtl' : 'ltr'
  }
}

export function t(key: string, vars?: Record<string, string | number>, language: LanguageCode = current) {
  const text = MESSAGES[language]?.[key] ?? MESSAGES.en[key] ?? key
  return vars ? text.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match)) : text
}

// Keys missing from a language (falls back to English): for the translation review.
export function missingKeys(language: LanguageCode) {
  return Object.keys(MESSAGES.en).filter((key) => !(key in MESSAGES[language]))
}
