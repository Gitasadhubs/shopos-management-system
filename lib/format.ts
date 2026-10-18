// Money, numbers and dates for a shop's own sales, in its currency and locale (lib/countries). Safe for
// the browser. Subscription money (USD/PKR to ShopOS) is formatted by lib/money.ts instead.

// receipt: the country's invoice numbering ("INV-000042"); without it receipts show "#42".
import { getCountry } from '@/lib/countries'

export type ShopFormat ={ currency: string; locale: string; receipt?: { prefix: string; padding: number } }

export const DEFAULT_FORMAT: ShopFormat = { currency: 'PKR', locale: 'en-PK' }

// Client components format with the signed-in shop's settings, set once by the auth provider; server
// code passes the shop's format explicitly.
let current: ShopFormat = DEFAULT_FORMAT
export function setShopFormat(format: ShopFormat | null | undefined) {
  current = format && format.currency && format.locale ? format : DEFAULT_FORMAT
}
export const shopFormat = () => current

// A shop's format on the server, where there is no signed-in browser: from its currency and country.
export function formatFor(shop: { currency?: string | null; country?: string | null }): ShopFormat {
  const country = getCountry(shop.country)
  return { currency: shop.currency || country.currency, locale: country.locale, receipt: { prefix: country.receipt.invoicePrefix, padding: country.receipt.numberPadding } }
}

// ISO 4217 minor units. Intl's own (CLDR) digits are for cash and say 0 for PKR, which would show a
// Rs 99.99 sale as Rs 100, so they are not used.
const NO_DECIMALS = new Set(['BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF', 'UGX', 'UYI', 'VND', 'VUV', 'XAF', 'XOF', 'XPF'])
const THREE_DECIMALS = new Set(['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND'])
export const currencyDigits = (currency: string) => (NO_DECIMALS.has(currency) ? 0 : THREE_DECIMALS.has(currency) ? 3 : 2)

const cache = new Map<string, Intl.NumberFormat>()
function moneyFormatter({ currency, locale }: ShopFormat, whole = false) {
  const key = `${locale}|${currency}|${whole}`
  let formatter = cache.get(key)
  if (!formatter) {
    try {
      // Whole amounts without decimals ("Rs 1,500"), others with the currency's own decimals
      // ("Rs 1,500.50"; 3 for KWD).
      const digits = currencyDigits(currency)
      formatter = new Intl.NumberFormat(locale, { style: 'currency', currency, currencyDisplay: 'narrowSymbol', minimumFractionDigits: whole ? 0 : digits, maximumFractionDigits: whole ? 0 : digits })
    } catch {
      formatter = new Intl.NumberFormat('en', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 2 })
    }
    cache.set(key, formatter)
  }
  return formatter
}

// "Rs 1,500", "$9.50", "د.إ.‏ 20", "₹1,20,000", in the shop's currency.
export function formatMoney(value: number, format: ShopFormat = current) {
  const amount = Number(value) || 0
  return moneyFormatter(format, Number.isInteger(amount)).format(amount)
}

// The currency's symbol on its own (for labels like "Amount (Rs)").
export function currencySymbol(format: ShopFormat = current) {
  return moneyFormatter(format, true).formatToParts(0).find((part) => part.type === 'currency')?.value ?? format.currency
}

// Rounds to the currency's own decimals (2 for most, 0 or 3 for some).
export function roundForCurrency(value: number, currency: string) {
  const factor = 10 ** currencyDigits(currency)
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor
}

export function formatReceiptNumber(number: number, format: ShopFormat = current) {
  const { prefix, padding } = format.receipt ?? { prefix: '', padding: 0 }
  return `${prefix || '#'}${String(number).padStart(padding, '0')}`
}

export function formatNumber(value: number, format: ShopFormat = current, options?: Intl.NumberFormatOptions) {
  return new Intl.NumberFormat(format.locale, { maximumFractionDigits: 3, ...options }).format(Number(value) || 0)
}

export function formatDate(value: string | Date, format: ShopFormat = current, options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }, timeZone?: string) {
  return new Intl.DateTimeFormat(format.locale, { ...options, ...(timeZone ? { timeZone } : {}) }).format(new Date(value))
}

export function formatDateTime(value: string | Date, format: ShopFormat = current, timeZone?: string) {
  return formatDate(value, format, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }, timeZone)
}
