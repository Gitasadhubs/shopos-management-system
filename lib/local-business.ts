import { randomUUID } from 'node:crypto'
import type { PoolConnection, RowDataPacket } from 'mysql2/promise'
import { getPool, iso, likePattern, LocalDataError, productFromRow, roundMoney, withTransaction } from '@/lib/local-db'

// Customers (khata), suppliers and purchases for self-hosted shops. Balances are stored on the
// customer/supplier row and every change to one is written to its ledger in the same transaction.

export type Party = { id: string; name: string; phone: string | null; address: string | null; notes: string | null; balance: number; created_at: string; updated_at: string }
export type PartyInput = { name: string; phone?: string; address?: string; notes?: string }
export type LedgerEntry = { id: string; kind: string; amount: number; note: string | null; reference_id: string | null; created_by_name: string | null; created_at: string }

type PartyTable = 'customers' | 'suppliers'
const LEDGER = { customers: { table: 'customer_ledger', key: 'customer_id', ref: 'sale_id' }, suppliers: { table: 'supplier_ledger', key: 'supplier_id', ref: 'purchase_id' } } as const
const LABEL = { customers: 'Customer', suppliers: 'Supplier' } as const

function partyFromRow(row: RowDataPacket): Party {
  return { id: row.id, name: row.name, phone: row.phone, address: row.address, notes: row.notes, balance: Number(row.balance), created_at: iso(row.created_at), updated_at: iso(row.updated_at) }
}

const clean = (value?: string) => value?.trim() || null

async function findParty(db: PoolConnection | Awaited<ReturnType<typeof getPool>>, table: PartyTable, shopId: string, id: string, lock = false) {
  const [rows] = await db.query<RowDataPacket[]>(`SELECT * FROM ${table} WHERE shop_id = ? AND id = ? AND is_active = 1${lock ? ' FOR UPDATE' : ''}`, [shopId, id])
  return rows[0] ? partyFromRow(rows[0]) : null
}

export async function listParties(table: PartyTable, shopId: string, search = '') {
  const query = search.trim()
  const like = likePattern(query)
  const [rows] = await (await getPool()).query<RowDataPacket[]>(
    `SELECT * FROM ${table} WHERE shop_id = ? AND is_active = 1 AND (? = '' OR name LIKE ? OR phone LIKE ?) ORDER BY name`,
    [shopId, query, like, like],
  )
  return rows.map(partyFromRow)
}

export async function createParty(table: PartyTable, shopId: string, input: PartyInput) {
  const pool = await getPool()
  const id = randomUUID()
  const now = new Date()
  await pool.query(
    `INSERT INTO ${table} (id, shop_id, name, phone, address, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, shopId, input.name.trim(), clean(input.phone), clean(input.address), clean(input.notes), now, now],
  )
  return (await findParty(pool, table, shopId, id))!
}

export async function updateParty(table: PartyTable, shopId: string, id: string, input: PartyInput) {
  const pool = await getPool()
  if (!(await findParty(pool, table, shopId, id))) throw new LocalDataError(`${LABEL[table]} not found.`, 404)
  await pool.query(`UPDATE ${table} SET name = ?, phone = ?, address = ?, notes = ?, updated_at = ? WHERE shop_id = ? AND id = ?`, [input.name.trim(), clean(input.phone), clean(input.address), clean(input.notes), new Date(), shopId, id])
  return (await findParty(pool, table, shopId, id))!
}

// Archived rather than deleted, so past sales and purchases keep their names.
export async function archiveParty(table: PartyTable, shopId: string, id: string) {
  return withTransaction(async (connection) => {
    const party = await findParty(connection, table, shopId, id, true)
    if (!party) throw new LocalDataError(`${LABEL[table]} not found.`, 404)
    if (party.balance !== 0) throw new LocalDataError(`Settle the balance of ${party.name} before removing them.`, 409, 'balance_open')
    await connection.query(`UPDATE ${table} SET is_active = 0, updated_at = ? WHERE id = ?`, [new Date(), id])
  })
}

export async function getPartyLedger(table: PartyTable, shopId: string, id: string) {
  const pool = await getPool()
  const party = await findParty(pool, table, shopId, id)
  if (!party) throw new LocalDataError(`${LABEL[table]} not found.`, 404)
  const ledger = LEDGER[table]
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT l.id, l.kind, l.amount, l.note, l.${ledger.ref} AS reference_id, l.created_at, users.full_name AS created_by_name
     FROM ${ledger.table} l LEFT JOIN users ON users.id = l.created_by WHERE l.shop_id = ? AND l.${ledger.key} = ? ORDER BY l.created_at DESC, l.id LIMIT 200`,
    [shopId, id],
  )
  return {
    party,
    entries: rows.map((row): LedgerEntry => ({ id: row.id, kind: row.kind, amount: Number(row.amount), note: row.note, reference_id: row.reference_id, created_by_name: row.created_by_name, created_at: iso(row.created_at) })),
  }
}

// A payment lowers what is owed: the customer pays the shop, or the shop pays the supplier.
export async function recordPartyPayment(table: PartyTable, shopId: string, id: string, input: { amount: number; note?: string }, actorId: string) {
  return withTransaction(async (connection) => {
    const party = await findParty(connection, table, shopId, id, true)
    if (!party) throw new LocalDataError(`${LABEL[table]} not found.`, 404)
    const amount = roundMoney(input.amount)
    if (amount > party.balance) {
      const who = table === 'customers' ? `${party.name} owes` : `You owe ${party.name}`
      throw new LocalDataError(`The payment is more than the balance. ${who} ₨ ${party.balance.toLocaleString('en-PK', { maximumFractionDigits: 2 })}.`, 400, 'overpayment')
    }
    const ledger = LEDGER[table]
    const now = new Date()
    await connection.query(`UPDATE ${table} SET balance = balance - ?, updated_at = ? WHERE id = ?`, [amount, now, id])
    await connection.query(
      `INSERT INTO ${ledger.table} (id, shop_id, ${ledger.key}, kind, amount, note, created_by, created_at) VALUES (?, ?, ?, 'payment', ?, ?, ?, ?)`,
      [randomUUID(), shopId, id, -amount, clean(input.note) ?? 'Payment', actorId, now],
    )
    return (await findParty(connection, table, shopId, id))!
  })
}

// --- purchases -----------------------------------------------------------------------------

export type PurchaseInput = { supplier_id?: string | null; reference?: string; notes?: string; amount_paid?: number; update_cost?: boolean; items: Array<{ product_id: string; quantity: number; unit_cost: number }> }
export type Purchase = { id: string; supplier_id: string | null; supplier_name: string | null; reference: string | null; total: number; amount_paid: number; notes: string | null; created_at: string; items: Array<{ product_id: string; product_name: string; quantity: number; unit_cost: number; subtotal: number }> }

const PURCHASE_SELECT = 'SELECT purchases.*, suppliers.name AS supplier_name FROM purchases LEFT JOIN suppliers ON suppliers.id = purchases.supplier_id'

async function attachPurchaseItems(db: PoolConnection | Awaited<ReturnType<typeof getPool>>, rows: RowDataPacket[]): Promise<Purchase[]> {
  if (!rows.length) return []
  const [items] = await db.query<RowDataPacket[]>('SELECT * FROM purchase_items WHERE purchase_id IN (?) ORDER BY product_name', [rows.map((row) => row.id)])
  return rows.map((row) => ({
    id: row.id,
    supplier_id: row.supplier_id,
    supplier_name: row.supplier_name,
    reference: row.reference,
    total: Number(row.total),
    amount_paid: Number(row.amount_paid),
    notes: row.notes,
    created_at: iso(row.created_at),
    items: items.filter((item) => item.purchase_id === row.id).map((item) => ({ product_id: item.product_id, product_name: item.product_name, quantity: Number(item.quantity), unit_cost: Number(item.unit_cost), subtotal: Number(item.subtotal) })),
  }))
}

export async function listPurchases(shopId: string, limit = 50) {
  const pool = await getPool()
  const [rows] = await pool.query<RowDataPacket[]>(`${PURCHASE_SELECT} WHERE purchases.shop_id = ? ORDER BY purchases.created_at DESC, purchases.id LIMIT ?`, [shopId, limit])
  return attachPurchaseItems(pool, rows)
}

// Receiving stock: adds each line to stock, optionally updates cost prices, and puts any unpaid
// amount on the supplier's balance.
export async function createPurchase(shopId: string, input: PurchaseInput, actorId: string) {
  return withTransaction(async (connection) => {
    const ids = input.items.map((item) => item.product_id)
    if (new Set(ids).size !== ids.length) throw new LocalDataError('Each product can only appear once in a purchase.', 400)
    const [rows] = await connection.query<RowDataPacket[]>('SELECT * FROM products WHERE shop_id = ? AND is_active = 1 AND id IN (?) ORDER BY id FOR UPDATE', [shopId, ids])
    const products = new Map(rows.map((row) => [row.id as string, productFromRow(row)]))
    const lines = input.items.map((item) => {
      const product = products.get(item.product_id)
      if (!product) throw new LocalDataError('A product in this purchase is no longer available.', 404)
      return { product, quantity: item.quantity, unit_cost: roundMoney(item.unit_cost), subtotal: roundMoney(item.quantity * item.unit_cost) }
    })
    const total = roundMoney(lines.reduce((sum, line) => sum + line.subtotal, 0))
    const paid = roundMoney(input.amount_paid ?? total)
    if (paid > total) throw new LocalDataError('The amount paid cannot be more than the purchase total.', 400)
    const owed = roundMoney(total - paid)
    if (owed > 0 && !input.supplier_id) throw new LocalDataError('Choose a supplier to buy on credit.', 400)
    if (input.supplier_id && !(await findParty(connection, 'suppliers', shopId, input.supplier_id, true))) throw new LocalDataError('Supplier not found.', 404)

    const id = randomUUID()
    const now = new Date()
    await connection.query(
      'INSERT INTO purchases (id, shop_id, supplier_id, reference, total, amount_paid, notes, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [id, shopId, input.supplier_id ?? null, clean(input.reference), total, paid, clean(input.notes), actorId, now],
    )
    const label = `Purchase ${clean(input.reference) ?? id.slice(0, 8)}`
    for (const line of lines) {
      await connection.query(
        'INSERT INTO purchase_items (id, purchase_id, product_id, product_name, quantity, unit_cost, subtotal) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [randomUUID(), id, line.product.id, line.product.name, line.quantity, line.unit_cost, line.subtotal],
      )
      await connection.query(
        `UPDATE products SET stock_quantity = stock_quantity + ?${input.update_cost === false ? '' : ', cost_price = ?'}, updated_at = ? WHERE id = ?`,
        input.update_cost === false ? [line.quantity, now, line.product.id] : [line.quantity, line.unit_cost, now, line.product.id],
      )
      await connection.query('INSERT INTO stock_moves (id, shop_id, product_id, delta, reason, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [randomUUID(), shopId, line.product.id, line.quantity, label.slice(0, 200), actorId, now])
    }
    if (owed > 0) {
      await connection.query('UPDATE suppliers SET balance = balance + ?, updated_at = ? WHERE id = ?', [owed, now, input.supplier_id])
      await connection.query(
        "INSERT INTO supplier_ledger (id, shop_id, supplier_id, kind, amount, purchase_id, note, created_by, created_at) VALUES (?, ?, ?, 'purchase', ?, ?, ?, ?, ?)",
        [randomUUID(), shopId, input.supplier_id, owed, id, label.slice(0, 300), actorId, now],
      )
    }
    const [created] = await connection.query<RowDataPacket[]>(`${PURCHASE_SELECT} WHERE purchases.id = ?`, [id])
    return (await attachPurchaseItems(connection, created))[0]
  })
}
