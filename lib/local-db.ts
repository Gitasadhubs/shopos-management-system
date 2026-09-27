import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import path from 'node:path'

type SqliteDatabase = InstanceType<typeof Database>
type ProductRow = Omit<LocalProduct, 'is_active'> & { is_active: number }

export type LocalProduct = {
  id: string
  name: string
  sku: string | null
  barcode: string | null
  category: string | null
  unit: string
  cost_price: number
  sale_price: number
  stock_quantity: number
  reorder_level: number
  image_url: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export type LocalProductInput = Omit<LocalProduct, 'id' | 'created_at' | 'updated_at' | 'image_url' | 'is_active'> & { image_url?: string | null }
export type LocalSaleItem = { product_id: string; product_name: string; quantity: number; unit_price: number; cost_price: number; subtotal: number }
export type LocalSale = { id: string; client_id: string | null; total: number; discount: number; payment_method: string; amount_paid: number; change_given: number; created_at: string; items: LocalSaleItem[] }
export type LocalSaleInput = { items: Array<{ product_id: string; quantity: number }>; discount?: number; payment_method: 'cash' | 'card'; amount_paid?: number; client_id?: string }

export class LocalDataError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'LocalDataError'
  }
}

let database: SqliteDatabase | undefined

function ensureColumn(db: SqliteDatabase, table: string, column: string, definition: string) {
  const columns = db.pragma(`table_info(${table})`) as Array<{ name: string }>
  if (!columns.some((item) => item.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
}

function migrate(db: SqliteDatabase) {
  const migrations: Array<() => void> = [
    () => {
      db.exec(`CREATE TABLE IF NOT EXISTS products (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        sku TEXT,
        barcode TEXT,
        category TEXT,
        unit TEXT NOT NULL DEFAULT 'pcs',
        cost_price REAL NOT NULL DEFAULT 0,
        sale_price REAL NOT NULL DEFAULT 0,
        stock_quantity REAL NOT NULL DEFAULT 0,
        reorder_level REAL NOT NULL DEFAULT 0,
        image_url TEXT,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`)
      ensureColumn(db, 'products', 'sku', 'TEXT')
      ensureColumn(db, 'products', 'barcode', 'TEXT')
      ensureColumn(db, 'products', 'category', 'TEXT')
      ensureColumn(db, 'products', 'unit', "TEXT NOT NULL DEFAULT 'pcs'")
      ensureColumn(db, 'products', 'cost_price', 'REAL NOT NULL DEFAULT 0')
      ensureColumn(db, 'products', 'sale_price', 'REAL NOT NULL DEFAULT 0')
      ensureColumn(db, 'products', 'stock_quantity', 'REAL NOT NULL DEFAULT 0')
      ensureColumn(db, 'products', 'reorder_level', 'REAL NOT NULL DEFAULT 0')
      ensureColumn(db, 'products', 'image_url', 'TEXT')
      ensureColumn(db, 'products', 'is_active', 'INTEGER NOT NULL DEFAULT 1')
      ensureColumn(db, 'products', 'created_at', "TEXT NOT NULL DEFAULT ''")
      ensureColumn(db, 'products', 'updated_at', "TEXT NOT NULL DEFAULT ''")
      db.exec("UPDATE products SET created_at = CURRENT_TIMESTAMP WHERE created_at = '' OR created_at IS NULL; UPDATE products SET updated_at = CURRENT_TIMESTAMP WHERE updated_at = '' OR updated_at IS NULL;")
    },
    () => {
      db.exec(`CREATE TABLE IF NOT EXISTS sales (
        id TEXT PRIMARY KEY,
        client_id TEXT UNIQUE,
        total REAL NOT NULL,
        discount REAL NOT NULL DEFAULT 0,
        payment_method TEXT NOT NULL DEFAULT 'cash',
        amount_paid REAL NOT NULL DEFAULT 0,
        change_given REAL NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS sale_items (
        id TEXT PRIMARY KEY,
        sale_id TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
        product_id TEXT NOT NULL REFERENCES products(id),
        product_name TEXT NOT NULL,
        quantity REAL NOT NULL CHECK (quantity > 0),
        unit_price REAL NOT NULL,
        cost_price REAL NOT NULL,
        subtotal REAL NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sales_created_at_idx ON sales(created_at);
      CREATE INDEX IF NOT EXISTS sale_items_sale_id_idx ON sale_items(sale_id);
      `)
    },
    () => {
      db.exec(`CREATE TABLE IF NOT EXISTS stock_moves (
        id TEXT PRIMARY KEY,
        product_id TEXT NOT NULL REFERENCES products(id),
        delta REAL NOT NULL CHECK (delta != 0),
        reason TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS stock_moves_product_id_idx ON stock_moves(product_id);
      CREATE INDEX IF NOT EXISTS stock_moves_created_at_idx ON stock_moves(created_at);
      `)
    },
  ]

  let version = Number(db.pragma('user_version', { simple: true }) ?? 0)
  while (version < migrations.length) {
    const nextVersion = version + 1
    db.transaction(() => {
      migrations[version]()
      db.pragma(`user_version = ${nextVersion}`)
    }).immediate()
    version = nextVersion
  }
}

function getDatabase() {
  if (database) return database
  const dataDir = process.env.SHOPOS_DATA_DIR ?? path.join(process.cwd(), '.data')
  mkdirSync(dataDir, { recursive: true })
  database = new Database(path.join(dataDir, 'shopos.sqlite'))
  database.pragma('journal_mode = WAL')
  database.pragma('foreign_keys = ON')
  migrate(database)
  return database
}

function productFromRow(row: ProductRow): LocalProduct {
  return {
    ...row,
    cost_price: Number(row.cost_price),
    sale_price: Number(row.sale_price),
    stock_quantity: Number(row.stock_quantity),
    reorder_level: Number(row.reorder_level),
    is_active: Boolean(row.is_active),
  }
}

function getProductRow(id: string) {
  return getDatabase().prepare('SELECT * FROM products WHERE id = ? AND is_active = 1').get(id) as ProductRow | undefined
}

export function listLocalProducts(search = '') {
  const query = search.trim()
  const rows = getDatabase().prepare(`SELECT * FROM products WHERE is_active = 1 AND (
    ? = '' OR instr(lower(name), lower(?)) > 0 OR instr(lower(COALESCE(sku, '')), lower(?)) > 0 OR instr(lower(COALESCE(barcode, '')), lower(?)) > 0
  ) ORDER BY name`).all(query, query, query, query) as ProductRow[]
  return rows.map(productFromRow)
}

export function insertLocalProduct(input: LocalProductInput) {
  const id = randomUUID()
  getDatabase().prepare(`INSERT INTO products (id, name, sku, barcode, category, unit, cost_price, sale_price, stock_quantity, reorder_level, image_url)
    VALUES (@id, @name, @sku, @barcode, @category, @unit, @cost_price, @sale_price, @stock_quantity, @reorder_level, @image_url)`)
    .run({ id, ...input, sku: input.sku || null, barcode: input.barcode || null, category: input.category || null, unit: input.unit || 'pcs', image_url: input.image_url || null })
  const row = getProductRow(id)
  return row ? productFromRow(row) : null
}

export function updateLocalProduct(id: string, input: LocalProductInput) {
  const result = getDatabase().prepare(`UPDATE products SET name = @name, sku = @sku, barcode = @barcode, category = @category,
    unit = @unit, cost_price = @cost_price, sale_price = @sale_price, stock_quantity = @stock_quantity,
    reorder_level = @reorder_level, image_url = @image_url, updated_at = @updated_at
    WHERE id = @id AND is_active = 1`).run({ id, ...input, sku: input.sku || null, barcode: input.barcode || null, category: input.category || null, unit: input.unit || 'pcs', image_url: input.image_url || null, updated_at: new Date().toISOString() })
  if (!result.changes) return null
  const row = getProductRow(id)
  return row ? productFromRow(row) : null
}

export function removeLocalProduct(id: string) {
  return getDatabase().prepare('UPDATE products SET is_active = 0, updated_at = ? WHERE id = ? AND is_active = 1').run(new Date().toISOString(), id).changes > 0
}

export function adjustLocalStock(productId: string, delta: number, reason: string) {
  const db = getDatabase()
  return db.transaction(() => {
    const product = getProductRow(productId)
    if (!product) throw new LocalDataError('Product not found.', 404)
    const stock = Number(product.stock_quantity) + delta
    if (stock < 0) throw new LocalDataError('Stock cannot be reduced below zero.', 409)
    db.prepare('UPDATE products SET stock_quantity = ?, updated_at = ? WHERE id = ?').run(stock, new Date().toISOString(), productId)
    db.prepare('INSERT INTO stock_moves (id, product_id, delta, reason, created_at) VALUES (?, ?, ?, ?, ?)').run(randomUUID(), productId, delta, reason.trim(), new Date().toISOString())
    return productFromRow(getProductRow(productId)!)
  }).immediate()
}

function getSale(db: SqliteDatabase, saleId: string): LocalSale | null {
  const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(saleId) as Omit<LocalSale, 'items'> | undefined
  if (!sale) return null
  const items = db.prepare('SELECT product_id, product_name, quantity, unit_price, cost_price, subtotal FROM sale_items WHERE sale_id = ?').all(saleId) as LocalSaleItem[]
  return { ...sale, items }
}

export function createLocalSale(input: LocalSaleInput) {
  const db = getDatabase()
  return db.transaction(() => {
    if (input.client_id) {
      const existing = db.prepare('SELECT id FROM sales WHERE client_id = ?').get(input.client_id) as { id: string } | undefined
      if (existing) return getSale(db, existing.id)!
    }

    const products = input.items.map(({ product_id, quantity }) => {
      const product = getProductRow(product_id)
      if (!product) throw new LocalDataError('A product in this sale is no longer available.', 404)
      if (quantity > Number(product.stock_quantity)) throw new LocalDataError(`Not enough stock for ${product.name}.`, 409)
      return { product, quantity }
    })
    const subtotal = products.reduce((sum, item) => sum + Number(item.product.sale_price) * item.quantity, 0)
    const discount = input.discount ?? 0
    if (discount > subtotal) throw new LocalDataError('Discount cannot exceed the sale subtotal.', 400)
    const total = subtotal - discount
    const amountPaid = input.amount_paid ?? total
    if (amountPaid < total) throw new LocalDataError('Amount paid must cover the sale total.', 400)
    const id = randomUUID()
    const createdAt = new Date().toISOString()
    db.prepare(`INSERT INTO sales (id, client_id, total, discount, payment_method, amount_paid, change_given, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(id, input.client_id ?? null, total, discount, input.payment_method, amountPaid, amountPaid - total, createdAt)
    const insertItem = db.prepare(`INSERT INTO sale_items (id, sale_id, product_id, product_name, quantity, unit_price, cost_price, subtotal)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    const updateStock = db.prepare('UPDATE products SET stock_quantity = stock_quantity - ?, updated_at = ? WHERE id = ?')
    for (const { product, quantity } of products) {
      insertItem.run(randomUUID(), id, product.id, product.name, quantity, product.sale_price, product.cost_price, Number(product.sale_price) * quantity)
      updateStock.run(quantity, createdAt, product.id)
    }
    return getSale(db, id)!
  }).immediate()
}

export function listLocalSales(limit = 20) {
  const db = getDatabase()
  const rows = db.prepare('SELECT id, client_id, total, discount, payment_method, amount_paid, change_given, created_at FROM sales ORDER BY created_at DESC LIMIT ?').all(limit) as Array<Omit<LocalSale, 'items'>>
  return rows.map((sale) => ({ ...sale, items: (db.prepare('SELECT product_id, product_name, quantity, unit_price, cost_price, subtotal FROM sale_items WHERE sale_id = ?').all(sale.id) as LocalSaleItem[]) }))
}

export function getLocalDashboardStats(startAt: string) {
  const db = getDatabase()
  const sales = Number((db.prepare('SELECT COALESCE(SUM(total), 0) AS total FROM sales WHERE datetime(created_at) >= datetime(?)').get(startAt) as { total: number }).total)
  const profit = Number((db.prepare(`SELECT COALESCE(SUM((sale_items.unit_price - sale_items.cost_price) * sale_items.quantity), 0)
    - COALESCE((SELECT SUM(discount) FROM sales WHERE datetime(created_at) >= datetime(?)), 0) AS total
    FROM sale_items JOIN sales ON sales.id = sale_items.sale_id WHERE datetime(sales.created_at) >= datetime(?)`).get(startAt, startAt) as { total: number }).total)
  const lowProducts = listLocalProducts().filter((product) => product.stock_quantity <= product.reorder_level)
  const recentRows = db.prepare(`SELECT id, client_id, total, discount, payment_method, amount_paid, change_given, created_at FROM sales
    WHERE datetime(created_at) >= datetime(?) ORDER BY created_at DESC LIMIT 10`).all(startAt) as Array<Omit<LocalSale, 'items'>>
  return {
    sales,
    profit,
    lowStock: lowProducts.length,
    salesCount: Number((db.prepare('SELECT COUNT(*) AS count FROM sales WHERE datetime(created_at) >= datetime(?)').get(startAt) as { count: number }).count),
    lowProducts,
    recent: recentRows.map((sale) => ({ ...sale, items: (db.prepare('SELECT product_id, product_name, quantity, unit_price, cost_price, subtotal FROM sale_items WHERE sale_id = ?').all(sale.id) as LocalSaleItem[]) })),
  }
}

export function localDbHealth() {
  return getDatabase().prepare('SELECT 1 AS ok').get()
}
