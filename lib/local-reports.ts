import type { RowDataPacket } from 'mysql2/promise'
import { getPool, LocalDataError, roundMoney } from '@/lib/local-db'
import { expensesTotal } from '@/lib/local-expenses'
import { addDays, dayKey, dayRange, dayStart } from '@/lib/time'

// Sales reports for one shop over a range of whole days in the shop's time zone.

export const MAX_REPORT_DAYS = 366

export async function getReport(shopId: string, timezone: string, from: string, to: string) {
  if (from > to) throw new LocalDataError('The start date must be on or before the end date.', 400)
  const days = dayRange(from, to)
  if (days.length > MAX_REPORT_DAYS) throw new LocalDataError(`Choose a range of at most ${MAX_REPORT_DAYS} days.`, 400)
  const start = dayStart(timezone, from)
  const end = dayStart(timezone, addDays(to, 1))
  const pool = await getPool()

  const [saleRows] = await pool.query<RowDataPacket[]>(
    `SELECT sales.id, sales.total, sales.discount, sales.payment_method, sales.credit_amount, sales.created_at,
       COALESCE((SELECT SUM(cost_price * quantity) FROM sale_items WHERE sale_items.sale_id = sales.id), 0) AS cogs
     FROM sales WHERE sales.shop_id = ? AND sales.created_at >= ? AND sales.created_at < ?`,
    [shopId, start, end],
  )
  const [productRows] = await pool.query<RowDataPacket[]>(
    `SELECT sale_items.product_id, MAX(sale_items.product_name) AS name, SUM(sale_items.quantity) AS quantity, SUM(sale_items.subtotal) AS revenue,
       SUM((sale_items.unit_price - sale_items.cost_price) * sale_items.quantity) AS margin
     FROM sale_items JOIN sales ON sales.id = sale_items.sale_id
     WHERE sales.shop_id = ? AND sales.created_at >= ? AND sales.created_at < ?
     GROUP BY sale_items.product_id ORDER BY revenue DESC LIMIT 10`,
    [shopId, start, end],
  )
  const [[purchases]] = await pool.query<RowDataPacket[]>('SELECT COALESCE(SUM(total), 0) AS total, COUNT(*) AS count FROM purchases WHERE shop_id = ? AND created_at >= ? AND created_at < ?', [shopId, start, end])
  const expenses = await expensesTotal(shopId, from, to)
  const [[payables]] = await pool.query<RowDataPacket[]>('SELECT COALESCE(SUM(balance), 0) AS total FROM suppliers WHERE shop_id = ? AND is_active = 1', [shopId])

  const daily = new Map(days.map((day) => [day, { day, revenue: 0, profit: 0, count: 0 }]))
  const methods = new Map<string, { method: string; total: number; count: number }>()
  let revenue = 0
  let cogs = 0
  let discounts = 0
  let creditGiven = 0
  for (const row of saleRows) {
    const total = Number(row.total)
    const cost = Number(row.cogs)
    revenue += total
    cogs += cost
    discounts += Number(row.discount)
    creditGiven += Number(row.credit_amount)
    const bucket = daily.get(dayKey(timezone, new Date(row.created_at)))
    if (bucket) {
      bucket.revenue += total
      bucket.profit += total - cost
      bucket.count += 1
    }
    const method = methods.get(row.payment_method) ?? { method: row.payment_method, total: 0, count: 0 }
    method.total += total
    method.count += 1
    methods.set(row.payment_method, method)
  }

  const count = saleRows.length
  return {
    from,
    to,
    timezone,
    totals: {
      revenue: roundMoney(revenue),
      cogs: roundMoney(cogs),
      profit: roundMoney(revenue - cogs),
      margin: revenue ? Math.round(((revenue - cogs) / revenue) * 1000) / 10 : 0,
      count,
      average: count ? roundMoney(revenue / count) : 0,
      discounts: roundMoney(discounts),
      creditGiven: roundMoney(creditGiven),
      purchases: roundMoney(Number(purchases.total)),
      purchaseCount: Number(purchases.count),
      payables: roundMoney(Number(payables.total)),
      expenses,
      netProfit: roundMoney(revenue - cogs - expenses),
    },
    daily: [...daily.values()].map((day) => ({ ...day, revenue: roundMoney(day.revenue), profit: roundMoney(day.profit) })),
    methods: [...methods.values()].map((method) => ({ ...method, total: roundMoney(method.total) })).sort((a, b) => b.total - a.total),
    topProducts: productRows.map((row) => ({ product_id: row.product_id as string, name: row.name as string, quantity: Number(row.quantity), revenue: roundMoney(Number(row.revenue)), profit: roundMoney(Number(row.margin)) })),
    credit: await creditAging(shopId),
  }
}

// What customers owe, by how long it has been owed. Payments settle the oldest credit first.
async function creditAging(shopId: string) {
  const pool = await getPool()
  const [customers] = await pool.query<RowDataPacket[]>('SELECT id, name, phone, balance FROM customers WHERE shop_id = ? AND is_active = 1 AND balance > 0 ORDER BY balance DESC', [shopId])
  const buckets = [{ label: '0–30 days', total: 0 }, { label: '31–60 days', total: 0 }, { label: '60+ days', total: 0 }]
  if (customers.length) {
    const [entries] = await pool.query<RowDataPacket[]>(
      'SELECT customer_id, amount, created_at FROM customer_ledger WHERE shop_id = ? AND amount > 0 AND customer_id IN (?) ORDER BY created_at DESC',
      [shopId, customers.map((customer) => customer.id)],
    )
    const now = Date.now()
    for (const customer of customers) {
      // The newest charges are the ones still unpaid, up to the balance.
      let remaining = Number(customer.balance)
      for (const entry of entries) {
        if (remaining <= 0) break
        if (entry.customer_id !== customer.id) continue
        const part = Math.min(remaining, Number(entry.amount))
        remaining -= part
        const age = (now - new Date(entry.created_at).getTime()) / 86_400_000
        buckets[age <= 30 ? 0 : age <= 60 ? 1 : 2].total += part
      }
      // Balance not explained by ledger rows (should not happen) counts as the oldest.
      if (remaining > 0) buckets[2].total += remaining
    }
  }
  const total = roundMoney(customers.reduce((sum, customer) => sum + Number(customer.balance), 0))
  return {
    total,
    customers: customers.length,
    buckets: buckets.map((bucket) => ({ ...bucket, total: roundMoney(bucket.total), share: total ? Math.round((bucket.total / total) * 100) : 0 })),
    top: customers.slice(0, 5).map((customer) => ({ id: customer.id as string, name: customer.name as string, phone: customer.phone as string | null, balance: Number(customer.balance) })),
  }
}
