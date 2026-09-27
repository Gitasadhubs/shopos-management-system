'use client'

import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { getCachedProducts, queueSale } from '@/lib/offline/repo'
import { decrementCachedStock } from '@/lib/offline/repo'
import { useOnlineStatus } from '@/hooks/use-online-status'
import type { Product } from '@/lib/offline/db'

export default function POSPage() {
  const { isOnline } = useOnlineStatus()
  const [products, setProducts] = useState<Product[]>([])
  const [cart, setCart] = useState<Product[]>([])
  const [savedOffline, setSavedOffline] = useState(false)
  useEffect(() => { let active = true; void getCachedProducts().then((rows) => { if (active) setProducts(rows) }); return () => { active = false } }, [])
  const total = cart.reduce((sum, product) => sum + Number(product.sale_price), 0)
  async function checkout() {
    if (!cart.length) return
    const sale = { shop_id: cart[0].shop_id, customer_id: null, items: cart.map((product) => ({ product_id: product.id, product_name: product.name, quantity: 1, unit_price: product.sale_price, cost_price: product.cost_price, subtotal: product.sale_price })), total, discount: 0, payment_method: 'cash' as const, amount_paid: total, change_given: 0 }
    let queued = !isOnline
    if (!queued) { const controller = new AbortController(); const timeout = window.setTimeout(() => controller.abort(), 3000); try { const response = await fetch('/api/sales', { method: 'POST', signal: controller.signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify(sale) }); queued = !response.ok } catch { queued = true } finally { window.clearTimeout(timeout) } }
    if (queued) { await queueSale(sale); await Promise.all(cart.map((product) => decrementCachedStock(product.id, 1))); setSavedOffline(true); window.setTimeout(() => setSavedOffline(false), 3000) }
    setCart([])
  }
  return <main className="min-h-screen bg-stone-50 p-4 sm:p-8"><div className="mx-auto max-w-6xl"><div className="flex items-center justify-between"><div><h1 className="text-3xl font-bold text-stone-900">Point of Sale</h1><p className="mt-1 text-sm text-slate-500">Products load from your offline cache.</p></div><Badge className={isOnline ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}>{isOnline ? 'Online' : 'Offline'}</Badge></div>{savedOffline && <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-medium text-amber-800">Sale saved offline — will sync automatically</div>}<div className="mt-6 grid gap-6 lg:grid-cols-[1fr_320px]"><section className="grid grid-cols-2 gap-3 md:grid-cols-3">{products.map((product) => <button key={product.id} type="button" onClick={() => setCart((items) => [...items, product])} className="rounded-2xl border bg-white p-4 text-left shadow-sm hover:border-emerald-400"><p className="font-semibold">{product.name}</p><p className="mt-2 text-sm text-slate-500">₨ {Number(product.sale_price).toLocaleString('en-PK')}</p><p className="text-xs text-slate-400">Stock {product.stock_quantity}</p></button>)}{!products.length && <p className="col-span-full rounded-2xl border border-dashed bg-white p-8 text-center text-sm text-slate-500">No cached products yet. Connect once to preload inventory.</p>}</section><aside className="rounded-2xl border bg-white p-5 shadow-sm"><h2 className="font-semibold">Current sale</h2><div className="mt-4 space-y-2">{cart.map((product, index) => <div key={`${product.id}-${index}`} className="flex justify-between text-sm"><span>{product.name}</span><span>₨ {Number(product.sale_price).toLocaleString('en-PK')}</span></div>)}</div><div className="mt-5 flex justify-between border-t pt-4 font-bold"><span>Total</span><span>₨ {total.toLocaleString('en-PK')}</span></div><Button className="mt-4 w-full bg-emerald-600 hover:bg-emerald-700" disabled={!cart.length} onClick={() => void checkout()}>Complete sale</Button>{savedOffline && <p className="mt-3 text-center text-xs font-semibold text-amber-700">PENDING SYNC</p>}</aside></div></div></main>
}
