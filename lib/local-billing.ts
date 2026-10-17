import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { getPool, iso, LocalDataError, withTransaction } from '@/lib/local-db'
import { insertPayment, lockSubscription, logEvent } from '@/lib/local-platform'
import { formatMoney, isCurrency } from '@/lib/money'
import { fromMinorUnits, planForPrice, type PaddleEvent, type PaddleSubscription, type PaddleTransaction } from '@/lib/paddle'
import { intervalMonths, isInterval, PLANS, type BillingInterval, type CardPlanId } from '@/lib/plans'
import { dayKey, DEFAULT_TIMEZONE } from '@/lib/time'

// What Paddle's webhooks do to a shop's subscription (lib/paddle.ts has the Paddle side).
//  - transaction.completed: a card payment went through (first payment, renewal or plan upgrade). It is
//    recorded like any other subscription payment (partner commission included) and the shop is paid
//    until the end of the billing period it covers.
//  - subscription.*: the subscription's state: plan, past due, cancellation scheduled or done.
//    The shop keeps any time it has paid for; a cancelled subscription simply stops renewing.
// Each event is handled once (billing_events), inside one transaction: if anything fails, nothing is
// stored and Paddle delivers it again later.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// The shop an event belongs to: the shop_id the checkout carried, or the shop already linked to the subscription.
async function shopFor(connection: PoolConnection, customData: Record<string, unknown> | null | undefined, subscriptionId: string | null) {
  const claimed = typeof customData?.shop_id === 'string' && UUID.test(customData.shop_id) ? customData.shop_id : null
  if (claimed) {
    const [[row]] = await connection.query<RowDataPacket[]>('SELECT shop_id FROM subscriptions WHERE shop_id = ?', [claimed])
    if (row) return row.shop_id as string
  }
  if (subscriptionId) {
    const [[row]] = await connection.query<RowDataPacket[]>('SELECT shop_id FROM subscriptions WHERE provider_subscription_id = ?', [subscriptionId])
    if (row) return row.shop_id as string
  }
  return null
}

// The plan and interval of the first item, from our price ids or, failing that, from Paddle's billing cycle.
function planOf(items: PaddleTransaction['items']): { plan: CardPlanId | null; interval: BillingInterval; frequency: number } {
  const price = items[0]?.price
  const known = planForPrice(price?.id)
  const cycle = price?.billing_cycle
  const interval = known?.interval ?? (isInterval(cycle?.interval) ? cycle.interval : 'month')
  return { plan: known?.plan ?? null, interval, frequency: cycle?.frequency ?? 1 }
}

const day = (date: Date) => dayKey(DEFAULT_TIMEZONE, date)

async function onTransactionCompleted(connection: PoolConnection, txn: PaddleTransaction) {
  if (!txn.subscription_id) return { shopId: null, outcome: 'ignored: not a subscription payment' }
  const shopId = await shopFor(connection, txn.custom_data, txn.subscription_id)
  if (!shopId) return { shopId: null, outcome: `ignored: no shop for ${txn.subscription_id}` }
  const current = await lockSubscription(connection, shopId)
  // The same payment can come back under another event id (e.g. a manual resend from Paddle).
  const [[seen]] = await connection.query<RowDataPacket[]>('SELECT id FROM subscription_payments WHERE provider_ref = ?', [txn.id])
  if (seen) return { shopId, outcome: `already recorded ${txn.id}` }
  const { plan, interval, frequency } = planOf(txn.items)
  const now = new Date()
  // The period this payment covers. Time already paid beyond it (e.g. a PKR transfer) is kept.
  const billedUntil = txn.billing_period?.ends_at ? new Date(txn.billing_period.ends_at) : null
  const periodEnd = billedUntil && billedUntil > current.periodEnd ? billedUntil : current.periodEnd
  // A plan change mid-period is charged pro rata and buys no extra time.
  const months = txn.origin === 'subscription_update' ? 0 : intervalMonths(interval, frequency)
  // What the shop paid, before sales tax (Paddle collects and remits the tax).
  const totals = txn.details?.totals
  const amount = totals ? Math.round((fromMinorUnits(totals.total) - fromMinorUnits(totals.tax)) * 100) / 100 : 0
  const currency = txn.currency_code?.toUpperCase()
  // A payment for a new subscription (a re-subscribe after cancelling) starts its state afresh. MariaDB
  // applies SET left to right, so these compare against the old subscription id before it is replaced.
  const columns = [
    "cancel_at_period_end = IF(provider_subscription_id <=> ?, cancel_at_period_end, 0)",
    "provider_status = IF(provider_subscription_id <=> ?, provider_status, 'active')",
    'provider_synced_at = IF(provider_subscription_id <=> ?, provider_synced_at, NULL)',
    // An admin's suspension stays until the admin resumes the shop. A $0 transaction (the start of a
    // card trial) leaves a trial a trial; money makes it active.
    "status = IF(status = 'suspended', 'suspended', IF(?, 'active', status))", "provider = 'paddle'", 'provider_customer_id = COALESCE(?, provider_customer_id)', 'provider_subscription_id = ?', 'current_period_end = ?', 'updated_at = ?',
  ]
  const values: unknown[] = [txn.subscription_id, txn.subscription_id, txn.subscription_id, amount > 0 ? 1 : 0, txn.customer_id, txn.subscription_id, periodEnd, now]
  if (plan) {
    columns.push('plan = ?', 'billing_interval = ?', 'price = ?', "currency = 'USD'")
    values.push(plan, interval, PLANS[plan].prices[interval] ?? amount)
  }
  await connection.query(`UPDATE subscriptions SET ${columns.join(', ')} WHERE shop_id = ?`, [...values, shopId])
  const planLabel = plan ? `${PLANS[plan].name} ${interval === 'year' ? 'yearly' : 'monthly'}` : 'card plan'
  if (amount > 0 && isCurrency(currency)) {
    await insertPayment(connection, shopId, { amount, currency, method: 'card', reference: txn.id, providerRef: txn.id, months, periodEnd, actorId: null }, now)
    await logEvent(connection, shopId, 'payment', `${formatMoney(amount, currency)} by card · ${planLabel}${months ? '' : ' (plan change)'} · paid until ${day(periodEnd)}`, null)
  } else if (amount > 0) {
    // A currency this install does not keep accounts in: the time is given, no payment is booked.
    await logEvent(connection, shopId, 'payment', `${currency} ${amount} by card · ${planLabel} · paid until ${day(periodEnd)}`, null)
  }
  // ($0: the start of a card trial, logged with the subscription, or a 100% discount.)
  return { shopId, outcome: `paid until ${day(periodEnd)}` }
}

async function onSubscriptionChange(connection: PoolConnection, sub: PaddleSubscription, occurredAt: Date) {
  const shopId = await shopFor(connection, sub.custom_data, sub.id)
  if (!shopId) return { shopId: null, outcome: `ignored: no shop for ${sub.id}` }
  await lockSubscription(connection, shopId)
  const [[row]] = await connection.query<RowDataPacket[]>('SELECT provider_subscription_id, provider_synced_at, cancel_at_period_end, provider_status FROM subscriptions WHERE shop_id = ?', [shopId])
  // Webhooks can arrive out of order; an older state never overwrites a newer one.
  if (row.provider_subscription_id === sub.id && row.provider_synced_at && new Date(row.provider_synced_at) > occurredAt) return { shopId, outcome: 'ignored: older than the state we have' }
  // A different, older subscription of the same shop ending (e.g. after a re-subscribe) leaves the current one alone.
  if (row.provider_subscription_id && row.provider_subscription_id !== sub.id && sub.status === 'canceled') return { shopId, outcome: 'ignored: not the current subscription' }
  const cancel = sub.status === 'canceled' || sub.status === 'paused' || sub.scheduled_change?.action === 'cancel' || sub.scheduled_change?.action === 'pause'
  const { plan, interval } = planOf(sub.items)
  const columns = ["provider = 'paddle'", 'provider_customer_id = ?', 'provider_subscription_id = ?', 'provider_status = ?', 'cancel_at_period_end = ?', 'provider_synced_at = ?', 'updated_at = ?']
  const values: unknown[] = [sub.customer_id, sub.id, sub.status.slice(0, 12), cancel ? 1 : 0, occurredAt, new Date()]
  if (plan) {
    columns.push('plan = ?', 'billing_interval = ?', 'price = ?', "currency = 'USD'")
    values.push(plan, interval, PLANS[plan].prices[interval] ?? 0)
  }
  // A card trial: the shop's trial runs until Paddle's (it charges the card that day). Never shortened.
  const trialEnd = sub.status === 'trialing' && sub.current_billing_period?.ends_at ? new Date(sub.current_billing_period.ends_at) : null
  if (trialEnd && Number.isFinite(trialEnd.getTime())) {
    columns.push('current_period_end = GREATEST(current_period_end, ?)')
    values.push(trialEnd)
  }
  await connection.query(`UPDATE subscriptions SET ${columns.join(', ')} WHERE shop_id = ?`, [...values, shopId])
  if (trialEnd && row.provider_subscription_id !== sub.id) await logEvent(connection, shopId, 'card_trial', `Card added · trial until ${day(trialEnd)}, then ${plan ? `${PLANS[plan].name} ${interval === 'year' ? 'yearly' : 'monthly'}` : 'the card plan'}`, null)

  const wasCancelled = Boolean(row.cancel_at_period_end) && row.provider_subscription_id === sub.id
  if (cancel && !wasCancelled) {
    const when = sub.scheduled_change?.effective_at ? ` · access until ${day(new Date(sub.scheduled_change.effective_at))}` : ''
    await logEvent(connection, shopId, 'card_cancelled', `${sub.status === 'paused' || sub.scheduled_change?.action === 'pause' ? 'Paused' : 'Cancelled'} in Paddle${when}`, null)
  } else if (!cancel && wasCancelled) {
    await logEvent(connection, shopId, 'card_resumed', 'Renews again', null)
  }
  if (sub.status === 'past_due' && row.provider_status !== 'past_due') await logEvent(connection, shopId, 'card_past_due', 'A renewal payment failed; Paddle is retrying the card', null)
  return { shopId, outcome: `subscription ${sub.status}${cancel ? ' (not renewing)' : ''}` }
}

const SUBSCRIPTION_EVENTS = new Set(['subscription.created', 'subscription.updated', 'subscription.activated', 'subscription.canceled', 'subscription.past_due', 'subscription.paused', 'subscription.resumed', 'subscription.trialing'])

// Handles one verified webhook event; returns what happened (also stored with the event).
export async function handlePaddleEvent(event: PaddleEvent) {
  if (typeof event?.event_id !== 'string' || typeof event.event_type !== 'string' || !event.data) throw new LocalDataError('Not a Paddle event.', 400)
  const occurredAt = Number.isFinite(Date.parse(event.occurred_at)) ? new Date(event.occurred_at) : new Date()
  return withTransaction(async (connection) => {
    const [inserted] = await connection.query<ResultSetHeader>(
      'INSERT IGNORE INTO billing_events (event_id, event_type, occurred_at, received_at) VALUES (?, ?, ?, ?)',
      [event.event_id.slice(0, 64), event.event_type.slice(0, 60), occurredAt, new Date()],
    )
    if (!inserted.affectedRows) return 'duplicate'
    let result: { shopId: string | null; outcome: string } = { shopId: null, outcome: 'ignored' }
    if (event.event_type === 'transaction.completed') result = await onTransactionCompleted(connection, event.data as PaddleTransaction)
    else if (SUBSCRIPTION_EVENTS.has(event.event_type)) result = await onSubscriptionChange(connection, event.data as PaddleSubscription, occurredAt)
    await connection.query('UPDATE billing_events SET shop_id = ?, outcome = ? WHERE event_id = ?', [result.shopId, result.outcome.slice(0, 200), event.event_id.slice(0, 64)])
    return result.outcome
  })
}

// The Paddle ids behind a shop's card subscription, for the portal and plan changes.
export async function paddleLink(shopId: string) {
  const [[row]] = await (await getPool()).query<RowDataPacket[]>('SELECT provider, provider_customer_id, provider_subscription_id, provider_status, cancel_at_period_end, plan, billing_interval FROM subscriptions WHERE shop_id = ?', [shopId])
  if (!row || row.provider !== 'paddle' || !row.provider_customer_id) return null
  return {
    customerId: row.provider_customer_id as string,
    subscriptionId: (row.provider_subscription_id as string | null) ?? null,
    // Still renewing (or retrying a failed renewal): the shop has a live card subscription.
    live: ['active', 'past_due', 'trialing'].includes(row.provider_status ?? 'active') && !row.cancel_at_period_end,
    cancelScheduled: Boolean(row.cancel_at_period_end) && ['active', 'past_due', 'trialing'].includes(row.provider_status ?? ''),
    plan: row.plan as string,
    interval: row.billing_interval as BillingInterval,
  }
}

// Recent webhook events for a shop (admin page), newest first.
export async function listBillingEvents(shopId: string, limit = 20) {
  const [rows] = await (await getPool()).query<RowDataPacket[]>('SELECT event_id, event_type, outcome, occurred_at, received_at FROM billing_events WHERE shop_id = ? ORDER BY received_at DESC LIMIT ?', [shopId, limit])
  return rows.map((row) => ({ id: row.event_id as string, type: row.event_type as string, outcome: row.outcome as string | null, occurred_at: iso(row.occurred_at), received_at: iso(row.received_at) }))
}
