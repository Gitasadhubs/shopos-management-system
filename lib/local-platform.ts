import { randomUUID } from 'node:crypto'
import type { PoolConnection, RowDataPacket } from 'mysql2/promise'
import { getPool, iso, likePattern, LocalDataError, PLAN_PRICE_PKR, roundMoney, TRIAL_DAYS, withTransaction, type Queryable } from '@/lib/local-db'
import { addCommissionForPayment } from '@/lib/affiliate-core'
import { getCountry } from '@/lib/countries'
import { fileUrl } from '@/lib/file-keys'
import { addTo, formatMoney, isCurrency, type Currency, type MoneyTotals } from '@/lib/money'
import { isInterval, monthlyValue, planName, PLANS, type BillingInterval } from '@/lib/plans'
import { addDays, dayKey, dayStart, DEFAULT_TIMEZONE } from '@/lib/time'

// Shops and their subscriptions. Shop owners read their own; platform admins (role 'admin') manage all.

export type SubscriptionState = 'trialing' | 'active' | 'suspended' | 'expired'
// price is per interval, in currency. provider 'paddle': a card subscription that renews by itself
// (cancel_at_period_end once the owner cancels it); 'manual': paid by transfer and recorded by an admin.
export type ShopSubscription = {
  plan: string; plan_name: string; state: SubscriptionState; price: number; currency: Currency; interval: BillingInterval; monthly_price: number
  current_period_end: string; days_left: number; can_write: boolean
  provider: 'manual' | 'paddle'; cancel_at_period_end: boolean; past_due: boolean
  // The trial waits for a card (signed up while trials needed one): read-only until it is added.
  needs_card: boolean
}
// report_*: the automatic day-end report (lib/day-end.ts).
export type ShopReportSettings = { report_enabled: boolean; report_time: string; report_email: string | null; report_whatsapp: string | null; report_last_sent_on: string | null }
export type LocalShop = { id: string; name: string; phone: string | null; address: string | null; receipt_footer: string | null; timezone: string; country: string; currency: string; language: string; daily_target: number | null; created_at: string; subscription: ShopSubscription } & ShopReportSettings
// country: ISO 3166-1 alpha-2 (lib/countries); 'ZZ' when not given.
export type ShopInput = { name: string; phone?: string | null; address?: string | null; receipt_footer?: string | null; timezone?: string; country?: string; currency?: string; language?: string }
// Settings saves only the fields it sends; anything left out keeps its value.
export type ShopUpdate = Partial<ShopInput> & Partial<Omit<ShopReportSettings, 'report_last_sent_on'>> & { daily_target?: number | null }
export type PaymentMethod = 'bank' | 'jazzcash' | 'easypaisa' | 'cash' | 'card' | 'other'
export type SubscriptionPayment = { id: string; shop_id: string; shop_name?: string; amount: number; currency: Currency; method: string; reference: string | null; months: number; period_end: string; created_at: string }
export type SubscriptionEvent = { id: string; event: string; detail: string | null; actor_name: string | null; created_at: string }
// reviewed_at: when an admin recorded a payment after this proof arrived; null while waiting.
export type PaymentProof = { id: string; shop_id: string; shop_name: string; url: string; content_type: string; size_bytes: number; note: string | null; uploaded_by_name: string | null; created_at: string; reviewed_at: string | null }

const DAY = 86_400_000

// A card renewal that fails is retried by Paddle for a few days; the shop keeps working meanwhile.
export const CARD_GRACE_DAYS = 3

// A trial or paid period that has run out is expired; suspension is the admin's switch.
// graceMs: extra time after the period end before it counts as expired (renewing card plans).
export function subscriptionState(status: string, periodEnd: Date | string, now = Date.now(), graceMs = 0): SubscriptionState {
  if (status === 'suspended') return 'suspended'
  if (new Date(periodEnd).getTime() + graceMs <= now) return 'expired'
  return status === 'active' ? 'active' : 'trialing'
}

// The subscription columns every shop query reads (lib/local-auth.ts reads them for the session too).
export const SUBSCRIPTION_COLUMNS = `subscriptions.plan AS sub_plan, subscriptions.status AS sub_status, subscriptions.price AS sub_price,
  subscriptions.currency AS sub_currency, subscriptions.billing_interval AS sub_interval, subscriptions.provider AS sub_provider,
  subscriptions.provider_status AS sub_provider_status, subscriptions.cancel_at_period_end AS sub_cancel, subscriptions.current_period_end AS sub_period_end,
  subscriptions.card_required AS sub_card_required`

export function subscriptionFromRow(row: RowDataPacket): ShopSubscription {
  const provider = row.sub_provider === 'paddle' ? 'paddle' : 'manual'
  const cancel = Boolean(row.sub_cancel)
  // A card subscription (paid, or in Paddle's free trial) renews by itself; its renewal gets the grace days.
  const renewing = provider === 'paddle' && !cancel && (row.sub_status === 'active' || row.sub_status === 'trialing')
  const state = subscriptionState(row.sub_status, row.sub_period_end, Date.now(), renewing ? CARD_GRACE_DAYS * DAY : 0)
  // Signed up while trials needed a card, and has neither a card subscription nor a payment yet.
  const needsCard = Boolean(row.sub_card_required) && state === 'trialing' && provider !== 'paddle'
  const interval: BillingInterval = isInterval(row.sub_interval) ? row.sub_interval : 'month'
  const price = Number(row.sub_price ?? PLAN_PRICE_PKR)
  const plan = row.sub_plan ?? 'basic'
  return {
    plan,
    plan_name: planName(plan),
    state,
    price,
    currency: isCurrency(row.sub_currency) ? row.sub_currency : 'PKR',
    interval,
    monthly_price: monthlyValue(price, interval),
    current_period_end: iso(row.sub_period_end),
    days_left: Math.max(0, Math.ceil((new Date(row.sub_period_end).getTime() - Date.now()) / DAY)),
    can_write: (state === 'trialing' || state === 'active') && !needsCard,
    provider,
    cancel_at_period_end: cancel,
    past_due: provider === 'paddle' && row.sub_provider_status === 'past_due',
    needs_card: needsCard,
  }
}

// --- platform settings (/admin/settings) ---------------------------------------------------------

export type PlatformSettings = { require_card_for_trial: boolean }
const SETTING_DEFAULTS: PlatformSettings = { require_card_for_trial: false }

export async function getPlatformSettings(db?: Queryable): Promise<PlatformSettings> {
  const [rows] = await (db ?? (await getPool())).query<RowDataPacket[]>('SELECT name, value FROM platform_settings')
  const stored = Object.fromEntries(rows.map((row) => [row.name as string, row.value as string]))
  return { require_card_for_trial: stored.require_card_for_trial === undefined ? SETTING_DEFAULTS.require_card_for_trial : stored.require_card_for_trial === 'true' }
}

export async function setPlatformSettings(changes: Partial<PlatformSettings>) {
  const pool = await getPool()
  for (const [name, value] of Object.entries(changes)) {
    await pool.query('INSERT INTO platform_settings (name, value, updated_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value), updated_at = VALUES(updated_at)', [name, String(value), new Date()])
  }
  return getPlatformSettings(pool)
}

const SHOP_SELECT = `SELECT shops.id, shops.name, shops.phone, shops.address, shops.receipt_footer, shops.timezone, shops.country, shops.currency, shops.language, shops.created_at,
  shops.daily_target, shops.report_enabled, shops.report_time, shops.report_email, shops.report_whatsapp, shops.report_last_sent_on,
  ${SUBSCRIPTION_COLUMNS}
  FROM shops JOIN subscriptions ON subscriptions.shop_id = shops.id`

function shopFromRow(row: RowDataPacket): LocalShop {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    address: row.address,
    receipt_footer: row.receipt_footer,
    timezone: row.timezone || DEFAULT_TIMEZONE,
    country: row.country || 'ZZ',
    currency: row.currency || 'PKR',
    language: row.language || 'en',
    daily_target: row.daily_target === null || row.daily_target === undefined ? null : Number(row.daily_target),
    report_enabled: Boolean(row.report_enabled),
    report_time: row.report_time ?? '22:00',
    report_email: row.report_email ?? null,
    report_whatsapp: row.report_whatsapp ?? null,
    // DATE columns arrive as midnight UTC (pool timezone 'Z'), so the ISO date part is the stored day.
    report_last_sent_on: row.report_last_sent_on ? iso(row.report_last_sent_on).slice(0, 10) : null,
    created_at: iso(row.created_at),
    subscription: subscriptionFromRow(row),
  }
}

export async function getShop(shopId: string, db?: Queryable) {
  const [rows] = await (db ?? (await getPool())).query<RowDataPacket[]>(`${SHOP_SELECT} WHERE shops.id = ?`, [shopId])
  return rows[0] ? shopFromRow(rows[0]) : null
}

export async function logEvent(db: Queryable, shopId: string, event: string, detail: string | null, actorId: string | null) {
  await db.query('INSERT INTO subscription_events (id, shop_id, event, detail, actor_id, created_at) VALUES (?, ?, ?, ?, ?, ?)', [randomUUID(), shopId, event, detail, actorId, new Date()])
}

// Every new shop starts on a free trial.
export async function createShopWithTrial(connection: PoolConnection, input: ShopInput & { referred_by?: string | null }) {
  const id = randomUUID()
  const now = new Date()
  // While trials need a card, the shop starts read-only and its trial starts when the card is added.
  const cardRequired = (await getPlatformSettings(connection)).require_card_for_trial
  // The country sets the defaults: time zone and receipt footer here, currency and the rest elsewhere.
  const country = getCountry(input.country)
  await connection.query(
    'INSERT INTO shops (id, name, phone, address, receipt_footer, timezone, country, currency, language, referred_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, input.name.trim(), input.phone?.trim() || null, input.address?.trim() || null, input.receipt_footer?.trim() || country.receipt.footer, input.timezone ?? country.timezone, country.code, input.currency ?? country.currency, input.language ?? country.language, input.referred_by ?? null, now, now],
  )
  await connection.query(
    'INSERT INTO subscriptions (shop_id, plan, status, price, currency, current_period_end, card_required, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, 'basic', 'trialing', PLAN_PRICE_PKR, 'PKR', new Date(now.getTime() + TRIAL_DAYS * DAY), cardRequired ? 1 : 0, now, now],
  )
  await logEvent(connection, id, 'trial_started', cardRequired ? `${TRIAL_DAYS}-day free trial, once a card is added` : `${TRIAL_DAYS}-day free trial`, null)
  return id
}

export async function updateShop(shopId: string, input: ShopUpdate) {
  const pool = await getPool()
  const text = (value: string | null | undefined) => value?.trim() || null
  const columns: Record<string, unknown> = {}
  if (input.name !== undefined) columns.name = input.name.trim()
  if (input.phone !== undefined) columns.phone = text(input.phone)
  if (input.address !== undefined) columns.address = text(input.address)
  if (input.receipt_footer !== undefined) columns.receipt_footer = text(input.receipt_footer)
  if (input.timezone !== undefined) columns.timezone = input.timezone || DEFAULT_TIMEZONE
  if (input.country !== undefined) columns.country = getCountry(input.country).code
  if (input.currency !== undefined) columns.currency = input.currency.toUpperCase()
  if (input.language !== undefined) columns.language = input.language
  if (input.daily_target !== undefined) columns.daily_target = input.daily_target && input.daily_target > 0 ? roundMoney(input.daily_target) : null
  if (input.report_enabled !== undefined) columns.report_enabled = input.report_enabled ? 1 : 0
  if (input.report_time !== undefined) columns.report_time = input.report_time
  if (input.report_email !== undefined) columns.report_email = text(input.report_email)
  if (input.report_whatsapp !== undefined) columns.report_whatsapp = text(input.report_whatsapp)
  const names = Object.keys(columns)
  // Column names come from the fixed list above, never from the request.
  if (names.length) await pool.query(`UPDATE shops SET ${names.map((name) => `${name} = ?`).join(', ')}, updated_at = ? WHERE id = ?`, [...Object.values(columns), new Date(), shopId])
  return (await getShop(shopId))!
}

function paymentFromRow(row: RowDataPacket): SubscriptionPayment {
  return {
    id: row.id,
    shop_id: row.shop_id,
    shop_name: row.shop_name ?? undefined,
    amount: Number(row.amount),
    currency: isCurrency(row.currency) ? row.currency : 'PKR',
    method: row.method,
    reference: row.reference,
    months: Number(row.months),
    period_end: iso(row.period_end),
    created_at: iso(row.created_at),
  }
}

const PROOF_SELECT = `SELECT payment_proofs.*, shops.name AS shop_name, users.full_name AS uploaded_by_name
  FROM payment_proofs JOIN shops ON shops.id = payment_proofs.shop_id LEFT JOIN users ON users.id = payment_proofs.uploaded_by`

function proofFromRow(row: RowDataPacket): PaymentProof {
  return {
    id: row.id,
    shop_id: row.shop_id,
    shop_name: row.shop_name,
    url: fileUrl(row.object_key),
    content_type: row.content_type,
    size_bytes: Number(row.size_bytes),
    note: row.note,
    uploaded_by_name: row.uploaded_by_name ?? null,
    created_at: iso(row.created_at),
    reviewed_at: row.reviewed_at ? iso(row.reviewed_at) : null,
  }
}

async function listShopProofs(shopId: string, limit: number) {
  const [rows] = await (await getPool()).query<RowDataPacket[]>(`${PROOF_SELECT} WHERE payment_proofs.shop_id = ? ORDER BY payment_proofs.created_at DESC LIMIT ?`, [shopId, limit])
  return rows.map(proofFromRow)
}

// What a shop owner sees on the Billing page.
export async function getBilling(shopId: string) {
  const pool = await getPool()
  const shop = await getShop(shopId)
  if (!shop) throw new LocalDataError('Shop not found.', 404)
  const [payments] = await pool.query<RowDataPacket[]>('SELECT * FROM subscription_payments WHERE shop_id = ? ORDER BY created_at DESC LIMIT 24', [shopId])
  return { shop, payments: payments.map(paymentFromRow), proofs: await listShopProofs(shopId, 10) }
}

// Enough for real payments, too few to use the bucket as free file hosting.
export const PROOFS_PER_DAY = 10

export async function assertProofAllowance(shopId: string) {
  const [[recent]] = await (await getPool()).query<RowDataPacket[]>('SELECT COUNT(*) AS n FROM payment_proofs WHERE shop_id = ? AND created_at >= ?', [shopId, new Date(Date.now() - DAY)])
  if (Number(recent.n) >= PROOFS_PER_DAY) throw new LocalDataError(`At most ${PROOFS_PER_DAY} proofs a day. Message us on WhatsApp if you need to send more.`, 429)
}

// The owner sends a screenshot of a payment (already stored at key); the platform admin checks it
// and records the payment.
export async function addPaymentProof(actorId: string, shopId: string, file: { key: string; type: string; size: number }, note: string | null) {
  const id = randomUUID()
  await withTransaction(async (connection) => {
    await connection.query(
      'INSERT INTO payment_proofs (id, shop_id, object_key, content_type, size_bytes, note, uploaded_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [id, shopId, file.key, file.type, file.size, note?.trim() || null, actorId, new Date()],
    )
    await logEvent(connection, shopId, 'proof_sent', note?.trim() || null, actorId)
  })
  const [rows] = await (await getPool()).query<RowDataPacket[]>(`${PROOF_SELECT} WHERE payment_proofs.id = ?`, [id])
  return proofFromRow(rows[0])
}

// Proofs no admin has acted on yet, oldest first.
export async function listPendingPaymentProofs(limit = 50) {
  const [rows] = await (await getPool()).query<RowDataPacket[]>(`${PROOF_SELECT} WHERE payment_proofs.reviewed_at IS NULL ORDER BY payment_proofs.created_at LIMIT ?`, [limit])
  return rows.map(proofFromRow)
}

// --- platform admin --------------------------------------------------------------------------

export async function platformOverview() {
  const pool = await getPool()
  const [rows] = await pool.query<RowDataPacket[]>(`${SHOP_SELECT} ORDER BY shops.created_at DESC`)
  const shops = rows.map(shopFromRow)
  const count = (state: SubscriptionState) => shops.filter((shop) => shop.subscription.state === state).length
  const thisMonth = dayKey(DEFAULT_TIMEZONE).slice(0, 7)
  const monthStart = dayStart(DEFAULT_TIMEZONE, `${thisMonth}-01`)
  const sixMonthsAgo = dayStart(DEFAULT_TIMEZONE, `${addDays(`${thisMonth}-01`, -160).slice(0, 7)}-01`)
  // Every money figure is per currency (USD card plans, PKR transfers): they are never added together.
  const totalsOf = (rows: RowDataPacket[]) => rows.reduce<MoneyTotals>((totals, row) => addTo(totals, row.currency, Number(row.total)), {})
  const [revenue] = await pool.query<RowDataPacket[]>('SELECT currency, SUM(amount) AS total FROM subscription_payments WHERE created_at >= ? GROUP BY currency', [monthStart])
  const [paymentRows] = await pool.query<RowDataPacket[]>('SELECT amount, currency, created_at FROM subscription_payments WHERE created_at >= ?', [sixMonthsAgo])
  const [allTime] = await pool.query<RowDataPacket[]>('SELECT currency, SUM(amount) AS total FROM subscription_payments GROUP BY currency')
  const byMonth = new Map<string, MoneyTotals>()
  for (let index = 5; index >= 0; index -= 1) {
    const date = new Date(`${thisMonth}-01T00:00:00Z`)
    date.setUTCMonth(date.getUTCMonth() - index)
    byMonth.set(date.toISOString().slice(0, 7), {})
  }
  for (const row of paymentRows) {
    const key = dayKey(DEFAULT_TIMEZONE, new Date(row.created_at)).slice(0, 7)
    if (byMonth.has(key)) addTo(byMonth.get(key)!, row.currency, Number(row.amount))
  }
  const weekAgo = Date.now() - 7 * DAY
  const soon = Date.now() + 7 * DAY
  return {
    totalShops: shops.length,
    trialing: count('trialing'),
    active: count('active'),
    expired: count('expired'),
    suspended: count('suspended'),
    // Yearly plans count as a twelfth of their price.
    mrr: shops.filter((shop) => shop.subscription.state === 'active').reduce<MoneyTotals>((totals, shop) => addTo(totals, shop.subscription.currency, shop.subscription.monthly_price), {}),
    revenueThisMonth: totalsOf(revenue),
    revenueAllTime: totalsOf(allTime),
    signups7d: shops.filter((shop) => new Date(shop.created_at).getTime() >= weekAgo).length,
    revenueByMonth: [...byMonth.entries()].map(([month, total]) => ({ month, total })),
    expiringSoon: shops.filter((shop) => ['trialing', 'active'].includes(shop.subscription.state) && new Date(shop.subscription.current_period_end).getTime() <= soon)
      .sort((a, b) => a.subscription.current_period_end.localeCompare(b.subscription.current_period_end)).slice(0, 8),
    latest: shops.slice(0, 8),
  }
}

export type AdminShopRow = LocalShop & { owner_email: string | null; owner_name: string | null; users: number; products: number; sales_30d: number; last_sale_at: string | null }

export async function listShopsForAdmin(filters: { search?: string; state?: SubscriptionState | 'all' } = {}) {
  const pool = await getPool()
  const search = (filters.search ?? '').trim()
  const like = likePattern(search)
  const [rows] = await pool.query<RowDataPacket[]>(
    `${SHOP_SELECT}
     WHERE (? = '' OR shops.name LIKE ? OR shops.phone LIKE ? OR EXISTS (SELECT 1 FROM users WHERE users.shop_id = shops.id AND users.email LIKE ?))
     ORDER BY shops.created_at DESC`,
    [search, like, like, like],
  )
  const ids = rows.map((row) => row.id as string)
  const stats = new Map<string, { users: number; products: number; sales: number; last: string | null; owner_email: string | null; owner_name: string | null }>()
  if (ids.length) {
    const [users] = await pool.query<RowDataPacket[]>("SELECT shop_id, COUNT(*) AS n, MAX(IF(role = 'owner', email, NULL)) AS owner_email, MAX(IF(role = 'owner', full_name, NULL)) AS owner_name FROM users WHERE shop_id IN (?) GROUP BY shop_id", [ids])
    const [products] = await pool.query<RowDataPacket[]>('SELECT shop_id, COUNT(*) AS n FROM products WHERE is_active = 1 AND shop_id IN (?) GROUP BY shop_id', [ids])
    const [sales] = await pool.query<RowDataPacket[]>('SELECT shop_id, SUM(created_at >= ?) AS n, MAX(created_at) AS last FROM sales WHERE shop_id IN (?) GROUP BY shop_id', [new Date(Date.now() - 30 * DAY), ids])
    for (const id of ids) stats.set(id, { users: 0, products: 0, sales: 0, last: null, owner_email: null, owner_name: null })
    for (const row of users) Object.assign(stats.get(row.shop_id)!, { users: Number(row.n), owner_email: row.owner_email, owner_name: row.owner_name })
    for (const row of products) stats.get(row.shop_id)!.products = Number(row.n)
    for (const row of sales) Object.assign(stats.get(row.shop_id)!, { sales: Number(row.n ?? 0), last: row.last ? iso(row.last) : null })
  }
  const shops: AdminShopRow[] = rows.map((row) => {
    const extra = stats.get(row.id)!
    return { ...shopFromRow(row), owner_email: extra.owner_email, owner_name: extra.owner_name, users: extra.users, products: extra.products, sales_30d: extra.sales, last_sale_at: extra.last }
  })
  return filters.state && filters.state !== 'all' ? shops.filter((shop) => shop.subscription.state === filters.state) : shops
}

export async function getShopForAdmin(shopId: string) {
  const pool = await getPool()
  const shop = await getShop(shopId)
  if (!shop) return null
  const [users] = await pool.query<RowDataPacket[]>('SELECT id, email, full_name, role, is_active, email_verified_at, last_login_at, created_at FROM users WHERE shop_id = ? ORDER BY role = \'owner\' DESC, full_name', [shopId])
  const [[usage]] = await pool.query<RowDataPacket[]>(
    `SELECT (SELECT COUNT(*) FROM products WHERE shop_id = ? AND is_active = 1) AS products,
            (SELECT COUNT(*) FROM customers WHERE shop_id = ? AND is_active = 1) AS customers,
            (SELECT COUNT(*) FROM sales WHERE shop_id = ?) AS sales,
            (SELECT COALESCE(SUM(total), 0) FROM sales WHERE shop_id = ? AND created_at >= ?) AS revenue_30d,
            (SELECT MAX(created_at) FROM sales WHERE shop_id = ?) AS last_sale_at`,
    [shopId, shopId, shopId, shopId, new Date(Date.now() - 30 * DAY), shopId],
  )
  const [payments] = await pool.query<RowDataPacket[]>('SELECT * FROM subscription_payments WHERE shop_id = ? ORDER BY created_at DESC', [shopId])
  const [events] = await pool.query<RowDataPacket[]>(
    'SELECT subscription_events.*, users.full_name AS actor_name FROM subscription_events LEFT JOIN users ON users.id = subscription_events.actor_id WHERE subscription_events.shop_id = ? ORDER BY subscription_events.created_at DESC LIMIT 50',
    [shopId],
  )
  return {
    shop,
    users: users.map((row) => ({ id: row.id as string, email: row.email as string, full_name: row.full_name as string, role: row.role as string, is_active: Boolean(row.is_active), email_verified: Boolean(row.email_verified_at), last_login_at: row.last_login_at ? iso(row.last_login_at) : null, created_at: iso(row.created_at) })),
    usage: { products: Number(usage.products), customers: Number(usage.customers), sales: Number(usage.sales), revenue_30d: roundMoney(Number(usage.revenue_30d)), last_sale_at: usage.last_sale_at ? iso(usage.last_sale_at) : null },
    payments: payments.map(paymentFromRow),
    proofs: await listShopProofs(shopId, 20),
    events: events.map((row): SubscriptionEvent => ({ id: row.id, event: row.event, detail: row.detail, actor_name: row.actor_name, created_at: iso(row.created_at) })),
  }
}

export async function lockSubscription(connection: PoolConnection, shopId: string) {
  const [rows] = await connection.query<RowDataPacket[]>('SELECT status, current_period_end, currency, provider, cancel_at_period_end FROM subscriptions WHERE shop_id = ? FOR UPDATE', [shopId])
  if (!rows[0]) throw new LocalDataError('Shop not found.', 404)
  return {
    status: rows[0].status as string,
    periodEnd: new Date(rows[0].current_period_end),
    currency: (isCurrency(rows[0].currency) ? rows[0].currency : 'PKR') as Currency,
    provider: rows[0].provider as string,
    cancel: Boolean(rows[0].cancel_at_period_end),
  }
}

// Paid time is added on top of time already paid for, never lost.
function addMonths(from: Date, months: number) {
  const date = new Date(from)
  const day = date.getUTCDate()
  date.setUTCMonth(date.getUTCMonth() + months)
  // 31 Jan + 1 month lands on 28/29 Feb rather than rolling into March.
  if (date.getUTCDate() < day) date.setUTCDate(0)
  return date
}

const formatDay = (date: Date) => dayKey(DEFAULT_TIMEZONE, date)

// A payment received by transfer, recorded by an admin from the shop's page.
export async function recordSubscriptionPayment(actorId: string, shopId: string, input: { amount: number; currency?: Currency; method: PaymentMethod; reference?: string | null; months: number }) {
  return withTransaction(async (connection) => {
    const current = await lockSubscription(connection, shopId)
    const base = current.periodEnd.getTime() > Date.now() ? current.periodEnd : new Date()
    const periodEnd = addMonths(base, input.months)
    const now = new Date()
    const currency = input.currency ?? current.currency
    await connection.query('UPDATE subscriptions SET status = ?, current_period_end = ?, updated_at = ? WHERE shop_id = ?', ['active', periodEnd, now, shopId])
    await insertPayment(connection, shopId, { amount: input.amount, currency, method: input.method, reference: input.reference?.trim() || null, providerRef: null, months: input.months, periodEnd, actorId }, now)
    // The proofs sent so far are what this payment answers.
    await connection.query('UPDATE payment_proofs SET reviewed_at = ? WHERE shop_id = ? AND reviewed_at IS NULL', [now, shopId])
    await logEvent(connection, shopId, 'payment', `${formatMoney(roundMoney(input.amount), currency)} via ${input.method} · ${input.months} month${input.months === 1 ? '' : 's'} · paid until ${formatDay(periodEnd)}`, actorId)
  })
}

// Every subscription payment, from an admin or from Paddle. A shop that came through a partner's link
// earns that partner a commission in the payment's currency (lib/affiliate-core.ts).
export async function insertPayment(
  connection: PoolConnection, shopId: string,
  payment: { amount: number; currency: Currency; method: PaymentMethod; reference: string | null; providerRef: string | null; months: number; periodEnd: Date; actorId: string | null },
  now: Date,
) {
  const id = randomUUID()
  const amount = roundMoney(payment.amount)
  await connection.query(
    'INSERT INTO subscription_payments (id, shop_id, amount, currency, method, reference, provider_ref, months, period_end, recorded_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, shopId, amount, payment.currency, payment.method, payment.reference, payment.providerRef, payment.months, payment.periodEnd, payment.actorId, now],
  )
  await addCommissionForPayment(connection, shopId, { id, amount, currency: payment.currency, months: payment.months }, now)
  return id
}

export type SubscriptionAction =
  | { action: 'add_days'; days: number } | { action: 'suspend' } | { action: 'resume' } | { action: 'expire' }
  | { action: 'set_plan'; plan: 'basic' | 'starter' | 'growth'; interval: BillingInterval; price: number }

export async function changeSubscription(actorId: string, shopId: string, change: SubscriptionAction) {
  return withTransaction(async (connection) => {
    const current = await lockSubscription(connection, shopId)
    const now = new Date()
    if (change.action === 'add_days') {
      const base = current.periodEnd.getTime() > Date.now() ? current.periodEnd : now
      const periodEnd = new Date(base.getTime() + change.days * DAY)
      await connection.query('UPDATE subscriptions SET current_period_end = ?, updated_at = ? WHERE shop_id = ?', [periodEnd, now, shopId])
      await logEvent(connection, shopId, 'extended', `+${change.days} day${change.days === 1 ? '' : 's'} · until ${formatDay(periodEnd)}`, actorId)
    } else if (change.action === 'suspend') {
      if (current.status === 'suspended') throw new LocalDataError('This shop is already suspended.', 409)
      await connection.query("UPDATE subscriptions SET status = 'suspended', updated_at = ? WHERE shop_id = ?", [now, shopId])
      await logEvent(connection, shopId, 'suspended', null, actorId)
    } else if (change.action === 'resume') {
      if (current.status !== 'suspended') throw new LocalDataError('This shop is not suspended.', 409)
      // Back to whatever it was before: paid if it has ever paid, otherwise a trial.
      const [[paid]] = await connection.query<RowDataPacket[]>('SELECT COUNT(*) AS n FROM subscription_payments WHERE shop_id = ?', [shopId])
      await connection.query('UPDATE subscriptions SET status = ?, updated_at = ? WHERE shop_id = ?', [Number(paid.n) ? 'active' : 'trialing', now, shopId])
      await logEvent(connection, shopId, 'resumed', null, actorId)
    } else if (change.action === 'expire') {
      await connection.query('UPDATE subscriptions SET current_period_end = ?, updated_at = ? WHERE shop_id = ?', [now, now, shopId])
      await logEvent(connection, shopId, 'expired', 'Ended by an admin', actorId)
    } else {
      // A card subscription's plan follows Paddle; changing it here would be overwritten by the next renewal.
      if (current.provider === 'paddle' && !current.cancel) throw new LocalDataError('This shop pays by card. Its plan changes from its own Billing page (or in Paddle).', 409)
      const currency = PLANS[change.plan].currency
      const interval = change.plan === 'basic' ? 'month' : change.interval
      await connection.query(
        "UPDATE subscriptions SET plan = ?, billing_interval = ?, price = ?, currency = ?, provider = 'manual', updated_at = ? WHERE shop_id = ?",
        [change.plan, interval, roundMoney(change.price), currency, now, shopId],
      )
      await logEvent(connection, shopId, 'price_changed', `${PLANS[change.plan].name} · ${formatMoney(roundMoney(change.price), currency)} per ${interval}`, actorId)
    }
  })
}

export async function listSubscriptionPayments(limit = 100) {
  const pool = await getPool()
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT subscription_payments.*, shops.name AS shop_name FROM subscription_payments JOIN shops ON shops.id = subscription_payments.shop_id ORDER BY subscription_payments.created_at DESC LIMIT ?',
    [limit],
  )
  return rows.map(paymentFromRow)
}
