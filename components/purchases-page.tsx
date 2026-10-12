'use client'

import { useMemo, useState } from 'react'
import { PackagePlus, Plus, Trash2, Truck, Wallet } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { EmptyState, TruckIllustration } from '@/components/illustrations'
import { api, dateTime, money, Notice, PageHeader, SkeletonRows, StatCard, useAction, useApi } from '@/components/page-kit'

// Receiving stock: each purchase adds to stock, can update cost prices, and puts any unpaid amount
// on the supplier's balance.

type Product = { id: string; name: string; cost_price: number; stock_quantity: number; unit: string }
type Supplier = { id: string; name: string; balance: number }
type Purchase = { id: string; supplier_name: string | null; reference: string | null; total: number; amount_paid: number; notes: string | null; created_at: string; items: Array<{ product_name: string; quantity: number; unit_cost: number; subtotal: number }> }
type Line = { key: number; product_id: string; quantity: string; unit_cost: string }

const selectClass = 'mt-1.5 h-10 w-full rounded-lg border border-input bg-white px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50'
let nextKey = 1
const newLine = (): Line => ({ key: nextKey++, product_id: '', quantity: '1', unit_cost: '' })

export default function PurchasesPage() {
  const purchases = useApi<Purchase[]>('/api/purchases')
  const [open, setOpen] = useState(false)
  const products = useApi<Product[]>(open ? '/api/products' : null)
  const suppliers = useApi<Supplier[]>(open ? '/api/suppliers' : null)
  const action = useAction()
  const [supplierId, setSupplierId] = useState('')
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')
  const [paid, setPaid] = useState('')
  const [updateCost, setUpdateCost] = useState(true)
  const [lines, setLines] = useState<Line[]>([newLine()])

  const productById = useMemo(() => new Map((products.data ?? []).map((product) => [product.id, product])), [products.data])
  const total = Math.round(lines.reduce((sum, line) => sum + (Number(line.quantity) || 0) * (Number(line.unit_cost) || 0), 0) * 100) / 100
  const paidValue = paid === '' ? total : Number(paid) || 0
  const owed = Math.max(0, Math.round((total - paidValue) * 100) / 100)

  const list = purchases.data ?? []
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime()
  const thisMonth = list.filter((purchase) => new Date(purchase.created_at).getTime() >= monthStart)

  function start() {
    setSupplierId('')
    setReference('')
    setNotes('')
    setPaid('')
    setUpdateCost(true)
    setLines([newLine()])
    action.setError('')
    action.setSuccess('')
    setOpen(true)
  }

  function setLine(key: number, change: Partial<Line>) {
    setLines((current) => current.map((line) => {
      if (line.key !== key) return line
      const next = { ...line, ...change }
      // Choosing a product fills in its current cost.
      if (change.product_id && line.unit_cost === '') next.unit_cost = String(productById.get(change.product_id)?.cost_price ?? '')
      return next
    }))
  }

  async function save(event: React.FormEvent) {
    event.preventDefault()
    const items = lines.filter((line) => line.product_id).map((line) => ({ product_id: line.product_id, quantity: Number(line.quantity), unit_cost: Number(line.unit_cost) }))
    const ok = await action.run(async () => {
      if (!items.length) throw new Error('Add at least one product.')
      const purchase = await api<Purchase>('/api/purchases', { method: 'POST', body: { supplier_id: supplierId || null, reference, notes, amount_paid: paidValue, update_cost: updateCost, items } })
      return `Purchase saved · ${money(purchase.total)} · stock updated.`
    }, 'success')
    if (ok) {
      setOpen(false)
      await purchases.reload()
    }
  }

  return (
    <section>
      <PageHeader title="Purchases" description="Stock you receive from suppliers." art={<TruckIllustration className="h-16 w-auto" />} actions={<Button onClick={start} className="bg-emerald-600 hover:bg-emerald-700"><Plus className="mr-2 size-4" />Record purchase</Button>} />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard title="Bought this month" value={thisMonth.reduce((sum, purchase) => sum + purchase.total, 0)} format={money} loading={purchases.loading && !purchases.data} note={`${thisMonth.length} purchase${thisMonth.length === 1 ? '' : 's'}`} icon={PackagePlus} tone="violet" />
        <StatCard title="Unpaid on recent purchases" value={list.reduce((sum, purchase) => sum + purchase.total - purchase.amount_paid, 0)} format={money} loading={purchases.loading && !purchases.data} note="Added to supplier balances" icon={Wallet} tone="amber" delay={60} />
        <StatCard title="Purchases listed" value={list.length} loading={purchases.loading && !purchases.data} note="Most recent first" icon={Truck} tone="sky" delay={120} />
      </div>

      {action.success && !open && <Notice tone="success">{action.success}</Notice>}
      {purchases.error && <Notice tone="error" action={<Button size="sm" variant="outline" onClick={() => void purchases.reload()}>Retry</Button>}>{purchases.error}</Notice>}

      <Card className="shopos-rise">
        <CardHeader><CardTitle className="text-base">Recent purchases</CardTitle></CardHeader>
        <CardContent className="p-0">
          {purchases.loading && !purchases.data ? <SkeletonRows /> : list.length ? <ul className="divide-y">
            {list.map((purchase) => <li key={purchase.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center">
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-violet-700"><PackagePlus className="size-5" /></span>
                <div className="min-w-0"><p className="font-semibold">{purchase.supplier_name ?? 'No supplier'}{purchase.reference && <span className="ml-2 text-xs font-normal text-muted-foreground">#{purchase.reference}</span>}</p><p className="text-xs text-muted-foreground">{dateTime(purchase.created_at)} · {purchase.items.map((item) => `${item.product_name} × ${item.quantity}`).join(', ')}</p></div>
              </div>
              <div className="text-right"><p className="font-bold tabular-nums">{money(purchase.total)}</p>{purchase.total > purchase.amount_paid ? <p className="text-xs text-amber-700">{money(purchase.total - purchase.amount_paid)} unpaid</p> : <p className="text-xs text-emerald-700">Paid</p>}</div>
            </li>)}
          </ul> : <EmptyState illustration={TruckIllustration} title="No purchases yet" action={<Button variant="outline" onClick={start}><Plus className="mr-2 size-4" />Record purchase</Button>}>When stock arrives, record it here and it is added to your inventory.</EmptyState>}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>Record purchase</DialogTitle></DialogHeader>
        <form onSubmit={save} className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div><Label htmlFor="purchase-supplier">Supplier</Label><select id="purchase-supplier" className={selectClass} value={supplierId} onChange={(event) => setSupplierId(event.target.value)}><option value="">No supplier (paid in full)</option>{(suppliers.data ?? []).map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></div>
            <div><Label htmlFor="purchase-reference">Bill / reference</Label><Input id="purchase-reference" className="mt-1.5" maxLength={80} value={reference} onChange={(event) => setReference(event.target.value)} /></div>
          </div>

          <div className="rounded-xl border">
            <div className="grid grid-cols-[1fr_80px_100px_40px] gap-2 border-b bg-stone-50 px-3 py-2 text-xs font-semibold text-muted-foreground"><span>Product</span><span>Qty</span><span>Unit cost</span><span /></div>
            {lines.map((line, index) => <div key={line.key} className="grid grid-cols-[1fr_80px_100px_40px] items-center gap-2 border-b px-3 py-2 last:border-0">
              <select aria-label={`Product ${index + 1}`} className="h-10 w-full rounded-lg border border-input bg-white px-2 text-sm" value={line.product_id} onChange={(event) => setLine(line.key, { product_id: event.target.value })}>
                <option value="">{products.loading ? 'Loading…' : 'Choose product'}</option>
                {(products.data ?? []).map((product) => <option key={product.id} value={product.id} disabled={lines.some((other) => other.key !== line.key && other.product_id === product.id)}>{product.name} (stock {product.stock_quantity})</option>)}
              </select>
              <Input aria-label={`Quantity ${index + 1}`} type="number" min="0.001" step="0.001" value={line.quantity} onChange={(event) => setLine(line.key, { quantity: event.target.value })} />
              <Input aria-label={`Unit cost ${index + 1}`} type="number" min="0" step="0.01" value={line.unit_cost} onChange={(event) => setLine(line.key, { unit_cost: event.target.value })} />
              <Button type="button" variant="ghost" size="icon" aria-label={`Remove line ${index + 1}`} disabled={lines.length === 1} onClick={() => setLines((current) => current.filter((other) => other.key !== line.key))}><Trash2 className="size-4 text-rose-600" /></Button>
            </div>)}
            <div className="p-2"><Button type="button" variant="ghost" size="sm" onClick={() => setLines((current) => [...current, newLine()])}><Plus className="mr-1 size-4" />Add line</Button></div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div><Label htmlFor="purchase-paid">Amount paid now</Label><Input id="purchase-paid" className="mt-1.5" type="number" min="0" step="0.01" placeholder={String(total)} value={paid} onChange={(event) => setPaid(event.target.value)} /></div>
            <div><Label htmlFor="purchase-notes">Notes</Label><Input id="purchase-notes" className="mt-1.5" maxLength={1000} value={notes} onChange={(event) => setNotes(event.target.value)} /></div>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-emerald-600" checked={updateCost} onChange={(event) => setUpdateCost(event.target.checked)} />Update product cost prices to these costs</label>

          <div className="rounded-xl bg-stone-50 p-4 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Total</span><span className="font-bold tabular-nums">{money(total)}</span></div>
            <div className="mt-1 flex justify-between"><span className="text-muted-foreground">Owed to supplier</span><span className={`font-semibold tabular-nums ${owed > 0 ? 'text-amber-700' : ''}`}>{money(owed)}</span></div>
          </div>
          {action.error && <p role="alert" className="text-sm text-rose-600">{action.error}</p>}
          <DialogFooter><Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" disabled={action.busy} className="bg-emerald-600 hover:bg-emerald-700">{action.busy ? 'Saving…' : `Save purchase · ${money(total)}`}</Button></DialogFooter>
        </form>
      </DialogContent></Dialog>
    </section>
  )
}
