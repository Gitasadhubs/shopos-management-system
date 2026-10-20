import { openDB, type DBSchema, type IDBPDatabase } from 'idb'

// The offline till for self-hosted ShopOS. While online, the POS keeps a copy of the shop's products,
// customers and receipt details on the device. When the connection drops, a sale is queued here with
// its client_id and the time it was made, and is sent to /api/sales (offline: true) once the server
// answers again. client_id makes sending twice harmless; the server records the sale even if stock
// ran short meanwhile, because the goods have already left the shop.
// Everything is kept per shop, so a device that signs in to another shop never mixes their sales.

export type TillProduct = { id: string; name: string; sku: string | null; barcode: string | null; category: string | null; sale_price: number; stock_quantity: number; image_url?: string | null }
export type TillCustomer = { id: string; name: string; phone: string | null; balance: number }
export type TillShop = { id: string; name: string; phone: string | null; address: string | null; receipt_footer: string | null; country?: string; currency?: string; language?: string }
export type SaleBody = {
  client_id: string
  items: Array<{ product_id: string; quantity: number }>
  discount: number
  payment_method: 'cash' | 'card' | 'credit'
  customer_id?: string
  amount_paid?: number
}
export type QueuedSale = {
  client_id: string
  shop_id: string
  sold_at: string
  body: SaleBody
  // What the cashier saw, for the waiting list on the till.
  summary: { total: number; items: Array<{ name: string; quantity: number }>; customer_name: string | null }
  status: 'pending' | 'failed'
  error: string | null
  attempts: number
}

type Catalog = { shop_id: string; products: TillProduct[]; customers: TillCustomer[]; shop: TillShop | null; saved_at: number }

interface TillDB extends DBSchema {
  catalog: { key: string; value: Catalog }
  queue: { key: string; value: QueuedSale; indexes: { shop: string } }
}

let dbPromise: Promise<IDBPDatabase<TillDB>> | undefined
function db() {
  dbPromise ??= openDB<TillDB>('shopos-till', 1, {
    upgrade(database) {
      database.createObjectStore('catalog', { keyPath: 'shop_id' })
      database.createObjectStore('queue', { keyPath: 'client_id' }).createIndex('shop', 'shop_id')
    },
  })
  return dbPromise
}

// fetch() rejects (TypeError) when there is no connection at all; an HTTP error is a real answer.
export const isNetworkError = (error: unknown) => error instanceof TypeError || (error instanceof DOMException && (error.name === 'AbortError' || error.name === 'TimeoutError'))
// The request reached Cloudflare or nginx but not a working ShopOS (restarting, overloaded, database
// down): as good as no connection for a sale, which is then kept on the till.
export const serverUnreachable = (response: Response) => [502, 503, 504].includes(response.status) || (response.status >= 520 && response.status <= 530)
// How long a sale may take to reach the server before the till keeps it instead. client_id makes a
// later resend harmless if the first one did arrive.
export const SALE_TIMEOUT_MS = 20_000

// One transaction per save, so saving products, customers and the shop at the same moment cannot
// overwrite each other with a stale copy.
export async function saveCatalog(shopId: string, part: Partial<Omit<Catalog, 'shop_id' | 'saved_at'>>) {
  const tx = (await db()).transaction('catalog', 'readwrite')
  const current = (await tx.store.get(shopId)) ?? { shop_id: shopId, products: [], customers: [], shop: null, saved_at: 0 }
  await tx.store.put({ ...current, ...part, shop_id: shopId, saved_at: Date.now() })
  await tx.done
}

export async function loadCatalog(shopId: string) {
  return (await (await db()).get('catalog', shopId)) ?? null
}

// The most recently used shop on this device: the till opens offline with it.
export async function lastCatalog() {
  const all = await (await db()).getAll('catalog')
  return all.sort((a, b) => b.saved_at - a.saved_at)[0] ?? null
}

export async function queueSale(sale: Omit<QueuedSale, 'status' | 'error' | 'attempts'>) {
  // The sale and the lower stock on the device are stored together, so the till never sells what it no longer has.
  const tx = (await db()).transaction(['queue', 'catalog'], 'readwrite')
  await tx.objectStore('queue').put({ ...sale, status: 'pending', error: null, attempts: 0 })
  const catalog = await tx.objectStore('catalog').get(sale.shop_id)
  if (catalog) {
    const sold = new Map(sale.body.items.map((item) => [item.product_id, item.quantity]))
    await tx.objectStore('catalog').put({ ...catalog, products: catalog.products.map((product) => (sold.has(product.id) ? { ...product, stock_quantity: Math.max(0, product.stock_quantity - sold.get(product.id)!) } : product)) })
  }
  await tx.done
}

export async function listQueue(shopId: string) {
  const rows = await (await db()).getAllFromIndex('queue', 'shop', shopId)
  return rows.sort((a, b) => a.sold_at.localeCompare(b.sold_at))
}

export async function discardQueued(clientId: string) {
  await (await db()).delete('queue', clientId)
}

export type SyncResult = { synced: number; failed: number; offline: boolean }

let running: Promise<SyncResult> | null = null
// Sends waiting sales oldest first. Stops at the first sign the server is still unreachable.
export function syncQueue(shopId: string, post: (body: SaleBody & { offline: true; sold_at: string }) => Promise<Response> = defaultPost): Promise<SyncResult> {
  running ??= (async () => {
    const result: SyncResult = { synced: 0, failed: 0, offline: false }
    const database = await db()
    for (const sale of await listQueue(shopId)) {
      if (sale.status !== 'pending') continue
      let response: Response
      try {
        response = await post({ ...sale.body, offline: true, sold_at: sale.sold_at })
      } catch (error) {
        if (isNetworkError(error)) return { ...result, offline: true }
        throw error
      }
      if (response.ok) {
        await database.delete('queue', sale.client_id)
        result.synced += 1
      } else if (response.status >= 500 || response.status === 401 || response.status === 429) {
        // The server is struggling or the session ended: keep it for the next try.
        await database.put('queue', { ...sale, attempts: sale.attempts + 1 })
        return { ...result, offline: serverUnreachable(response) }
      } else {
        // The server refused this sale for good (product removed, customer gone…): a person decides.
        const message = (await response.json().catch(() => null))?.error ?? `Refused (${response.status}).`
        await database.put('queue', { ...sale, status: 'failed', error: String(message), attempts: sale.attempts + 1 })
        result.failed += 1
      }
    }
    return result
  })().finally(() => { running = null })
  return running
}

const defaultPost = (body: unknown) => fetch('/api/sales', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(SALE_TIMEOUT_MS) })
