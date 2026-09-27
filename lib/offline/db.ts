import { openDB, type DBSchema, type IDBPDatabase } from 'idb'

export interface Product { id: string; shop_id: string; name: string; sku?: string | null; barcode?: string | null; category?: string | null; unit?: string; cost_price: number; sale_price: number; stock_quantity: number; reorder_level?: number; image_url?: string | null; is_active?: boolean }
export interface Customer { id: string; shop_id: string; name: string; phone?: string | null; address?: string | null; credit_balance?: number; notes?: string | null }
export interface Supplier { id: string; shop_id: string; name: string; phone?: string | null; address?: string | null; balance?: number }
export interface ShopSettings { shop_id: string; name: string; address?: string | null; phone?: string | null; logo_url?: string | null; tax_percent?: number; currency?: string; receipt_header?: string | null; receipt_footer?: string | null; language?: 'en' | 'ur' | 'both' }
export interface PendingSaleInput { shop_id: string; items: unknown[]; total: number; payment_method: string; [key: string]: unknown }
export interface PendingSale extends PendingSaleInput { local_id: string; status: 'pending' | 'synced' | 'failed'; attempts: number; created_at: number; error?: string }
export interface PendingStockMove { local_id: string; product_id: string; delta: number; reason: string; status: 'pending' | 'synced' | 'failed'; attempts: number; created_at: number; error?: string }
export interface PendingCreditMove { local_id: string; customer_id: string; amount: number; type: string; note?: string; status: 'pending' | 'synced' | 'failed'; attempts: number; created_at: number; error?: string }
export interface SyncLogEntry { id?: number; type: 'sale' | 'stock' | 'credit' | 'conflict' | 'pull'; status: 'success' | 'failed' | 'conflict'; details: string; entity_id?: string; created_at: number }
export interface MetaRow { key: string; value: unknown }

interface ShopOSDB extends DBSchema {
  products_cache: { key: string; value: Product; indexes: { barcode: string; category: string; name: string } }
  customers_cache: { key: string; value: Customer; indexes: { phone: string } }
  suppliers_cache: { key: string; value: Supplier }
  settings_cache: { key: string; value: ShopSettings }
  pending_sales: { key: string; value: PendingSale; indexes: { status: string; created_at: number } }
  pending_stock_moves: { key: string; value: PendingStockMove; indexes: { status: string } }
  pending_credit_moves: { key: string; value: PendingCreditMove; indexes: { status: string } }
  sync_log: { key: number; value: SyncLogEntry; indexes: { created_at: number } }
  meta: { key: string; value: MetaRow }
}

let dbPromise: Promise<IDBPDatabase<ShopOSDB>> | undefined
export function getDB() {
  if (typeof window === 'undefined') throw new Error('Offline database is browser-only')
  dbPromise ??= openDB<ShopOSDB>('shopos-offline', 1, { upgrade(db) {
    const products = db.createObjectStore('products_cache', { keyPath: 'id' }); products.createIndex('barcode', 'barcode', { unique: true }); products.createIndex('category', 'category'); products.createIndex('name', 'name')
    const customers = db.createObjectStore('customers_cache', { keyPath: 'id' }); customers.createIndex('phone', 'phone')
    db.createObjectStore('suppliers_cache', { keyPath: 'id' }); db.createObjectStore('settings_cache', { keyPath: 'shop_id' })
    const sales = db.createObjectStore('pending_sales', { keyPath: 'local_id' }); sales.createIndex('status', 'status'); sales.createIndex('created_at', 'created_at')
    const stock = db.createObjectStore('pending_stock_moves', { keyPath: 'local_id' }); stock.createIndex('status', 'status')
    const credit = db.createObjectStore('pending_credit_moves', { keyPath: 'local_id' }); credit.createIndex('status', 'status')
    const log = db.createObjectStore('sync_log', { keyPath: 'id', autoIncrement: true }); log.createIndex('created_at', 'created_at')
    db.createObjectStore('meta', { keyPath: 'key' })
  } }).then(async (db) => {
    const existing = await db.get('meta', 'device_id')
    if (!existing) await db.put('meta', { key: 'device_id', value: crypto.randomUUID() })
    return db
  })
  return dbPromise
}

export async function getDeviceId() {
  const db = await getDB(); const existing = await db.get('meta', 'device_id')
  if (existing?.value && typeof existing.value === 'string') return existing.value
  const value = crypto.randomUUID(); await db.put('meta', { key: 'device_id', value }); return value
}

export type { IDBPDatabase }
