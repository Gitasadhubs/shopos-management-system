// One entry per country ShopOS is set up for (lib/countries/<ISO>.ts, listed in index.ts). Adding a
// country = adding one file. Shops elsewhere get DEFAULT_COUNTRY's behaviour with their own ISO code.
// Safe for the browser.

export type LanguageCode = 'en' | 'ur' | 'hi' | 'ar' | 'fr' | 'sw'

// How a shop can pay for ShopOS in that country. 'paddle' = card checkout (Paddle, the merchant of
// record); the rest are manual transfers the shop sends and an admin records.
export type PaymentOption = 'paddle' | 'bank_transfer' | 'jazzcash' | 'easypaisa'

export type CountryConfig = {
  code: string // ISO 3166-1 alpha-2, e.g. 'PK'
  name: string // English name
  currency: string // ISO 4217, e.g. 'PKR'; the shop's own sales are in this currency
  locale: string // BCP 47 for numbers and dates, e.g. 'en-PK'
  language: LanguageCode // default app language for new shops
  languages: LanguageCode[] // languages offered there (the default first)
  timezone: string // IANA default for new shops
  phonePrefix: string // e.g. '+92', for WhatsApp numbers typed without one
  // Default sales tax. rate null: varies (by product or state), so ShopOS does not assume one.
  tax: { name: string | null; rate: number | null; inclusive: boolean; note?: string }
  // Receipts: prefix of the invoice number ("INV-000123"), zero padding, and whether the shop's tax
  // number must be printed.
  receipt: { invoicePrefix: string; numberPadding: number; showTaxId: boolean; footer: string }
  // How the shop pays its ShopOS subscription here (first = shown first).
  payments: PaymentOption[]
  // Fallback prices for pages that cannot ask Paddle (card prices come from Paddle; see lib/paddle.ts).
  // manual: the monthly price for manual transfers, in the local currency (where payments has one).
  pricing: { currency: string; starter: { month: number; year: number }; growth: { month: number; year: number }; manual?: { currency: string; month: number } }
  // WhatsApp messages. {customer} {shop} {balance} are filled in.
  whatsapp: { creditReminder: string; dayEndTitle: string }
  // Local POS / receipt rules the shop may have to follow (shown as a notice in the app).
  compliance: { fiscalReceipts: boolean; note: string | null }
  legal: { cookieBanner: boolean }
  seo: { headline: string; intro: string; keywords: string[] }
  shopTypes: string[] // slugs of the shop types that matter most there (website pages)
  exampleProducts: string[] // for demo copy and onboarding hints
}
