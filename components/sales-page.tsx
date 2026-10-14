'use client'

import { useEffect, useRef, useState } from 'react'
import { RotateCcw, Search, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/components/auth/auth-provider'
import { EmptyState, ReceiptIllustration } from '@/components/illustrations'
import { api, dateTime, errorMessage, money, Notice, PageHeader, SkeletonRows, useAction, useApi } from '@/components/page-kit'
import { Receipt, receiptLabel, ReturnBadge, returnStatus, type ReceiptSale, type ShopProfile } from '@/components/receipt'
import { can } from '@/lib/permissions'
import { playSound } from '@/lib/sounds'
import { addDays, dayKey, DEFAULT_TIMEZONE } from '@/lib/time'
import { randomId } from '@/lib/utils'

// Every sale the shop has made: find one, print its receipt again, or take items back (a return).

type Item = ReceiptSale['items'][number] & { product_id: string; unit_price: number; returned_quantity: number }
type Sale = Omit<ReceiptSale, 'items'> & { number: number; discount: number; credit_amount: number; refunded: number; customer_id: string | null; items: Item[] }
type SaleReturn = { id: string; amount: number; khata_amount: number; refund_method: string; reason: string | null; created_by_name: string | null; created_at: string; items: Array<{ product_name: string; quantity: number }> }
type SaleDetail = Sale & { returns: SaleReturn[] }

type Period = 'today' | '7d' | '30d' | 'all'
const PERIODS: Array<{ id: Period; label: string }> = [{ id: 'today', label: 'Today' }, { id: '7d', label: '7 days' }, { id: '30d', label: '30 days' }, { id: 'all', label: 'All' }]
const PAGE = 50
const METHOD_STYLE: Record<string, string> = { cash: 'bg-emerald-100 text-emerald-800', card: 'bg-sky-100 text-sky-800', credit: 'bg-amber-100 text-amber-800' }

const left = (item: Item) => Math.max(0, Math.round((item.quantity - item.returned_quantity) * 1000) / 1000)

function salesUrl(period: Period, today: string, search: string, offset: number) {
  const params = new URLSearchParams({ limit: String(PAGE), offset: String(offset) })
  if (search.trim()) params.set('search', search.trim())
  if (period !== 'all') {
    params.set('from', period === 'today' ? today : addDays(today, period === '7d' ? -6 : -29))
    params.set('to', today)
  }
  return `/api/sales?${params}`
}

// Mirrors the server: each item's share of what was paid after the discount; the last return settles the rest.
function estimateRefund(sale: Sale, quantities: Record<string, string>) {
  const gross = sale.items.reduce((sum, item) => sum + item.subtotal, 0)
  const share = gross > 0 ? sale.total / gross : 0
  let amount = 0
  let everything = true
  for (const item of sale.items) {
    const quantity = Math.min(left(item), Number(quantities[item.product_id]) || 0)
    amount += Math.round(item.unit_price * quantity * share * 100) / 100
    if (left(item) - quantity > 0) everything = false
  }
  const remaining = Math.round((sale.total - sale.refunded) * 100) / 100
  return everything ? remaining : Math.min(Math.round(amount * 100) / 100, remaining)
}

function ReturnForm({ sale, onDone, onCancel }: { sale: SaleDetail; onDone: (sale: SaleDetail) => void; onCancel: () => void }) {
  const [quantities, setQuantities] = useState<Record<string, string>>({})
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const clientId = useRef<string | null>(null)
  const chosen = sale.items.filter((item) => Number(quantities[item.product_id]) > 0)
  const refund = estimateRefund(sale, quantities)
  const khataLeft = Math.max(0, Math.round((sale.credit_amount - sale.returns.reduce((sum, item) => sum + item.khata_amount, 0)) * 100) / 100)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!chosen.length) {
      setError('Enter how many of each item came back.')
      playSound('error')
      return
    }
    setBusy(true)
    setError('')
    // Kept until the return is saved, so a retry after a lost response is not recorded twice.
    clientId.current ??= randomId()
    try {
      const updated = await api<SaleDetail>(`/api/sales/${sale.id}/returns`, {
        method: 'POST',
        body: { client_id: clientId.current, reason, items: chosen.map((item) => ({ product_id: item.product_id, quantity: Number(quantities[item.product_id]) })) },
      })
      playSound('success')
      onDone(updated)
    } catch (submitError) {
      setError(errorMessage(submitError, 'The return could not be saved.'))
      playSound('error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">How many of each item came back?</p>
        <Button type="button" variant="outline" size="sm" onClick={() => setQuantities(Object.fromEntries(sale.items.map((item) => [item.product_id, String(left(item))])))}>Return everything</Button>
      </div>
      <ul className="divide-y rounded-xl border">
        {sale.items.map((item) => <li key={item.product_id} className="flex items-center gap-3 p-3 text-sm">
          <div className="min-w-0 flex-1"><p className="truncate font-medium">{item.product_name}</p><p className="text-xs text-muted-foreground">Sold {item.quantity} @ {money(item.unit_price)}{item.returned_quantity ? ` · ${item.returned_quantity} already returned` : ''}</p></div>
          {left(item) > 0
            ? <Input aria-label={`Quantity of ${item.product_name} returned`} type="number" min="0" max={left(item)} step="any" placeholder="0" value={quantities[item.product_id] ?? ''} onChange={(event) => setQuantities({ ...quantities, [item.product_id]: event.target.value })} className="w-20 text-right" />
            : <span className="text-xs font-medium text-muted-foreground">All returned</span>}
        </li>)}
      </ul>
      <div><Label htmlFor="return-reason">Reason (optional)</Label><Input id="return-reason" className="mt-1.5" maxLength={300} placeholder="e.g. Damaged, wrong size, changed mind" value={reason} onChange={(event) => setReason(event.target.value)} /></div>
      <div className="rounded-xl bg-stone-50 p-3 text-sm">
        <div className="flex justify-between font-semibold"><span>Refund</span><span className="tabular-nums">{money(refund)}</span></div>
        <p className="mt-1 text-xs text-muted-foreground">
          {sale.discount > 0 && 'The sale discount is shared across its items. '}
          {sale.payment_method === 'card' ? 'Goes back to the card.' : khataLeft > 0 ? `Comes off ${sale.customer_name ?? 'the customer'}’s khata first (up to ${money(khataLeft)}); any rest is paid back in cash.` : 'Paid back in cash.'}
          {' '}The items go back into stock.
        </p>
      </div>
      {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
      <DialogFooter><Button type="button" variant="outline" onClick={onCancel}>Back</Button><Button type="submit" variant="destructive" disabled={busy}>{busy ? 'Saving…' : `Record return · ${money(refund)}`}</Button></DialogFooter>
    </form>
  )
}

// What the cashier hands back for the newest return.
function refundMessage(sale: SaleDetail) {
  const latest = sale.returns[sale.returns.length - 1]
  if (!latest) return 'Return saved.'
  const rest = Math.round((latest.amount - latest.khata_amount) * 100) / 100
  const parts = [`Return saved on receipt ${receiptLabel(sale)}: ${money(latest.amount)}.`]
  if (latest.khata_amount > 0) parts.push(`${money(latest.khata_amount)} taken off ${sale.customer_name ?? 'the customer'}’s khata.`)
  if (rest > 0) parts.push(latest.refund_method === 'card' ? `Refund ${money(rest)} to the card.` : `Give ${money(rest)} back in cash.`)
  return parts.join(' ')
}

export default function SalesPage() {
  const { shop, role } = useAuth()
  const today = dayKey(shop?.timezone ?? DEFAULT_TIMEZONE)
  const canReturn = can(role?.role, 'returns') && shop?.subscription?.can_write !== false
  const [period, setPeriod] = useState<Period>('30d')
  const [search, setSearch] = useState('')
  const list = useApi<Sale[]>(salesUrl(period, today, search, 0))
  const [more, setMore] = useState<Sale[]>([])
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const detail = useApi<SaleDetail>(openId ? `/api/sales/${openId}` : null)
  const [returning, setReturning] = useState(false)
  const action = useAction()
  const profile = useApi<ShopProfile>('/api/settings')
  const sales = [...(list.data ?? []), ...more]

  // New filters start the list again.
  useEffect(() => {
    setMore([])
    setHasMore((list.data?.length ?? 0) === PAGE)
  }, [list.data])

  async function loadMore() {
    setLoadingMore(true)
    try {
      const page = await api<Sale[]>(salesUrl(period, today, search, sales.length))
      setMore((current) => [...current, ...page])
      setHasMore(page.length === PAGE)
    } catch (loadError) {
      action.setError(errorMessage(loadError, 'Could not load more sales.'))
    } finally {
      setLoadingMore(false)
    }
  }

  function open(sale: Sale) {
    playSound('tap')
    action.setError('')
    action.setSuccess('')
    setReturning(false)
    setOpenId(sale.id)
  }

  function returned(updated: SaleDetail) {
    detail.setData(updated)
    setReturning(false)
    action.setSuccess(refundMessage(updated))
    setMore((current) => current.map((sale) => (sale.id === updated.id ? updated : sale)))
    void list.reload()
  }

  const sale = detail.data && detail.data.id === openId ? detail.data : null
  const status = sale ? returnStatus(sale) : null

  return (
    <section>
      <PageHeader title="Sales" description="Find a sale, print its receipt again, or take items back." art={<ReceiptIllustration className="h-16 w-auto" />} />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1"><Search className="absolute left-3 top-3 size-4 text-muted-foreground" /><Input aria-label="Search sales" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Receipt number, customer or product" className="bg-white pl-9" /></div>
        <div className="flex flex-wrap gap-1 rounded-xl bg-white p-1 ring-1 ring-stone-200" role="group" aria-label="Period">
          {PERIODS.map((item) => <button key={item.id} type="button" aria-pressed={period === item.id} onClick={() => { playSound('tap'); setPeriod(item.id) }} className={`rounded-lg px-3 text-sm font-medium transition ${period === item.id ? 'bg-emerald-600 text-white shadow-sm' : 'text-stone-600 hover:bg-stone-100'}`}>{item.label}</button>)}
        </div>
      </div>

      {action.success && !openId && <Notice tone="success">{action.success}</Notice>}
      {(list.error || (action.error && !openId)) && <Notice tone="error" action={list.error ? <Button size="sm" variant="outline" onClick={() => void list.reload()}>Retry</Button> : undefined}>{list.error || action.error}</Notice>}

      <Card className="shopos-rise">
        <CardContent className="p-0">
          {list.loading && !list.data ? <SkeletonRows rows={6} /> : sales.length ? <ul className="divide-y">
            {sales.map((item) => <li key={item.id}>
              <button type="button" onClick={() => open(item)} aria-label={`Open receipt ${receiptLabel(item)}`} className="flex w-full flex-col gap-2 px-4 py-3 text-left transition hover:bg-stone-50 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">Receipt {receiptLabel(item)}<ReturnBadge sale={item} /></p>
                  <p className="truncate text-xs text-muted-foreground">{dateTime(item.created_at)} · {item.items.map((line) => `${line.product_name} × ${line.quantity}`).join(', ')}{item.customer_name ? ` · ${item.customer_name}` : ''}{item.created_by_name ? ` · by ${item.created_by_name}` : ''}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${METHOD_STYLE[item.payment_method] ?? 'bg-stone-100 text-stone-700'}`}>{item.payment_method}</span>
                  <span className="w-24 text-right text-sm font-bold tabular-nums">{money(item.total)}</span>
                </div>
              </button>
            </li>)}
          </ul> : <EmptyState illustration={ReceiptIllustration} title={search ? `No sales match “${search}”.` : 'No sales in this period'}>{search ? 'Try a receipt number like 12, a customer or a product.' : 'Pick a longer period, or make a sale in the POS.'}</EmptyState>}
        </CardContent>
      </Card>
      {hasMore && <div className="mt-4 flex justify-center"><Button variant="outline" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? 'Loading…' : 'Show more sales'}</Button></div>}

      <Dialog open={Boolean(openId)} onOpenChange={(isOpen) => { if (!isOpen) { setOpenId(null); setReturning(false) } }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader><DialogTitle>{returning ? 'Return items' : 'Receipt'} {sale ? receiptLabel(sale) : ''}</DialogTitle></DialogHeader>
          {detail.error ? <p role="alert" className="text-sm text-rose-600">{detail.error}</p> : !sale ? <SkeletonRows rows={3} /> : returning ? <ReturnForm sale={sale} onDone={returned} onCancel={() => setReturning(false)} /> : <div className="grid gap-4">
            {action.success && <Notice tone="success">{action.success}</Notice>}
            <Receipt sale={sale} shop={profile.data} copy onPrint={() => window.print()} className="" />
            {sale.returns.length > 0 && <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Returns</p>
              <ul className="divide-y rounded-xl border">{sale.returns.map((item) => <li key={item.id} className="flex items-start justify-between gap-3 p-3 text-sm">
                <div><p className="font-medium">{item.items.map((line) => `${line.product_name} × ${line.quantity}`).join(', ')}</p><p className="text-xs text-muted-foreground">{dateTime(item.created_at)}{item.created_by_name ? ` · ${item.created_by_name}` : ''}{item.reason ? ` · ${item.reason}` : ''}</p></div>
                <div className="text-right"><p className="font-semibold tabular-nums text-rose-700">−{money(item.amount)}</p><p className="text-xs text-muted-foreground">{item.khata_amount > 0 ? `${money(item.khata_amount)} off khata` : ''}{item.khata_amount > 0 && item.amount > item.khata_amount ? ' · ' : ''}{item.amount > item.khata_amount ? `${money(Math.round((item.amount - item.khata_amount) * 100) / 100)} ${item.refund_method}` : ''}</p></div>
              </li>)}</ul>
            </div>}
            {canReturn && status !== 'returned' && <Button variant="outline" className="text-rose-700 hover:text-rose-800" onClick={() => { action.setSuccess(''); setReturning(true) }}><Undo2 className="mr-2 size-4" />Return items</Button>}
            {!can(role?.role, 'returns') && status !== 'returned' && <p className="flex items-center gap-2 text-xs text-muted-foreground"><RotateCcw className="size-3.5" />Returns are recorded by a manager or the owner.</p>}
          </div>}
        </DialogContent>
      </Dialog>
    </section>
  )
}
