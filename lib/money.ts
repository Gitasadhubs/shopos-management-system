// Subscription money comes in more than one currency: USD for card plans (Paddle), PKR for local
// bank/wallet transfers. Amounts in different currencies are never added together. Safe for the browser.

export type Currency = 'USD' | 'PKR'
export const CURRENCIES: Currency[] = ['USD', 'PKR']
// Amounts per currency, e.g. { USD: 38, PKR: 3000 }. A missing currency means 0.
export type MoneyTotals = Partial<Record<Currency, number>>

export const isCurrency = (value: unknown): value is Currency => value === 'USD' || value === 'PKR'

export function formatMoney(amount: number, currency: Currency | string = 'PKR') {
  const value = Number(amount)
  if (currency === 'USD') return `$${value.toLocaleString('en-US', { minimumFractionDigits: Number.isInteger(value) ? 0 : 2, maximumFractionDigits: 2 })}`
  if (currency === 'PKR') return `₨${value.toLocaleString('en-PK', { maximumFractionDigits: 2 })}`
  return `${currency} ${value.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
}

// "$38 · ₨3,000", or "$0" when there is nothing.
export function formatTotals(totals: MoneyTotals, empty: Currency = 'USD') {
  const parts = CURRENCIES.filter((currency) => totals[currency]).map((currency) => formatMoney(totals[currency]!, currency))
  return parts.length ? parts.join(' · ') : formatMoney(0, empty)
}

export function addTo(totals: MoneyTotals, currency: string, amount: number) {
  if (!isCurrency(currency)) return totals
  totals[currency] = Math.round(((totals[currency] ?? 0) + Number(amount)) * 100) / 100
  return totals
}

export const hasMoney = (totals: MoneyTotals) => CURRENCIES.some((currency) => (totals[currency] ?? 0) > 0)
