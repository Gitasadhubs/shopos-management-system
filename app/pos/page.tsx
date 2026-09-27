'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, LoaderCircle, Minus, Plus, Search } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

type Product = {
  id: string
  name: string
  sku: string | null
  barcode: string | null
  category: string | null
  sale_price: number
  stock_quantity: number
}

type CartItem = { product: Product; quantity: number }
type Sale = {
  id: string
  total: number
  payment_method: string
  created_at: string
  items: Array<{ product_name: string; quantity: number; subtotal: number }>
}

const money = (value: number) => `₨ ${value.toLocaleString('en-PK', { maximumFractionDigits: 2 })}`

export default function POSPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [sales, setSales] = useState<Sale[]>([])
  const [cart, setCart] = useState<CartItem[]>([])
  const [search, setSearch] = useState('')
  const [discount, setDiscount] = useState('0')
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card'>('cash')
  const [loadingProducts, setLoadingProducts] = useState(true)
  const [loadingSales, setLoadingSales] = useState(true)
  const [checkoutLoading, setCheckoutLoading] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const checkoutId = useRef<string | null>(null)

  useEffect(() => {
    let active = true
    setLoadingProducts(true)
    fetch(`/api/products?search=${encodeURIComponent(search)}`, { cache: 'no-store' })
      .then(async (response) => {
        const body = await response.json()
        if (!response.ok) throw new Error(body.error ?? 'Could not load products.')
        if (active) setProducts(body.data ?? [])
      })
      .catch((loadError) => { if (active) setError(loadError instanceof Error ? loadError.message : 'Could not load products.') })
      .finally(() => { if (active) setLoadingProducts(false) })
    return () => { active = false }
  }, [search, refreshKey])

  useEffect(() => {
    let active = true
    setLoadingSales(true)
    fetch('/api/sales', { cache: 'no-store' })
      .then(async (response) => {
        const body = await response.json()
        if (!response.ok) throw new Error(body.error ?? 'Could not load sales history.')
        if (active) setSales(body.data ?? [])
      })
      .catch((loadError) => { if (active) setError(loadError instanceof Error ? loadError.message : 'Could not load sales history.') })
      .finally(() => { if (active) setLoadingSales(false) })
    return () => { active = false }
  }, [refreshKey])

  const subtotal = cart.reduce((sum, item) => sum + Number(item.product.sale_price) * item.quantity, 0)
  const discountValue = Number(discount) || 0
  const total = Math.max(0, subtotal - discountValue)

  function changeQuantity(product: Product, change: number) {
    setCart((items) => {
      const existing = items.find((item) => item.product.id === product.id)
      const nextQuantity = (existing?.quantity ?? 0) + change
      if (nextQuantity <= 0) return items.filter((item) => item.product.id !== product.id)
      if (nextQuantity > product.stock_quantity) return items
      return existing
        ? items.map((item) => item.product.id === product.id ? { ...item, quantity: nextQuantity } : item)
        : [...items, { product, quantity: nextQuantity }]
    })
    setError('')
  }

  async function checkout() {
    if (!cart.length || checkoutLoading) return
    if (discountValue > subtotal) {
      setError('Discount cannot exceed the subtotal.')
      return
    }
    setCheckoutLoading(true)
    setError('')
    checkoutId.current ??= crypto.randomUUID()
    try {
      const response = await fetch('/api/sales', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          client_id: checkoutId.current,
          items: cart.map(({ product, quantity }) => ({ product_id: product.id, quantity })),
          discount: discountValue,
          payment_method: paymentMethod,
        }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error ?? 'Sale could not be completed.')
      setSuccess(`Sale completed · ${money(Number(body.data.total))}`)
      checkoutId.current = null
      setCart([])
      setDiscount('0')
      setRefreshKey((value) => value + 1)
    } catch (checkoutError) {
      setError(checkoutError instanceof Error ? checkoutError.message : 'Sale could not be completed.')
    } finally {
      setCheckoutLoading(false)
    }
  }

  return (
    <main className="min-h-screen bg-stone-50 p-4 sm:p-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div><Link href="/dashboard" className="mb-3 inline-flex items-center gap-2 text-sm font-medium text-emerald-700"><ArrowLeft className="size-4" />Dashboard</Link><h1 className="text-3xl font-bold text-stone-900">Point of Sale</h1><p className="mt-1 text-sm text-muted-foreground">Products and sales are saved by the server.</p></div>
          <Badge variant="outline" className="bg-white">{products.length} products</Badge>
        </div>

        {error && <p role="alert" className="mb-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
        {success && <p role="status" className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{success}</p>}

        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <section>
            <div className="relative mb-4"><Search className="absolute left-3 top-3 size-4 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search products, SKU, or barcode" className="bg-white pl-9" /></div>
            {loadingProducts ? <div className="flex items-center justify-center gap-2 rounded-xl border bg-white p-12 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />Loading products…</div> : products.length ? <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
              {products.map((product) => {
                const quantity = cart.find((item) => item.product.id === product.id)?.quantity ?? 0
                return <button key={product.id} type="button" disabled={product.stock_quantity <= 0} onClick={() => changeQuantity(product, 1)} className="rounded-xl border bg-white p-4 text-left transition hover:border-emerald-400 disabled:cursor-not-allowed disabled:opacity-50">
                  <div className="flex min-h-12 items-start justify-between gap-2"><span className="font-semibold text-stone-900">{product.name}</span>{quantity > 0 && <Badge>{quantity}</Badge>}</div>
                  <p className="mt-3 text-sm font-bold text-emerald-700">{money(Number(product.sale_price))}</p><p className="mt-1 text-xs text-muted-foreground">Stock {product.stock_quantity}</p>
                </button>
              })}
            </div> : <p className="rounded-xl border border-dashed bg-white p-10 text-center text-sm text-muted-foreground">No products found. Add products in Inventory.</p>}
          </section>

          <Card>
            <CardHeader><CardTitle className="text-base">Current sale</CardTitle></CardHeader>
            <CardContent>
              {cart.length ? <div className="max-h-[360px] space-y-3 overflow-y-auto">{cart.map(({ product, quantity }) => <div key={product.id} className="flex items-center gap-2 border-b pb-3">
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{product.name}</p><p className="text-xs text-muted-foreground">{money(Number(product.sale_price))} each</p></div>
                <div className="flex items-center gap-1"><Button variant="outline" size="icon" aria-label={`Remove one ${product.name}`} onClick={() => changeQuantity(product, -1)}><Minus className="size-3" /></Button><span className="w-6 text-center text-sm tabular-nums">{quantity}</span><Button variant="outline" size="icon" aria-label={`Add one ${product.name}`} disabled={quantity >= product.stock_quantity} onClick={() => changeQuantity(product, 1)}><Plus className="size-3" /></Button></div>
                <span className="w-20 text-right text-sm font-semibold">{money(Number(product.sale_price) * quantity)}</span>
              </div>)}</div> : <p className="border-b py-8 text-center text-sm text-muted-foreground">Select products to begin.</p>}

              <div className="mt-4 grid gap-3">
                <div className="flex justify-between text-sm"><span className="text-muted-foreground">Subtotal</span><span>{money(subtotal)}</span></div>
                <div className="flex items-center justify-between gap-3"><label htmlFor="sale-discount" className="text-sm text-muted-foreground">Discount</label><Input id="sale-discount" type="number" min="0" max={subtotal} step="0.01" value={discount} onChange={(event) => setDiscount(event.target.value)} className="w-32 text-right" /></div>
                <div className="flex justify-between border-t pt-3 text-lg font-bold"><span>Total</span><span className="text-emerald-700">{money(total)}</span></div>
                <Select value={paymentMethod} onValueChange={(value) => { if (value === 'cash' || value === 'card') setPaymentMethod(value) }}>
                  <SelectTrigger aria-label="Payment method"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="cash">Cash</SelectItem><SelectItem value="card">Card</SelectItem></SelectContent>
                </Select>
                <Button disabled={!cart.length || checkoutLoading} onClick={() => void checkout()} className="w-full bg-emerald-600 hover:bg-emerald-700">{checkoutLoading ? <><LoaderCircle className="mr-2 size-4 animate-spin" />Completing…</> : `Complete sale · ${money(total)}`}</Button>
                <Button variant="outline" disabled={!cart.length || checkoutLoading} onClick={() => { setCart([]); setDiscount('0'); checkoutId.current = null }}>Clear sale</Button>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="mt-8">
          <CardHeader><CardTitle className="text-base">Recent sales</CardTitle></CardHeader>
          <CardContent>{loadingSales ? <div className="flex items-center justify-center gap-2 p-6 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />Loading sales…</div> : sales.length ? <div className="divide-y">
            {sales.map((sale) => <div key={sale.id} className="flex flex-col justify-between gap-2 py-3 sm:flex-row sm:items-center"><div><p className="text-sm font-semibold">Receipt {sale.id.slice(0, 8)}</p><p className="text-xs text-muted-foreground">{new Date(sale.created_at).toLocaleString()} · {sale.items.map((item) => `${item.product_name} × ${item.quantity}`).join(', ')}</p></div><div className="flex items-center gap-3"><Badge variant="secondary" className="capitalize">{sale.payment_method}</Badge><span className="text-sm font-bold">{money(Number(sale.total))}</span></div></div>)}
          </div> : <p className="p-6 text-center text-sm text-muted-foreground">No completed sales yet.</p>}</CardContent>
        </Card>
      </div>
    </main>
  )
}