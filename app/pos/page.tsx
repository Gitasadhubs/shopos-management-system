'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowUpRight, CloudOff, LoaderCircle, Minus, Plus, RefreshCw, ScanBarcode, Search, Volume2, VolumeX } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { EmptyCartIllustration, EmptyBoxIllustration } from '@/components/illustrations'
import { colorFor } from '@/components/page-kit'
import { Confetti } from '@/components/confetti'
import { Receipt, receiptLabel, ReturnBadge, type ReceiptSale, type ShopProfile } from '@/components/receipt'
import { playSound, setSoundEnabled, useSoundEnabled } from '@/lib/sounds'
import { randomId } from '@/lib/utils'
import { formatDateTime, formatFor, formatMoney, setShopFormat } from '@/lib/format'
import { applyLanguage, t } from '@/lib/i18n'
import { discardQueued, isNetworkError, lastCatalog, listQueue, loadCatalog, queueSale, saveCatalog, syncQueue, type QueuedSale } from '@/lib/offline/till'

type Product = {
  id: string
  name: string
  sku: string | null
  barcode: string | null
  category: string | null
  sale_price: number
  stock_quantity: number
  image_url?: string | null
}

type CartItem = { product: Product; quantity: number }
type Sale = ReceiptSale
type Customer = { id: string; name: string; phone: string | null; balance: number }
type Method = 'cash' | 'card' | 'credit'
type TillProfile = ShopProfile & { country?: string; currency?: string; language?: string }

// The till does not use the auth provider (it must open offline), so it applies the shop's currency
// and language itself, from Settings or the copy saved on the device.
function applyShop(shop: TillProfile | null) {
  if (!shop?.currency) return
  setShopFormat(formatFor(shop))
  applyLanguage(shop.language)
}

const money = (value: number) => formatMoney(value)
const round = (value: number) => Math.round(value * 100) / 100

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase()
}

export default function POSPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [sales, setSales] = useState<Sale[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [shop, setShop] = useState<TillProfile | null>(null)
  const [cart, setCart] = useState<CartItem[]>([])
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [discount, setDiscount] = useState('0')
  const [paymentMethod, setPaymentMethod] = useState<Method>('cash')
  const [customerId, setCustomerId] = useState('')
  const [received, setReceived] = useState('')
  const [loadingProducts, setLoadingProducts] = useState(true)
  const [loadingSales, setLoadingSales] = useState(true)
  const [checkoutLoading, setCheckoutLoading] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [lastSale, setLastSale] = useState<Sale | null>(null)
  const [bumped, setBumped] = useState<string | null>(null)
  const checkoutId = useRef<string | null>(null)
  const searchInput = useRef<HTMLInputElement | null>(null)
  const checkoutRef = useRef<() => void>(() => undefined)
  const [burst, setBurst] = useState(0)
  const sound = useSoundEnabled()
  // Offline till (lib/offline/till.ts): the shop this device sells for, whether the server is reachable,
  // and the sales waiting on this device to be sent.
  const [shopId, setShopId] = useState<string | null>(null)
  const [offline, setOffline] = useState(false)
  const [queue, setQueue] = useState<QueuedSale[]>([])
  const [syncing, setSyncing] = useState(false)
  // Which lists on screen came straight from the server; only those may replace the device copy.
  const fresh = useRef({ products: false, customers: false, shop: false })

  // No connection: fill the till from the copy on this device, filtered the way the server would.
  async function fillFromDevice() {
    fresh.current = { products: false, customers: false, shop: false }
    setOffline(true)
    const catalog = shopId ? await loadCatalog(shopId) : await lastCatalog()
    if (!catalog) return false
    const query = search.trim().toLowerCase()
    setShopId(catalog.shop_id)
    setProducts(catalog.products.filter((product) => !query || [product.name, product.sku, product.barcode].some((value) => value?.toLowerCase().includes(query))))
    setCustomers(catalog.customers)
    if (!shop) applyShop(catalog.shop)
    setShop((current) => current ?? catalog.shop)
    setError('')
    return true
  }
  const fillRef = useRef(fillFromDevice)
  useEffect(() => { fillRef.current = fillFromDevice })

  useEffect(() => {
    let active = true
    setLoadingProducts(true)
    fetch(`/api/products?search=${encodeURIComponent(search)}`, { cache: 'no-store' })
      .then(async (response) => {
        const body = await response.json()
        if (!response.ok) throw new Error(body.error ?? t('pos.errProducts'))
        if (!active) return
        // Offline, an answer can still come from the service worker's cache; the device copy is newer
        // (it already counts the sales waiting on this till), so it wins.
        if (!navigator.onLine && await fillRef.current()) return
        fresh.current.products = search === '' && navigator.onLine
        setProducts(body.data ?? [])
        setOffline(!navigator.onLine)
      })
      .catch(async (loadError) => {
        if (!active) return
        if (isNetworkError(loadError) && await fillRef.current()) return
        setError(isNetworkError(loadError) ? t('pos.noCatalog') : loadError instanceof Error ? loadError.message : t('pos.errProducts'))
      })
      .finally(() => { if (active) setLoadingProducts(false) })
    return () => { active = false }
  }, [search, refreshKey])

  useEffect(() => {
    let active = true
    setLoadingSales(true)
    fetch('/api/sales', { cache: 'no-store' })
      .then(async (response) => {
        const body = await response.json()
        if (!response.ok) throw new Error(body.error ?? t('pos.errSales'))
        if (active) setSales(body.data ?? [])
      })
      .catch((loadError) => { if (active && !isNetworkError(loadError)) setError(loadError instanceof Error ? loadError.message : t('pos.errSales')) })
      .finally(() => { if (active) setLoadingSales(false) })
    return () => { active = false }
  }, [refreshKey])

  // Customers (for khata) and the shop profile (for receipts) are extras: the till works without them.
  useEffect(() => {
    let active = true
    fetch('/api/customers', { cache: 'no-store' }).then(async (response) => { if (!response.ok || !active) return; fresh.current.customers = navigator.onLine; setCustomers((await response.json()).data ?? []) }).catch(() => undefined)
    fetch('/api/settings', { cache: 'no-store' }).then(async (response) => {
      if (!response.ok || !active) return
      const data = (await response.json()).data
      fresh.current.shop = navigator.onLine
      applyShop(data)
      setShop(data)
      if (data?.id) setShopId(data.id)
    }).catch(() => undefined)
    return () => { active = false }
  }, [refreshKey])

  // Keep the device copy fresh while online (the full list only, never a search result).
  useEffect(() => { if (shopId && fresh.current.products) void saveCatalog(shopId, { products }).catch(() => undefined) }, [shopId, products])
  useEffect(() => { if (shopId && fresh.current.customers) void saveCatalog(shopId, { customers }).catch(() => undefined) }, [shopId, customers])
  useEffect(() => { if (shopId && shop && fresh.current.shop) void saveCatalog(shopId, { shop: { id: shopId, name: shop.name, phone: shop.phone, address: shop.address, receipt_footer: shop.receipt_footer, country: shop.country, currency: shop.currency, language: shop.language } }).catch(() => undefined) }, [shopId, shop])

  // Send waiting sales: now, when the browser says it is back online, and every 20 seconds.
  async function syncNow() {
    if (!shopId) return
    setSyncing(true)
    try {
      const result = await syncQueue(shopId)
      if (!result.offline && (result.synced || result.failed)) setRefreshKey((value) => value + 1)
      if (result.synced) setOffline(false)
      if (result.offline) setOffline(true)
    } catch { /* tried again on the next tick */ }
    finally {
      setQueue(await listQueue(shopId).catch(() => []))
      setSyncing(false)
    }
  }
  const syncRef = useRef(syncNow)
  useEffect(() => { syncRef.current = syncNow })
  useEffect(() => {
    if (!shopId) return
    void syncRef.current()
    const goOnline = () => { setRefreshKey((value) => value + 1); void syncRef.current() }
    const goOffline = () => setOffline(true)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    const timer = window.setInterval(() => void syncRef.current(), 20_000)
    return () => { window.removeEventListener('online', goOnline); window.removeEventListener('offline', goOffline); window.clearInterval(timer) }
  }, [shopId])
  const waiting = queue.filter((sale) => sale.status === 'pending').length

  const categories = useMemo(() => [...new Set(products.map((product) => product.category).filter((value): value is string => Boolean(value)))].sort(), [products])
  const visible = category ? products.filter((product) => product.category === category) : products
  const subtotal = cart.reduce((sum, item) => sum + Number(item.product.sale_price) * item.quantity, 0)
  const discountValue = Number(discount) || 0
  const total = Math.max(0, round(subtotal - discountValue))
  const receivedValue = received === '' ? null : Number(received)
  const change = paymentMethod === 'cash' && receivedValue !== null ? round(receivedValue - total) : null
  const customer = customers.find((item) => item.id === customerId)

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
    const inCart = cart.find((item) => item.product.id === product.id)?.quantity ?? 0
    if (change > 0 && inCart >= product.stock_quantity) playSound('error')
    else playSound(change > 0 ? 'add' : 'remove')
    if (change > 0) {
      setBumped(product.id)
      setTimeout(() => setBumped((current) => (current === product.id ? null : current)), 350)
    }
    setError('')
    setSuccess('')
    setLastSale(null)
  }

  // A barcode scanner types the code and presses Enter: an exact SKU or barcode adds that product.
  function scan(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') return
    const code = search.trim().toLowerCase()
    if (!code) return
    const match = products.find((product) => product.barcode?.toLowerCase() === code || product.sku?.toLowerCase() === code)
    if (!match) return
    event.preventDefault()
    if (match.stock_quantity <= 0) {
      playSound('error')
      setError(`${match.name} is out of stock.`)
      return
    }
    playSound('scan')
    changeQuantity(match, 1)
    setSearch('')
  }

  function resetSale() {
    setCart([])
    setDiscount('0')
    setReceived('')
    setCustomerId('')
    setPaymentMethod('cash')
    checkoutId.current = null
  }

  async function checkout() {
    if (!cart.length || checkoutLoading) return
    if (discountValue > subtotal) {
      setError(t('pos.errDiscount'))
      playSound('error')
      return
    }
    if (paymentMethod === 'credit' && !customerId) {
      setError(t('pos.errCustomer'))
      playSound('error')
      return
    }
    if (paymentMethod === 'cash' && receivedValue !== null && receivedValue < total) {
      setError(t('pos.errCash'))
      playSound('error')
      return
    }
    setCheckoutLoading(true)
    setError('')
    checkoutId.current ??= randomId()
    const sale = {
      client_id: checkoutId.current,
      items: cart.map(({ product, quantity }) => ({ product_id: product.id, quantity })),
      discount: discountValue,
      payment_method: paymentMethod,
      ...(customerId ? { customer_id: customerId } : {}),
      ...(receivedValue !== null && paymentMethod !== 'card' ? { amount_paid: receivedValue } : {}),
    }
    try {
      const response = await fetch('/api/sales', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(sale),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error ?? t('pos.errFailed'))
      setSuccess(t('pos.completed', { total: money(Number(body.data.total)) }))
      setLastSale(body.data)
      playSound('sale')
      setBurst((value) => value + 1)
      resetSale()
      setRefreshKey((value) => value + 1)
    } catch (checkoutError) {
      // No connection: keep the sale on this till and send it later. The cashier carries on.
      if (isNetworkError(checkoutError) && shopId) {
        try {
          await queueSale({ client_id: sale.client_id, shop_id: shopId, sold_at: new Date().toISOString(), body: sale, summary: { total, items: cart.map(({ product, quantity }) => ({ name: product.name, quantity })), customer_name: customer?.name ?? null } })
          const sold = new Map(cart.map(({ product, quantity }) => [product.id, quantity]))
          setProducts((items) => items.map((product) => (sold.has(product.id) ? { ...product, stock_quantity: Math.max(0, product.stock_quantity - sold.get(product.id)!) } : product)))
          setOffline(true)
          setSuccess(t('pos.savedOfflineNote', { total: money(total) }))
          setLastSale(null)
          playSound('sale')
          setBurst((value) => value + 1)
          resetSale()
          setQueue(await listQueue(shopId))
          // A lost reply is often a brief blip: try again soon rather than waiting for the next round.
          window.setTimeout(() => void syncRef.current(), 3000)
          return
        } catch { /* the device could not store it either: show the error below */ }
      }
      setError(checkoutError instanceof Error ? checkoutError.message : t('pos.errFailed'))
      playSound('error')
      // Stock may have changed on another till; show current levels.
      setRefreshKey((value) => value + 1)
    } finally {
      setCheckoutLoading(false)
    }
  }

  // Keyboard shortcuts for a busy counter: F2 or / to search, F9 or Ctrl+Enter to complete, Esc to clear.
  useEffect(() => { checkoutRef.current = () => { void checkout() } })
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const typing = event.target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName)
      if (event.key === 'F2' || (event.key === '/' && !typing)) {
        event.preventDefault()
        searchInput.current?.focus()
        searchInput.current?.select()
      } else if (event.key === 'F9' || (event.key === 'Enter' && (event.ctrlKey || event.metaKey))) {
        event.preventDefault()
        checkoutRef.current()
      } else if (event.key === 'Escape' && event.target === searchInput.current) {
        setSearch('')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <main className="min-h-screen bg-stone-50 p-4 sm:p-8">
      <div className="mx-auto max-w-7xl">
        <div className="no-print mb-6 flex flex-wrap items-center justify-between gap-4 shopos-rise">
          <div><Link href="/dashboard" className="mb-3 inline-flex items-center gap-2 text-sm font-medium text-emerald-700"><ArrowLeft className="size-4" />{t('pos.back')}</Link><h1 className="text-3xl font-bold text-stone-900">{t('pos.title')}</h1><p className="mt-1 text-sm text-muted-foreground">{shop?.name ? `${shop.name} · ` : ''}{t(offline ? 'pos.offline' : 'pos.online')}</p></div>
          <div className="flex items-center gap-2">
            {(offline || waiting > 0) && <span role="status" className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${offline ? 'bg-amber-100 text-amber-900' : 'bg-sky-100 text-sky-900'}`}>{offline ? <CloudOff className="size-3.5" /> : <RefreshCw className={`size-3.5 ${syncing ? 'animate-spin' : ''}`} />}{t(offline ? 'pos.offlineBadge' : 'pos.sending')}{waiting > 0 ? ` · ${t('pos.waiting', { count: waiting })}` : ''}</span>}
            <Badge variant="outline" className="bg-white">{products.length === 1 ? t('pos.oneProduct') : t('pos.products', { count: products.length })}</Badge>
            <button type="button" aria-label={t(sound ? 'pos.muteSounds' : 'pos.soundsOn')} title={t(sound ? 'pos.muteSounds' : 'pos.soundsOn')} onClick={() => setSoundEnabled(!sound)} className="flex size-10 items-center justify-center rounded-lg bg-white text-stone-500 ring-1 ring-stone-200 hover:text-stone-900">{sound ? <Volume2 className="size-5" /> : <VolumeX className="size-5" />}</button>
          </div>
        </div>

        {error && <p role="alert" className="no-print mb-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 shopos-rise">{error}</p>}
        {success && <p role="status" className="no-print mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-medium text-emerald-800 shopos-pop">{success}</p>}

        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
          <section className="no-print">
            <div className="relative mb-3"><Search className="absolute left-3 top-3 size-4 text-muted-foreground" /><Input ref={searchInput} value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={scan} placeholder={t('pos.search')} className="bg-white pl-9 pr-10" /><ScanBarcode aria-hidden="true" className="absolute right-3 top-3 size-4 text-muted-foreground" /></div>
            <p className="mb-3 hidden flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground lg:flex"><span><kbd>F2</kbd> {t('pos.keySearch')}</span><span><kbd>F9</kbd> {t('pos.keyFinish')}</span><span><kbd>Esc</kbd> {t('pos.keyClear')}</span><span>{t('pos.keyScan')}</span></p>
            {categories.length > 1 && <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label={t('pos.filterCategory')}>
              {['', ...categories].map((item) => <button key={item || 'all'} type="button" aria-pressed={category === item} onClick={() => { playSound('tap'); setCategory(item) }} className={`rounded-full px-4 text-sm font-medium transition ${category === item ? 'bg-emerald-600 text-white shadow-sm' : 'bg-white text-stone-600 ring-1 ring-stone-200 hover:bg-stone-100'}`}>{item || t('pos.all')}</button>)}
            </div>}
            {loadingProducts ? <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">{Array.from({ length: 8 }, (_, index) => <div key={index} className="h-36 rounded-xl shopos-shimmer" />)}</div> : visible.length ? <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
              {visible.map((product) => {
                const quantity = cart.find((item) => item.product.id === product.id)?.quantity ?? 0
                const low = product.stock_quantity > 0 && product.stock_quantity <= 3
                return <button key={product.id} type="button" disabled={product.stock_quantity <= 0} onClick={() => changeQuantity(product, 1)} className={`group relative overflow-hidden rounded-xl border bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-400 hover:shadow-md active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 ${quantity ? 'border-emerald-300 ring-2 ring-emerald-100' : ''} ${bumped === product.id ? 'shopos-pop' : ''}`}>
                  <div className="flex min-h-12 items-start justify-between gap-2"><span className="font-semibold text-stone-900">{product.name}</span>{quantity > 0 && <Badge className="shopos-pop">{quantity}</Badge>}</div>
                  <div className="mt-3 flex items-end justify-between gap-2">
                    <div><p className="text-sm font-bold text-emerald-700">{money(Number(product.sale_price))}</p><p className={`mt-1 text-xs ${low ? 'font-semibold text-amber-700' : 'text-muted-foreground'}`}>{t('pos.stock', { count: product.stock_quantity })}</p></div>
                    {product.image_url
                      ? <img src={product.image_url} alt="" className="size-12 rounded-xl border object-cover transition-transform group-hover:scale-110" />
                      : <span aria-hidden="true" className={`flex size-10 items-center justify-center rounded-xl text-sm font-bold transition-transform group-hover:scale-110 ${colorFor(product.category || product.name)}`}>{initials(product.name)}</span>}
                  </div>
                  {product.category && <span aria-hidden="true" className="absolute right-2 top-2 hidden rounded-full bg-stone-100 px-2 text-[10px] text-stone-500 group-hover:block">{product.category}</span>}
                </button>
              })}
            </div> : <div className="rounded-xl border border-dashed bg-white"><div className="flex flex-col items-center p-8 text-center"><EmptyBoxIllustration className="h-28 w-auto" /><p className="mt-3 text-sm text-muted-foreground">{t('pos.noProducts')}</p></div></div>}
          </section>

          <div className="lg:sticky lg:top-6">
            <Card className="no-print shadow-md">
              <CardHeader className="flex flex-row items-center justify-between"><CardTitle className="text-base">{t('pos.currentSale')}</CardTitle>{cart.length > 0 && <span className="text-xs text-muted-foreground">{t('pos.items', { count: cart.reduce((sum, item) => sum + item.quantity, 0) })}</span>}</CardHeader>
              <CardContent>
                {cart.length ? <div className="max-h-[320px] space-y-3 overflow-y-auto">{cart.map(({ product, quantity }) => <div key={product.id} className="flex items-center gap-2 border-b pb-3 shopos-rise">
                  <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{product.name}</p><p className="text-xs text-muted-foreground">{t('pos.each', { price: money(Number(product.sale_price)) })}</p></div>
                  <div className="flex items-center gap-1"><Button variant="outline" size="icon" aria-label={`Remove one ${product.name}`} onClick={() => changeQuantity(product, -1)}><Minus className="size-3" /></Button><span className="w-6 text-center text-sm tabular-nums">{quantity}</span><Button variant="outline" size="icon" aria-label={`Add one ${product.name}`} disabled={quantity >= product.stock_quantity} onClick={() => changeQuantity(product, 1)}><Plus className="size-3" /></Button></div>
                  <span className="w-20 text-right text-sm font-semibold">{money(Number(product.sale_price) * quantity)}</span>
                </div>)}</div> : <div className="flex flex-col items-center border-b pb-6 pt-2 text-center"><EmptyCartIllustration className="h-24 w-auto opacity-90" /><p className="mt-2 text-sm text-muted-foreground">{t('pos.empty')}</p></div>}

                <div className="mt-4 grid gap-3">
                  <div className="flex justify-between text-sm"><span className="text-muted-foreground">{t('pos.subtotal')}</span><span>{money(subtotal)}</span></div>
                  <div className="flex items-center justify-between gap-3"><label htmlFor="sale-discount" className="text-sm text-muted-foreground">{t('pos.discount')}</label><Input id="sale-discount" type="number" min="0" max={subtotal} step="0.01" value={discount} onChange={(event) => setDiscount(event.target.value)} className="w-32 text-right" /></div>
                  <div className="flex justify-between border-t pt-3 text-lg font-bold"><span>{t('pos.total')}</span><span className="text-emerald-700 tabular-nums">{money(total)}</span></div>
                  <Select items={{ cash: t('pos.cash'), card: t('pos.card'), credit: t('pos.credit') }} value={paymentMethod} onValueChange={(value) => { if (value === 'cash' || value === 'card' || value === 'credit') { setPaymentMethod(value); setReceived(''); playSound('tap') } }}>
                    <SelectTrigger aria-label={t('pos.paymentMethod')}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="cash">{t('pos.cash')}</SelectItem><SelectItem value="card">{t('pos.card')}</SelectItem>{customers.length > 0 && <SelectItem value="credit">{t('pos.credit')}</SelectItem>}</SelectContent>
                  </Select>
                  {customers.length > 0 && <div className="grid gap-1.5"><label htmlFor="sale-customer" className="text-sm text-muted-foreground">{t('pos.customer')}</label><select id="sale-customer" value={customerId} onChange={(event) => setCustomerId(event.target.value)} className="h-10 rounded-lg border border-input bg-white px-3 text-sm"><option value="">{t(paymentMethod === 'credit' ? 'pos.chooseCustomer' : 'pos.walkIn')}</option>{customers.map((item) => <option key={item.id} value={item.id}>{item.name}{item.balance > 0 ? ` (${t('pos.owes', { amount: money(item.balance) })})` : ''}</option>)}</select></div>}
                  {paymentMethod !== 'card' && cart.length > 0 && <div className="flex items-center justify-between gap-3"><label htmlFor="sale-received" className="text-sm text-muted-foreground">{t(paymentMethod === 'credit' ? 'pos.paidNow' : 'pos.cashReceived')}</label><Input id="sale-received" type="number" min="0" step="0.01" placeholder={paymentMethod === 'credit' ? '0' : String(total)} value={received} onChange={(event) => setReceived(event.target.value)} className="w-32 text-right" /></div>}
                  {change !== null && change >= 0 && <div className="flex justify-between rounded-lg bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800 shopos-pop"><span>{t('pos.change')}</span><span className="tabular-nums">{money(change)}</span></div>}
                  {paymentMethod === 'credit' && customer && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">{t('pos.onAccount', { amount: money(Math.max(0, round(total - (receivedValue ?? 0)))), name: customer.name })}</p>}
                  <Button disabled={!cart.length || checkoutLoading} onClick={() => void checkout()} className="h-12 w-full bg-emerald-600 text-base hover:bg-emerald-700">{checkoutLoading ? <><LoaderCircle className="mr-2 size-4 animate-spin" />{t('pos.completing')}</> : t('pos.complete', { total: money(total) })}</Button>
                  <Button variant="outline" disabled={!cart.length || checkoutLoading} onClick={() => { resetSale(); playSound('remove') }}>{t('pos.clear')}</Button>
                </div>
              </CardContent>
            </Card>
            {lastSale && <Receipt sale={lastSale} shop={shop} onPrint={() => window.print()} />}
          </div>
        </div>

        {queue.length > 0 && <Card className="no-print mt-8 border-amber-200">
          <CardHeader className="flex flex-row items-center justify-between"><CardTitle className="text-base">{t('pos.queue', { count: queue.length })}</CardTitle><Button variant="outline" size="sm" disabled={syncing} onClick={() => void syncNow()}><RefreshCw className={`mr-2 size-4 ${syncing ? 'animate-spin' : ''}`} />{t('pos.sendNow')}</Button></CardHeader>
          <CardContent><div className="divide-y">
            {queue.map((sale) => <div key={sale.client_id} className="flex flex-col justify-between gap-2 py-3 sm:flex-row sm:items-center"><div><p className="text-sm font-semibold">{t(sale.status === 'failed' ? 'pos.rejected' : 'pos.savedOffline')}</p><p className="text-xs text-muted-foreground">{formatDateTime(sale.sold_at)} · {sale.summary.items.map((item) => `${item.name} × ${item.quantity}`).join(', ')}{sale.summary.customer_name ? ` · ${sale.summary.customer_name}` : ''}</p>{sale.error && <p className="mt-1 text-xs text-rose-700">{sale.error}</p>}</div><div className="flex items-center gap-3">{sale.status === 'failed' && <Button variant="outline" size="sm" onClick={async () => { await discardQueued(sale.client_id); if (shopId) setQueue(await listQueue(shopId)) }}>{t('pos.discard')}</Button>}<Badge variant="secondary" className="capitalize">{sale.body.payment_method}</Badge><span className="text-sm font-bold">{money(sale.summary.total)}</span></div></div>)}
          </div></CardContent>
        </Card>}

        <Card className="no-print mt-8">
          <CardHeader className="flex flex-row items-center justify-between"><CardTitle className="text-base">{t('pos.recent')}</CardTitle>{shop && <Link href="/sales" className="text-sm font-medium text-emerald-700">{t('pos.allSales')} <ArrowUpRight className="ml-1 inline size-4" /></Link>}</CardHeader>
          <CardContent>{loadingSales ? <div className="flex items-center justify-center gap-2 p-6 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />{t('pos.loadingSales')}</div> : sales.length ? <div className="divide-y">
            {sales.map((sale) => <div key={sale.id} className="flex flex-col justify-between gap-2 py-3 sm:flex-row sm:items-center"><div><p className="text-sm font-semibold">{t('pos.receipt', { number: receiptLabel(sale) })}<ReturnBadge sale={sale} /></p><p className="text-xs text-muted-foreground">{formatDateTime(sale.created_at)} · {sale.items.map((item) => `${item.product_name} × ${item.quantity}`).join(', ')}{sale.customer_name ? ` · ${sale.customer_name}` : ''}</p></div><div className="flex items-center gap-3"><Badge variant="secondary" className={`capitalize ${sale.payment_method === 'credit' ? 'bg-amber-100 text-amber-800' : sale.payment_method === 'card' ? 'bg-sky-100 text-sky-800' : 'bg-emerald-100 text-emerald-800'}`}>{sale.payment_method}</Badge><span className="text-sm font-bold">{money(Number(sale.total))}</span></div></div>)}
          </div> : <p className="p-6 text-center text-sm text-muted-foreground">{t('pos.noSales')}</p>}</CardContent>
        </Card>
      </div>
      <Confetti burst={burst} />
    </main>
  )
}
