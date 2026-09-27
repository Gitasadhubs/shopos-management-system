import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import path from 'node:path'

const dataDir = path.join(process.cwd(), '.data')
mkdirSync(dataDir, { recursive: true })
const db = new Database(path.join(dataDir, 'shopos.sqlite'))
db.pragma('journal_mode = WAL')
db.exec(`CREATE TABLE IF NOT EXISTS products (id TEXT PRIMARY KEY, name TEXT NOT NULL, sku TEXT, barcode TEXT, category TEXT, unit TEXT NOT NULL DEFAULT 'pcs', cost_price REAL NOT NULL DEFAULT 0, sale_price REAL NOT NULL DEFAULT 0, stock_quantity REAL NOT NULL DEFAULT 0, reorder_level REAL NOT NULL DEFAULT 0, is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);`)

export type LocalProduct = { id: string; name: string; sku: string | null; barcode: string | null; category: string | null; unit: string; cost_price: number; sale_price: number; stock_quantity: number; reorder_level: number; is_active: boolean; created_at: string; updated_at: string }

export function listLocalProducts(search = '') {
  const query = `%${search.trim()}%`
  return db.prepare(`SELECT * FROM products WHERE is_active = 1 AND (name LIKE ? OR COALESCE(sku, '') LIKE ? OR COALESCE(barcode, '') LIKE ?) ORDER BY name`).all(query, query, query).map((row: any) => ({ ...row, is_active: Boolean(row.is_active) })) as LocalProduct[]
}

export function insertLocalProduct(input: Omit<LocalProduct, 'id' | 'created_at' | 'updated_at' | 'is_active'>) {
  const id = crypto.randomUUID()
  db.prepare(`INSERT INTO products (id, name, sku, barcode, category, unit, cost_price, sale_price, stock_quantity, reorder_level) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, input.name, input.sku || null, input.barcode || null, input.category || null, input.unit || 'pcs', input.cost_price, input.sale_price, input.stock_quantity, input.reorder_level)
  return listLocalProducts(input.name)[0]
}

export function removeLocalProduct(id: string) {
  db.prepare('UPDATE products SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(id)
}

export function localDbHealth() { return db.prepare('SELECT 1 AS ok').get() }
