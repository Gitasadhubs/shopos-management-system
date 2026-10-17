import type { Currency } from '@/lib/money'

// What a shop can subscribe to. Card plans (starter, growth) are billed in USD by Paddle; "basic" is
// the PKR plan paid by bank transfer or mobile wallet and recorded by an admin. Safe for the browser.
// Prices here are what the app shows; Paddle charges the price set on its side (keep them equal).

export type PlanId = 'basic' | 'starter' | 'growth'
export type CardPlanId = Exclude<PlanId, 'basic'>
export type BillingInterval = 'month' | 'year'

export type Plan = {
  id: PlanId
  name: string
  currency: Currency
  prices: Partial<Record<BillingInterval, number>>
  // Staff accounts besides the owner (active users plus open invitations); null means no limit.
  staffLimit: number | null
  summary: string
}

export const PLANS: Record<PlanId, Plan> = {
  basic: { id: 'basic', name: 'Basic', currency: 'PKR', prices: { month: 1500 }, staffLimit: null, summary: 'Everything included, paid by bank transfer or mobile wallet.' },
  starter: { id: 'starter', name: 'Starter', currency: 'USD', prices: { month: 9, year: 90 }, staffLimit: 3, summary: '1 shop, up to 3 staff. POS, inventory, credit, reports.' },
  growth: { id: 'growth', name: 'Growth', currency: 'USD', prices: { month: 19, year: 190 }, staffLimit: null, summary: '1 shop, unlimited staff, everything in ShopOS.' },
}

export const CARD_PLANS: CardPlanId[] = ['starter', 'growth']
export const isCardPlan = (value: unknown): value is CardPlanId => value === 'starter' || value === 'growth'
export const isInterval = (value: unknown): value is BillingInterval => value === 'month' || value === 'year'
export const planName = (id: string) => PLANS[id as PlanId]?.name ?? id

// Months of service one payment buys.
export const intervalMonths = (interval: BillingInterval, frequency = 1) => (interval === 'year' ? 12 : 1) * Math.max(1, frequency)

// The share of a price that counts as one month (yearly plans are spread over 12).
export const monthlyValue = (price: number, interval: BillingInterval) => Math.round((interval === 'year' ? price / 12 : price) * 100) / 100
