import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { getPool, iso, roundMoney } from '@/lib/local-db'
import { listExpenses } from '@/lib/local-expenses'
import { getShop, type LocalShop } from '@/lib/local-platform'
import { sendDayEndEmail } from '@/lib/mailer'
import { addDays, dayKey, dayStart } from '@/lib/time'
import { normalizePhone, parsePhoneList, sendWhatsAppTemplate, whatsAppConfigured } from '@/lib/whatsapp'

// The day-end ("closing") report: what one shop sold, earned, spent and should have in the drawer
// on one calendar day in its time zone. Shown in the app, shared on WhatsApp, and sent automatically.

// A shop-local calendar day in a query or body.
export const dayParam = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)))

const money = (value: number) => `₨ ${Number(value).toLocaleString('en-PK', { maximumFractionDigits: 2 })}`

export async function getDayEnd(shopId: string, timezone: string, day: string) {
  const pool = await getPool()
  const start = dayStart(timezone, day)
  const end = dayStart(timezone, addDays(day, 1))
  const yesterdayStart = dayStart(timezone, addDays(day, -1))

  const [sales] = await pool.query<RowDataPacket[]>(
    `SELECT payment_method, total, discount, amount_paid, credit_amount,
       COALESCE((SELECT SUM(cost_price * quantity) FROM sale_items WHERE sale_items.sale_id = sales.id), 0) AS cogs
     FROM sales WHERE shop_id = ? AND created_at >= ? AND created_at < ?`,
    [shopId, start, end],
  )
  const [[yesterday]] = await pool.query<RowDataPacket[]>('SELECT COALESCE(SUM(total), 0) AS total FROM sales WHERE shop_id = ? AND created_at >= ? AND created_at < ?', [shopId, yesterdayStart, start])
  const [items] = await pool.query<RowDataPacket[]>(
    `SELECT sale_items.product_name AS name, SUM(sale_items.quantity) AS quantity, SUM(sale_items.subtotal) AS revenue
     FROM sale_items JOIN sales ON sales.id = sale_items.sale_id WHERE sales.shop_id = ? AND sales.created_at >= ? AND sales.created_at < ?
     GROUP BY sale_items.product_name ORDER BY quantity DESC, revenue DESC LIMIT 5`,
    [shopId, start, end],
  )
  const [[khata]] = await pool.query<RowDataPacket[]>("SELECT COALESCE(-SUM(amount), 0) AS received FROM customer_ledger WHERE shop_id = ? AND kind = 'payment' AND created_at >= ? AND created_at < ?", [shopId, start, end])
  const [[supplierPaid]] = await pool.query<RowDataPacket[]>("SELECT COALESCE(-SUM(amount), 0) AS paid FROM supplier_ledger WHERE shop_id = ? AND kind = 'payment' AND created_at >= ? AND created_at < ?", [shopId, start, end])
  const [[purchases]] = await pool.query<RowDataPacket[]>('SELECT COALESCE(SUM(total), 0) AS total, COALESCE(SUM(amount_paid), 0) AS paid, COUNT(*) AS count FROM purchases WHERE shop_id = ? AND created_at >= ? AND created_at < ?', [shopId, start, end])
  const [[low]] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) AS count FROM products WHERE shop_id = ? AND is_active = 1 AND stock_quantity <= reorder_level', [shopId])
  const spent = await listExpenses(shopId, day, day)

  const methods = { cash: 0, card: 0, credit: 0 }
  let revenue = 0
  let cogs = 0
  let discounts = 0
  let creditGiven = 0
  let paidOnCredit = 0
  for (const sale of sales) {
    const total = Number(sale.total)
    revenue += total
    cogs += Number(sale.cogs)
    discounts += Number(sale.discount)
    if (sale.payment_method in methods) methods[sale.payment_method as keyof typeof methods] += total
    if (sale.payment_method === 'credit') {
      creditGiven += Number(sale.credit_amount)
      paidOnCredit += Number(sale.amount_paid)
    }
  }
  const grossProfit = roundMoney(revenue - cogs)
  // Assumes everything that is not a card payment changed hands in cash.
  const cashIn = methods.cash + paidOnCredit + Number(khata.received)
  const cashOut = Number(supplierPaid.paid) + Number(purchases.paid) + spent.total
  const yesterdayTotal = Number(yesterday.total)

  return {
    day,
    sales: { revenue: roundMoney(revenue), count: sales.length, average: sales.length ? roundMoney(revenue / sales.length) : 0, discounts: roundMoney(discounts), cogs: roundMoney(cogs) },
    vsYesterday: yesterdayTotal ? Math.round(((revenue - yesterdayTotal) / yesterdayTotal) * 100) : null,
    methods: { cash: roundMoney(methods.cash), card: roundMoney(methods.card), credit: roundMoney(methods.credit) },
    grossProfit,
    expenses: spent,
    netProfit: roundMoney(grossProfit - spent.total),
    khata: { given: roundMoney(creditGiven), received: roundMoney(Number(khata.received)) },
    suppliers: { purchases: roundMoney(Number(purchases.total)), purchaseCount: Number(purchases.count), paid: roundMoney(Number(supplierPaid.paid) + Number(purchases.paid)) },
    cash: { in: roundMoney(cashIn), out: roundMoney(cashOut), expected: roundMoney(cashIn - cashOut) },
    topItems: items.map((item) => ({ name: item.name as string, quantity: Number(item.quantity), revenue: roundMoney(Number(item.revenue)) })),
    lowStock: Number(low.count),
  }
}

export type DayEnd = Awaited<ReturnType<typeof getDayEnd>>

function longDate(day: string) {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString('en-PK', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
}

// WhatsApp-friendly text: *bold*, emoji, one figure per line.
export function dayEndText(shopName: string, report: DayEnd) {
  const change = report.vsYesterday === null ? '' : ` ${report.vsYesterday >= 0 ? '▲' : '▼'} ${Math.abs(report.vsYesterday)}% vs yesterday`
  const lines = [
    `*${shopName} — day-end report*`,
    longDate(report.day),
    '',
    `💰 Sales: ${money(report.sales.revenue)} (${report.sales.count} sale${report.sales.count === 1 ? '' : 's'})${change}`,
    `📈 Gross profit: ${money(report.grossProfit)}`,
    `🧾 Expenses: ${money(report.expenses.total)}`,
    `✅ Net profit: ${money(report.netProfit)}`,
    '',
    `💵 Cash ${money(report.methods.cash)} · 💳 Card ${money(report.methods.card)} · 📒 Khata ${money(report.methods.credit)}`,
  ]
  if (report.khata.received) lines.push(`📥 Khata received: ${money(report.khata.received)}`)
  if (report.suppliers.paid) lines.push(`📤 Paid to suppliers: ${money(report.suppliers.paid)}`)
  lines.push(`🗄️ Cash expected in drawer: ${money(report.cash.expected)}`)
  if (report.topItems.length) lines.push('', `🏆 Top items: ${report.topItems.map((item) => `${item.name} ×${item.quantity}`).join(', ')}`)
  if (report.lowStock) lines.push(`⚠️ Low stock: ${report.lowStock} product${report.lowStock === 1 ? '' : 's'}`)
  lines.push('', '— Sent from ShopOS')
  return lines.join('\n')
}

// --- delivery ---------------------------------------------------------------------------------

export type Delivery = { channel: 'email' | 'whatsapp'; recipient: string; status: 'sent' | 'failed' | 'skipped'; error?: string }

async function ownerEmail(shopId: string) {
  const [rows] = await (await getPool()).query<RowDataPacket[]>("SELECT email FROM users WHERE shop_id = ? AND role = 'owner' AND is_active = 1 LIMIT 1", [shopId])
  return (rows[0]?.email as string | undefined) ?? null
}

async function logDelivery(shopId: string, day: string, delivery: Delivery) {
  await (await getPool()).query(
    'INSERT INTO report_deliveries (id, shop_id, day, channel, recipient, status, error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [randomUUID(), shopId, day, delivery.channel, delivery.recipient.slice(0, 254), delivery.status, delivery.error?.slice(0, 500) ?? null, new Date()],
  )
}

// Sends one shop's report for one day to its email address and WhatsApp numbers.
export async function sendDayEnd(shop: LocalShop, day: string) {
  const report = await getDayEnd(shop.id, shop.timezone, day)
  const text = dayEndText(shop.name, report)
  const deliveries: Delivery[] = []

  const email = shop.report_email || (await ownerEmail(shop.id))
  if (email) {
    try {
      const rows: Array<[string, string]> = [
        ['Sales', `${money(report.sales.revenue)} (${report.sales.count})`], ['Gross profit', money(report.grossProfit)], ['Expenses', money(report.expenses.total)], ['Net profit', money(report.netProfit)],
        ['Cash', money(report.methods.cash)], ['Card', money(report.methods.card)], ['Khata (credit)', money(report.methods.credit)], ['Khata received', money(report.khata.received)], ['Cash expected in drawer', money(report.cash.expected)],
      ]
      const footer = report.topItems.length ? `Top items: ${report.topItems.map((item) => `${item.name} ×${item.quantity}`).join(', ')}` : 'No items sold.'
      await sendDayEndEmail(email, `${shop.name} — day-end report for ${longDate(day)}`, text, rows, footer)
      deliveries.push({ channel: 'email', recipient: email, status: 'sent' })
    } catch (error) {
      deliveries.push({ channel: 'email', recipient: email, status: 'failed', error: error instanceof Error ? error.message : 'Email failed.' })
    }
  }

  for (const number of parsePhoneList(shop.report_whatsapp)) {
    if (!whatsAppConfigured()) {
      deliveries.push({ channel: 'whatsapp', recipient: number, status: 'skipped', error: 'WhatsApp sending is not set up on this server yet.' })
      continue
    }
    try {
      await sendWhatsAppTemplate(number, [shop.name, longDate(day), money(report.sales.revenue), String(report.sales.count), money(report.grossProfit), money(report.expenses.total), money(report.netProfit), money(report.cash.expected)])
      deliveries.push({ channel: 'whatsapp', recipient: normalizePhone(number) ?? number, status: 'sent' })
    } catch (error) {
      deliveries.push({ channel: 'whatsapp', recipient: number, status: 'failed', error: error instanceof Error ? error.message : 'WhatsApp failed.' })
    }
  }

  for (const delivery of deliveries) await logDelivery(shop.id, day, delivery)
  return { report, text, deliveries }
}

export async function listDeliveries(shopId: string, limit = 10) {
  const [rows] = await (await getPool()).query<RowDataPacket[]>('SELECT * FROM report_deliveries WHERE shop_id = ? ORDER BY created_at DESC LIMIT ?', [shopId, limit])
  return rows.map((row) => ({ id: row.id as string, day: iso(row.day).slice(0, 10), channel: row.channel as string, recipient: row.recipient as string, status: row.status as string, error: row.error as string | null, created_at: iso(row.created_at) }))
}

// --- schedule ---------------------------------------------------------------------------------

function localTime(zone: string, at = new Date()) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at)
}

// Sends every report that is due: the shop's report time has passed today and today's report has
// not gone out. Several app instances may run this; the UPDATE lets only one of them claim a shop.
export async function runDueReports() {
  const pool = await getPool()
  const [shops] = await pool.query<RowDataPacket[]>(
    `SELECT shops.id, shops.timezone, shops.report_time, shops.report_last_sent_on FROM shops JOIN subscriptions ON subscriptions.shop_id = shops.id
     WHERE shops.report_enabled = 1 AND subscriptions.status <> 'suspended' AND subscriptions.current_period_end > ?`,
    [new Date()],
  )
  for (const row of shops) {
    const today = dayKey(row.timezone)
    if (localTime(row.timezone) < row.report_time) continue
    if (row.report_last_sent_on && iso(row.report_last_sent_on).slice(0, 10) >= today) continue
    const [claim] = await pool.query<ResultSetHeader>('UPDATE shops SET report_last_sent_on = ? WHERE id = ? AND (report_last_sent_on IS NULL OR report_last_sent_on < ?)', [today, row.id, today])
    if (!claim.affectedRows) continue
    try {
      const shop = await getShop(row.id)
      if (shop) await sendDayEnd(shop, today)
    } catch (error) {
      console.error('[day-end] report failed for shop', row.id, error)
    }
  }
}

const timer = globalThis as typeof globalThis & { shoposDayEndTimer?: ReturnType<typeof setInterval> }

export function startDayEndScheduler() {
  if (timer.shoposDayEndTimer) return
  const tick = () => runDueReports().catch((error) => console.error('[day-end] scheduler error', error))
  timer.shoposDayEndTimer = setInterval(tick, 60_000)
  timer.shoposDayEndTimer.unref?.()
}
