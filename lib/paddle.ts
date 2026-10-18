import { createHmac, timingSafeEqual } from 'node:crypto'
import { CARD_PLANS, type BillingInterval, type CardPlanId } from '@/lib/plans'
import { LocalDataError } from '@/lib/local-db'

// Card payments through Paddle Billing (paddle.com), the merchant of record: it charges the card,
// handles sales tax and invoices, and pays out to us. Shops pay in Paddle's checkout window
// (Paddle.js, components/billing-page.tsx); Paddle then tells us about payments and subscription
// changes by webhook (app/api/billing/paddle/route.ts), and the shop's subscription follows.
// Settings are SHOPOS_PADDLE_* in the env file; scripts/paddle-setup.mjs creates the prices and webhook.

export type PaddleEnvironment = 'sandbox' | 'production'

const env = (name: string) => process.env[name]?.trim() || ''
// Each plan has a price per interval, and the same price with a 14-day free trial (…_TRIAL_…): a shop
// that signed up while trials need a card starts its trial with that one, so the card is charged
// only when the trial ends.
const priceVar = (plan: CardPlanId, interval: BillingInterval, trial: boolean) =>
  `SHOPOS_PADDLE_${trial ? 'TRIAL_' : ''}PRICE_${plan.toUpperCase()}_${interval.toUpperCase()}`

export function paddleEnvironment(): PaddleEnvironment {
  return env('SHOPOS_PADDLE_ENV') === 'production' ? 'production' : 'sandbox'
}

export function priceIdFor(plan: CardPlanId, interval: BillingInterval, trial = false) {
  return env(priceVar(plan, interval, trial)) || null
}

// Which plan and interval a Paddle price belongs to (trial prices included), or null for a price this
// install does not sell.
export function planForPrice(priceId: string | null | undefined): { plan: CardPlanId; interval: BillingInterval } | null {
  if (!priceId) return null
  for (const plan of CARD_PLANS) for (const interval of ['month', 'year'] as const) {
    if (priceIdFor(plan, interval) === priceId || priceIdFor(plan, interval, true) === priceId) return { plan, interval }
  }
  return null
}

// Card checkout is offered only once the browser token, the webhook secret and at least one price are set.
// SHOPOS_PADDLE_CHECKOUT=soon: the card plans show, but checkout does not open yet (an install still on
// Paddle's sandbox before its live account is approved). Owners use "pay later" meanwhile.
export const CARD_SOON_MESSAGE = 'Card payments open in a few days. Choose "Pay later" to start your plan now and pay within 7 days.'
export const cardCheckoutOpen = () => env('SHOPOS_PADDLE_CHECKOUT') !== 'soon'

export function paddleCheckoutConfig() {
  const token = env('SHOPOS_PADDLE_CLIENT_TOKEN')
  if (!token || !env('SHOPOS_PADDLE_WEBHOOK_SECRET')) return null
  const pairs = (trial: boolean) => CARD_PLANS.flatMap((plan) => (['month', 'year'] as const).filter((interval) => priceIdFor(plan, interval, trial)).map((interval) => ({ plan, interval })))
  const prices = pairs(false)
  return prices.length ? { client_token: token, environment: paddleEnvironment(), prices, trial_prices: pairs(true) } : null
}

// Paddle signs each webhook: header "ts=<unix seconds>;h1=<hex HMAC-SHA256 of `${ts}:${raw body}`>"
// (several h1 values while a secret is being rotated). Old timestamps are refused so a captured
// request cannot be replayed later; the event id is also stored, so a replay inside the window is ignored.
export const SIGNATURE_TOLERANCE_SECONDS = 300

export function verifyPaddleSignature(header: string | null, rawBody: string, secret: string, now = Date.now()) {
  if (!header || !secret) return false
  let ts = ''
  const signatures: string[] = []
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    const value = rest.join('=')
    if (key === 'ts') ts = value
    else if (key === 'h1' && value) signatures.push(value)
  }
  if (!/^\d{1,12}$/.test(ts) || !signatures.length) return false
  if (Math.abs(now / 1000 - Number(ts)) > SIGNATURE_TOLERANCE_SECONDS) return false
  const expected = createHmac('sha256', secret).update(`${ts}:${rawBody}`).digest()
  return signatures.some((signature) => {
    if (!/^[0-9a-f]{64}$/i.test(signature)) return false
    return timingSafeEqual(Buffer.from(signature, 'hex'), expected)
  })
}

export const webhookSecret = () => env('SHOPOS_PADDLE_WEBHOOK_SECRET')

// --- Paddle API (server side, needs SHOPOS_PADDLE_API_KEY) -------------------------------------

function apiBase() {
  const override = env('SHOPOS_PADDLE_API_URL')
  if (override) return override.replace(/\/$/, '')
  return paddleEnvironment() === 'production' ? 'https://api.paddle.com' : 'https://sandbox-api.paddle.com'
}

async function paddleApi<T>(method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown): Promise<T> {
  const key = env('SHOPOS_PADDLE_API_KEY')
  if (!key) throw new LocalDataError('Card billing is not fully set up yet. Contact ShopOS support.', 503, 'paddle_not_configured')
  let response: Response
  try {
    response = await fetch(`${apiBase()}${path}`, {
      method,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    })
  } catch (error) {
    console.error('paddle api unreachable', path, error)
    throw new LocalDataError('The card payment service could not be reached. Try again in a minute.', 502, 'paddle_unreachable')
  }
  const payload = await response.json().catch(() => null) as { data?: T; error?: { code?: string; detail?: string } } | null
  if (!response.ok || !payload?.data) {
    console.error('paddle api error', method, path, response.status, payload?.error)
    throw new LocalDataError(payload?.error?.detail ? `Card billing: ${payload.error.detail}` : 'The card payment service refused the request. Try again or contact support.', 502, 'paddle_error')
  }
  return payload.data
}

// A short-lived link to Paddle's customer portal, where the owner updates their card, sees invoices
// or cancels. Links carry a temporary token, so they are made on each click and never stored.
export async function createPortalLink(customerId: string, subscriptionId: string | null) {
  const data = await paddleApi<{ urls: { general: { overview: string }; subscriptions?: Array<{ id: string; update_subscription_payment_method: string; cancel_subscription: string }> } }>(
    'POST', `/customers/${encodeURIComponent(customerId)}/portal-sessions`, subscriptionId ? { subscription_ids: [subscriptionId] } : {},
  )
  const sub = data.urls.subscriptions?.find((item) => item.id === subscriptionId)
  return { overview: data.urls.general.overview, update_payment: sub?.update_subscription_payment_method ?? null, cancel: sub?.cancel_subscription ?? null }
}

// Switch an existing subscription to another price. The difference is charged (or credited) now, pro rata;
// Paddle then sends subscription.updated and, for a charge, transaction.completed.
export async function changeSubscriptionPrice(subscriptionId: string, priceId: string) {
  await paddleApi('PATCH', `/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    items: [{ price_id: priceId, quantity: 1 }],
    proration_billing_mode: 'prorated_immediately',
  })
}

// Undo a cancellation the owner scheduled in the portal, while the paid period is still running.
export async function resumeScheduledCancel(subscriptionId: string) {
  await paddleApi('PATCH', `/subscriptions/${encodeURIComponent(subscriptionId)}`, { scheduled_change: null })
}

// --- webhook payloads (only the fields we read) ------------------------------------------------

type PaddlePrice = { id: string; billing_cycle?: { interval: string; frequency: number } | null }
export type PaddleTransaction = {
  id: string
  status: string
  origin?: string | null
  customer_id: string | null
  subscription_id: string | null
  currency_code: string
  custom_data?: Record<string, unknown> | null
  billing_period?: { starts_at: string; ends_at: string } | null
  items: Array<{ price: PaddlePrice; quantity: number }>
  details?: { totals?: { subtotal: string; discount: string; tax: string; total: string; grand_total: string } } | null
}
export type PaddleSubscription = {
  id: string
  status: 'active' | 'canceled' | 'past_due' | 'paused' | 'trialing' | string
  customer_id: string
  currency_code: string
  custom_data?: Record<string, unknown> | null
  items: Array<{ price: PaddlePrice; quantity: number }>
  current_billing_period?: { starts_at: string; ends_at: string } | null
  scheduled_change?: { action: 'cancel' | 'pause' | 'resume'; effective_at: string } | null
}
export type PaddleEvent = { event_id: string; event_type: string; occurred_at: string; data: unknown }

// Paddle amounts are strings in the currency's smallest unit ("900" is $9.00). USD and PKR both use 2 decimals.
export const fromMinorUnits = (value: string | number | null | undefined) => Math.round(Number(value ?? 0)) / 100
