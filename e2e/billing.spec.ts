import { createHmac } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { ADMIN_STATE, anonymousContext, browserContextFor, createStaff, signUpShop, uniqueEmail } from './auth-helpers'
import { uniqueName } from './helpers'

// Card billing through Paddle. The suite plays Paddle's part: it signs webhook events with the test
// secret (docker-compose.dev.yml, e2e/preprod.env) and checks what they do to the shop. Paddle.js and
// Paddle's API are not called; the test env has no API key.

test.use({ storageState: ADMIN_STATE })

const SECRET = 'e2e-paddle-webhook-secret'
const PRICES = { starter: { month: 'pri_e2e_starter_month', year: 'pri_e2e_starter_year' }, growth: { month: 'pri_e2e_growth_month', year: 'pri_e2e_growth_year' } }
const DAY = 86_400_000
let sequence = 0
const paddleId = (prefix: string) => `${prefix}_e2e${Date.now().toString(36)}${(sequence++).toString(36)}${Math.random().toString(36).slice(2, 8)}`

function sign(body: string, secret = SECRET, ts = Math.floor(Date.now() / 1000)) {
  return `ts=${ts};h1=${createHmac('sha256', secret).update(`${ts}:${body}`).digest('hex')}`
}

async function deliver(event: object, signature?: string) {
  const body = JSON.stringify(event)
  const api = await anonymousContext()
  const response = await api.post('/api/billing/paddle', { data: body, headers: { 'content-type': 'application/json', 'paddle-signature': signature ?? sign(body) } })
  const result = { status: response.status(), body: await response.json().catch(() => null) as { ok?: boolean; outcome?: string; error?: string } | null }
  await api.dispose()
  return result
}

async function send(event: object) {
  const result = await deliver(event)
  expect(result.status, JSON.stringify(result.body)).toBe(200)
  return result.body!.outcome!
}

type Card = { shopId: string; subscriptionId: string; customerId: string }
const newCard = (shopId: string): Card => ({ shopId, subscriptionId: paddleId('sub'), customerId: paddleId('ctm') })

// trial: the price with a 14-day free trial (shops that start their trial with a card).
const item = (plan: keyof typeof PRICES, interval: 'month' | 'year', trial = false) => [{ quantity: 1, price: { id: trial ? `pri_e2e_trial_${plan}_${interval}` : PRICES[plan][interval], billing_cycle: { interval, frequency: 1 } } }]

function transaction(card: Card, options: { plan?: keyof typeof PRICES; interval?: 'month' | 'year'; trial?: boolean; cents: number; start: Date; end: Date; origin?: string; id?: string; eventId?: string }) {
  const { plan = 'starter', interval = 'month' } = options
  return {
    event_id: options.eventId ?? paddleId('evt'),
    event_type: 'transaction.completed',
    occurred_at: new Date().toISOString(),
    data: {
      id: options.id ?? paddleId('txn'),
      status: 'completed',
      origin: options.origin ?? 'web',
      customer_id: card.customerId,
      subscription_id: card.subscriptionId,
      currency_code: 'USD',
      custom_data: { shop_id: card.shopId },
      billing_period: { starts_at: options.start.toISOString(), ends_at: options.end.toISOString() },
      items: item(plan, interval, options.trial),
      details: { totals: { subtotal: String(options.cents), discount: '0', tax: '0', total: String(options.cents), grand_total: String(options.cents) } },
    },
  }
}

function subscription(card: Card, options: { type?: string; plan?: keyof typeof PRICES; interval?: 'month' | 'year'; trial?: boolean; status?: string; cancelAt?: Date; occurredAt?: Date; end?: Date } = {}) {
  const { plan = 'starter', interval = 'month' } = options
  return {
    event_id: paddleId('evt'),
    event_type: options.type ?? 'subscription.updated',
    occurred_at: (options.occurredAt ?? new Date()).toISOString(),
    data: {
      id: card.subscriptionId,
      status: options.status ?? 'active',
      customer_id: card.customerId,
      currency_code: 'USD',
      custom_data: { shop_id: card.shopId },
      items: item(plan, interval, options.trial),
      current_billing_period: { starts_at: new Date().toISOString(), ends_at: (options.end ?? new Date(Date.now() + 30 * DAY)).toISOString() },
      scheduled_change: options.cancelAt ? { action: 'cancel', effective_at: options.cancelAt.toISOString() } : null,
    },
  }
}

// What Paddle sends when a shop pays for a plan: the subscription, then the paid transaction.
async function subscribe(card: Card, plan: keyof typeof PRICES = 'starter', interval: 'month' | 'year' = 'month', end = new Date(Date.now() + (interval === 'year' ? 365 : 30) * DAY)) {
  await send(subscription(card, { type: 'subscription.created', plan, interval, occurredAt: new Date(Date.now() - 1000), end }))
  return send(transaction(card, { plan, interval, cents: plan === 'starter' ? (interval === 'year' ? 9000 : 900) : (interval === 'year' ? 19000 : 1900), start: new Date(), end }))
}

const billingOf = async (owner: APIRequestContext) => (await (await owner.get('/api/billing')).json()).data

test('the webhook only acts on events signed with the secret', async () => {
  const shop = await signUpShop(uniqueName('Unsigned Shop'))
  const event = transaction(newCard(shop.shopId), { cents: 900, start: new Date(), end: new Date(Date.now() + 30 * DAY) })
  const body = JSON.stringify(event)
  expect((await deliver(event, '')).status).toBe(401)
  expect((await deliver(event, sign(body, 'not-the-secret'))).status).toBe(401)
  // A captured request replayed an hour later is refused.
  expect((await deliver(event, sign(body, SECRET, Math.floor(Date.now() / 1000) - 3600))).status).toBe(401)
  expect((await deliver(event, `ts=${Math.floor(Date.now() / 1000)};h1=zz`)).status).toBe(401)
  // None of that touched the shop.
  expect((await billingOf(shop.context)).shop.subscription).toMatchObject({ state: 'trialing', provider: 'manual' })
  // Correctly signed, for a subscription no shop has: acknowledged and ignored.
  const stranger = transaction({ shopId: '00000000-0000-4000-8000-000000000000', subscriptionId: paddleId('sub'), customerId: paddleId('ctm') }, { cents: 900, start: new Date(), end: new Date(Date.now() + 30 * DAY) })
  expect(await send(stranger)).toMatch(/^ignored: no shop/)
  await shop.context.dispose()
})

test('paying by card activates the plan, renewals extend it and repeats are ignored', async ({ page, browser }) => {
  const shop = await signUpShop(uniqueName('Card Shop'))
  const before = await billingOf(shop.context)
  expect(before.card).toMatchObject({ environment: 'sandbox', subscription: null })
  expect(before.card.available).toHaveLength(4)
  expect(before.plans.map((plan: { id: string }) => plan.id)).toEqual(['starter', 'growth'])

  // What the Billing page asks for before opening Paddle's checkout.
  const checkout = await shop.context.post('/api/billing/checkout', { data: { plan: 'starter', interval: 'month' } })
  expect(checkout.status(), await checkout.text()).toBe(200)
  expect((await checkout.json()).data).toMatchObject({ price_id: PRICES.starter.month, email: shop.email, custom_data: { shop_id: shop.shopId }, environment: 'sandbox' })
  expect((await shop.context.post('/api/billing/checkout', { data: { plan: 'premium', interval: 'month' } })).status()).toBe(400)

  const card = newCard(shop.shopId)
  const end = new Date(Date.now() + 30 * DAY)
  const first = transaction(card, { cents: 900, start: new Date(), end })
  await send(subscription(card, { type: 'subscription.created', occurredAt: new Date(Date.now() - 1000), end }))
  expect(await send(first)).toMatch(/^paid until/)

  const paid = await billingOf(shop.context)
  expect(paid.shop.subscription).toMatchObject({ plan: 'starter', plan_name: 'Starter', state: 'active', price: 9, currency: 'USD', interval: 'month', provider: 'paddle', cancel_at_period_end: false, can_write: true })
  expect(Math.abs(new Date(paid.shop.subscription.current_period_end).getTime() - end.getTime())).toBeLessThan(1000)
  expect(paid.card.subscription).toMatchObject({ live: true, cancel_scheduled: false, plan: 'starter', interval: 'month' })
  expect(paid.payments).toEqual([expect.objectContaining({ amount: 9, currency: 'USD', method: 'card', months: 1, reference: first.data.id })])
  // Already paying: the checkout is not offered again.
  expect((await shop.context.post('/api/billing/checkout', { data: { plan: 'growth', interval: 'month' } })).status()).toBe(409)

  // Paddle delivers again (same event), or resends the same payment as a new event: one payment either way.
  expect(await send(first)).toBe('duplicate')
  expect(await send({ ...first, event_id: paddleId('evt') })).toMatch(/^already recorded/)
  expect((await billingOf(shop.context)).payments).toHaveLength(1)

  // The next month renews by itself.
  const next = new Date(end.getTime() + 30 * DAY)
  await send(transaction(card, { cents: 900, start: end, end: next, origin: 'subscription_recurring' }))
  const renewed = await billingOf(shop.context)
  expect(renewed.payments).toHaveLength(2)
  expect(Math.abs(new Date(renewed.shop.subscription.current_period_end).getTime() - next.getTime())).toBeLessThan(1000)

  // The admin sees the dollars, kept apart from rupees.
  await page.goto('/admin/payments')
  await expect(page.getByRole('row', { name: new RegExp(shop.shopName) }).first()).toContainText('$9')
  await page.goto(`/admin/shops/${shop.shopId}`)
  await expect(page.getByText('Starter · $9/mo')).toBeVisible()
  await expect(page.getByText('Card (Paddle), renews by itself')).toBeVisible()
  await expect(page.getByText('Plan and price follow the shop')).toBeVisible()
  await expect(page.getByText('transaction.completed').first()).toBeVisible()

  // The owner's Billing page.
  const owner = await browserContextFor(browser, shop.context)
  const ownerPage = await owner.newPage()
  await ownerPage.goto('/billing')
  await expect(ownerPage.getByText(/^Renews on /)).toBeVisible()
  await expect(ownerPage.getByText('Your plan', { exact: true })).toBeVisible()
  await expect(ownerPage.getByRole('button', { name: 'Switch to Growth' })).toBeVisible()
  await expect(ownerPage.getByRole('button', { name: 'Manage card, invoices or cancel' })).toBeVisible()
  await expect(ownerPage.getByText('Test mode: no real money is taken.')).toBeVisible()
  await expect(ownerPage.getByRole('row').filter({ hasText: 'Card' }).first()).toContainText('$9')
  // A card customer is not asked to send transfer receipts.
  await expect(ownerPage.getByText('Send payment proof')).toHaveCount(0)
  // The portal and plan changes need Paddle's API, which the test install does not have.
  expect((await shop.context.post('/api/billing/portal')).status()).toBe(503)
  await owner.close()
  await shop.context.dispose()
})

test('cancelling in Paddle stops renewal but keeps the paid time, and older events never win', async ({ page }) => {
  const shop = await signUpShop(uniqueName('Cancel Shop'))
  const card = newCard(shop.shopId)
  const end = new Date(Date.now() + 30 * DAY)
  await subscribe(card, 'starter', 'month', end)

  // The owner cancels in Paddle's portal: it stops at the end of the period.
  expect(await send(subscription(card, { cancelAt: end }))).toContain('not renewing')
  let billing = await billingOf(shop.context)
  expect(billing.shop.subscription).toMatchObject({ state: 'active', cancel_at_period_end: true, can_write: true })
  expect(billing.card.subscription).toMatchObject({ live: false, cancel_scheduled: true })
  // An update from before the cancellation, delivered late, changes nothing.
  expect(await send(subscription(card, { occurredAt: new Date(Date.now() - 60 * 60 * 1000) }))).toMatch(/^ignored: older/)
  expect((await billingOf(shop.context)).shop.subscription.cancel_at_period_end).toBe(true)

  // The period runs out in Paddle: still paid up to the end.
  await send(subscription(card, { type: 'subscription.canceled', status: 'canceled' }))
  billing = await billingOf(shop.context)
  expect(billing.shop.subscription).toMatchObject({ state: 'active', cancel_at_period_end: true })
  expect(Math.abs(new Date(billing.shop.subscription.current_period_end).getTime() - end.getTime())).toBeLessThan(1000)
  // A new card plan can be started again.
  expect((await shop.context.post('/api/billing/checkout', { data: { plan: 'growth', interval: 'year' } })).status()).toBe(200)

  // Subscribing again (a new Paddle subscription) renews normally.
  const again = newCard(shop.shopId)
  await subscribe(again, 'growth', 'year', new Date(end.getTime() + 365 * DAY))
  billing = await billingOf(shop.context)
  expect(billing.shop.subscription).toMatchObject({ plan: 'growth', interval: 'year', price: 190, cancel_at_period_end: false })
  expect(billing.card.subscription).toMatchObject({ live: true })
  // The old subscription's last word does not undo the new one.
  expect(await send(subscription(card, { type: 'subscription.canceled', status: 'canceled' }))).toMatch(/^ignored: not the current/)

  await page.goto(`/admin/shops/${shop.shopId}`)
  await expect(page.getByText('Card plan cancelled')).toBeVisible()
  await shop.context.dispose()
})

test('a renewing card plan gets a few days of grace while Paddle retries; a cancelled one does not', async ({ page }) => {
  const shop = await signUpShop(uniqueName('Grace Shop'))
  // No trial time left, so only the card period counts.
  await page.goto(`/admin/shops/${shop.shopId}`)
  await page.getByRole('button', { name: 'End subscription now' }).click()
  await expect(page.getByRole('status')).toContainText('Subscription ended')
  const card = newCard(shop.shopId)
  // The paid period ended yesterday and the renewal has not come through yet.
  await subscribe(card, 'starter', 'month', new Date(Date.now() - DAY))
  await send(subscription(card, { type: 'subscription.past_due', status: 'past_due' }))
  const due = await billingOf(shop.context)
  expect(new Date(due.shop.subscription.current_period_end).getTime()).toBeLessThan(Date.now())
  expect(due.shop.subscription).toMatchObject({ state: 'active', past_due: true, can_write: true })
  expect((await shop.context.post('/api/customers', { data: { name: 'Still selling' } })).status()).toBe(201)
  // Paddle gives up and cancels: no grace any more, the shop is read-only until it pays.
  await send(subscription(card, { type: 'subscription.canceled', status: 'canceled' }))
  expect((await billingOf(shop.context)).shop.subscription).toMatchObject({ state: 'expired', can_write: false })
  expect((await shop.context.post('/api/customers', { data: { name: 'Blocked' } })).status()).toBe(402)
  // Billing still works while expired, so the owner can pay again.
  expect((await shop.context.post('/api/billing/checkout', { data: { plan: 'starter', interval: 'month' } })).status()).toBe(200)
  await shop.context.dispose()
})

test('Starter allows up to 3 staff; Growth has no limit; a mid-period upgrade buys no extra time', async () => {
  const shop = await signUpShop(uniqueName('Staff Limit Shop'))
  const card = newCard(shop.shopId)
  const end = new Date(Date.now() + 30 * DAY)
  await subscribe(card, 'starter', 'month', end)
  for (const role of ['manager', 'cashier', 'cashier'] as const) {
    const invite = await shop.context.post('/api/users', { data: { email: uniqueEmail(role), role } })
    expect(invite.status(), await invite.text()).toBe(201)
  }
  const fourth = await shop.context.post('/api/users', { data: { email: uniqueEmail('cashier'), role: 'cashier' } })
  expect(fourth.status()).toBe(403)
  expect(await fourth.json()).toMatchObject({ code: 'plan_limit' })

  // Upgrade to Growth: Paddle updates the subscription and charges the difference pro rata.
  await send(subscription(card, { plan: 'growth' }))
  await send(transaction(card, { plan: 'growth', cents: 750, start: new Date(), end, origin: 'subscription_update' }))
  const billing = await billingOf(shop.context)
  expect(billing.shop.subscription).toMatchObject({ plan: 'growth', price: 19 })
  expect(billing.payments[0]).toMatchObject({ amount: 7.5, months: 0 })
  expect(Math.abs(new Date(billing.shop.subscription.current_period_end).getTime() - end.getTime())).toBeLessThan(1000)
  expect((await shop.context.post('/api/users', { data: { email: uniqueEmail('cashier'), role: 'cashier' } })).status()).toBe(201)
  await shop.context.dispose()
})

test('only the owner can start a card payment', async () => {
  const shop = await signUpShop(uniqueName('Manager Card Shop'))
  const manager = await createStaff(shop.context, 'manager')
  expect((await manager.context.post('/api/billing/checkout', { data: { plan: 'starter', interval: 'month' } })).status()).toBe(403)
  expect((await manager.context.get('/api/billing')).status()).toBe(403)
  await manager.context.dispose()
  await shop.context.dispose()
})

test('when trials need a card, a new shop is read-only until it adds one; the card is charged when the trial ends', async ({ page, browser }) => {
  // Turn the requirement on (admin Settings). Tests run one at a time, so no other test signs up meanwhile.
  await page.goto('/admin/settings')
  await page.getByLabel('Require a card to start a trial').check()
  await page.getByRole('button', { name: 'Save settings' }).click()
  await expect(page.getByRole('status')).toContainText('New shops add a card')
  try {
    const shop = await signUpShop(uniqueName('Card First Shop'))
    const me = async () => (await (await shop.context.get('/api/auth/me')).json()).data.user.shop.subscription
    expect(await me()).toMatchObject({ state: 'trialing', needs_card: true, can_write: false })
    expect((await shop.context.post('/api/customers', { data: { name: 'Too early' } })).status()).toBe(402)

    // The owner is sent to Billing, which offers the trial prices.
    const owner = await browserContextFor(browser, shop.context)
    const ownerPage = await owner.newPage()
    await ownerPage.goto('/dashboard')
    await expect(ownerPage).toHaveURL(/\/billing$/)
    await expect(ownerPage.getByText('Add a card to start your 14-day free trial')).toBeVisible()
    await expect(ownerPage.getByRole('button', { name: 'Start free trial: Growth' })).toBeVisible()
    const checkout = await (await shop.context.post('/api/billing/checkout', { data: { plan: 'starter', interval: 'month' } })).json()
    expect(checkout.data).toMatchObject({ price_id: 'pri_e2e_trial_starter_month', trial: true })

    // Paddle: the subscription starts in its 14-day trial, with a $0 transaction.
    const card = newCard(shop.shopId)
    const trialEnd = new Date(Date.now() + 14 * DAY)
    await send(subscription(card, { type: 'subscription.created', status: 'trialing', trial: true, end: trialEnd }))
    await send(transaction(card, { trial: true, cents: 0, start: new Date(), end: trialEnd }))
    const trialing = await me()
    expect(trialing).toMatchObject({ state: 'trialing', needs_card: false, can_write: true, provider: 'paddle', plan: 'starter' })
    expect(Math.abs(new Date(trialing.current_period_end).getTime() - trialEnd.getTime())).toBeLessThan(1000)
    expect((await billingOf(shop.context)).payments).toHaveLength(0)
    expect((await shop.context.post('/api/customers', { data: { name: 'Now open' } })).status()).toBe(201)
    await ownerPage.goto('/dashboard')
    await expect(ownerPage).toHaveURL(/\/dashboard$/)

    // The trial ends and Paddle charges the card.
    await send(transaction(card, { cents: 900, start: trialEnd, end: new Date(trialEnd.getTime() + 30 * DAY), origin: 'subscription_recurring' }))
    expect(await me()).toMatchObject({ state: 'active', needs_card: false })
    expect((await billingOf(shop.context)).payments).toEqual([expect.objectContaining({ amount: 9, currency: 'USD', months: 1 })])
    await owner.close()
    await shop.context.dispose()
  } finally {
    await page.goto('/admin/settings')
    await page.getByLabel('Require a card to start a trial').uncheck()
    await page.getByRole('button', { name: 'Save settings' }).click()
    await expect(page.getByRole('status')).toContainText('without a card')
  }
  // Shops that sign up now start as before.
  const later = await signUpShop(uniqueName('No Card Shop'))
  expect((await (await later.context.get('/api/auth/me')).json()).data.user.shop.subscription).toMatchObject({ needs_card: false, can_write: true })
  await later.context.dispose()
})
