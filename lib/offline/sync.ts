import { cacheCustomers, cacheProducts, cacheSettings, cacheSuppliers, getPendingCreditMoves, getPendingSales, getPendingStockMoves, getMeta, incrementAttempts, logSync, markFailed, markSynced, setMeta } from './repo'

const MAX_ATTEMPTS = 5
let syncPromise: Promise<{ synced: number; failed: number; conflicts: number }> | null = null
const online = () => typeof navigator !== 'undefined' && navigator.onLine
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function send(store: 'pending_sales' | 'pending_stock_moves' | 'pending_credit_moves', item: { local_id: string; attempts: number }, path: string, type: 'sale' | 'stock' | 'credit', body: unknown) {
  for (let attempt = item.attempts; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      if (response.ok) { await markSynced(store, item.local_id); await logSync({ type, status: 'success', details: 'Synced', entity_id: item.local_id }); return { synced: 1, failed: 0 } }
      const message = (await response.json().catch(() => null))?.error ?? 'Validation error'
      if (response.status < 500) { await markFailed(store, item.local_id, message); await logSync({ type, status: 'failed', details: message, entity_id: item.local_id }); return { synced: 0, failed: 1 } }
    } catch { /* retry below */ }
    await incrementAttempts(store, item.local_id)
    if (attempt + 1 >= MAX_ATTEMPTS) { await markFailed(store, item.local_id, 'Maximum retry attempts exceeded'); await logSync({ type, status: 'failed', details: 'Maximum retry attempts exceeded', entity_id: item.local_id }); return { synced: 0, failed: 1 } }
    await wait(Math.min(1000 * 2 ** attempt, 30000))
  }
  return { synced: 0, failed: 1 }
}

export async function syncSales() { if (!online()) return { synced: 0, failed: 0 }; let synced = 0; let failed = 0; for (const sale of (await getPendingSales()).sort((a, b) => a.created_at - b.created_at)) { const result = await send('pending_sales', sale, '/api/sales', 'sale', { ...sale, client_id: sale.local_id }); synced += result.synced; failed += result.failed } return { synced, failed } }
export async function syncStockMoves() { if (!online()) return { synced: 0, failed: 0 }; let synced = 0; let failed = 0; for (const move of (await getPendingStockMoves()).sort((a, b) => a.created_at - b.created_at)) { const result = await send('pending_stock_moves', move, '/api/stock-moves', 'stock', { ...move, client_id: move.local_id }); synced += result.synced; failed += result.failed } return { synced, failed } }
export async function syncCreditMoves() { if (!online()) return { synced: 0, failed: 0 }; let synced = 0; let failed = 0; for (const move of (await getPendingCreditMoves()).sort((a, b) => a.created_at - b.created_at)) { const result = await send('pending_credit_moves', move, '/api/credit-moves', 'credit', { ...move, client_id: move.local_id }); synced += result.synced; failed += result.failed } return { synced, failed } }

export async function syncAll() { if (syncPromise) return syncPromise; syncPromise = (async () => { const sales = await syncSales(); const stock = await syncStockMoves(); const credit = await syncCreditMoves(); const result = { synced: sales.synced + stock.synced + credit.synced, failed: sales.failed + stock.failed + credit.failed, conflicts: 0 }; if (result.failed === 0) await setMeta('last_sync_at', Date.now()); return result })().finally(() => { syncPromise = null }) as Promise<{ synced: number; failed: number; conflicts: number }>; return syncPromise }

export async function pullLatest() { if (!online()) return; try { const [products, customers, suppliers, settings] = await Promise.all(['/api/products', '/api/customers', '/api/suppliers', '/api/settings'].map((url) => fetch(url).then((r) => r.ok ? r.json() : Promise.reject(new Error('Pull failed'))))); await cacheProducts(products.data ?? products); await cacheCustomers(customers.data ?? customers); await cacheSuppliers(suppliers.data ?? suppliers); const setting = settings.data ?? settings; if (setting) await cacheSettings(Array.isArray(setting) ? setting[0] : setting); await logSync({ type: 'pull', status: 'success', details: 'Latest data cached' }) } catch (error) { await logSync({ type: 'pull', status: 'failed', details: error instanceof Error ? error.message : 'Pull failed' }) } }
export async function getLastSyncAt() { return getMeta<number>('last_sync_at') }
export async function getPendingCount() { return (await Promise.all([getPendingSales(), getPendingStockMoves(), getPendingCreditMoves()])).flat().length }
