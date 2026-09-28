'use client'

import { useEffect, useState } from 'react'
import { LoaderCircle, Pencil, Plus, Search, SlidersHorizontal, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type Product = {
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
}

type ProductForm = {
  name: string
  sku: string
  barcode: string
  category: string
  unit: string
  cost_price: string
  sale_price: string
  stock_quantity: string
  reorder_level: string
}

const emptyForm: ProductForm = { name: '', sku: '', barcode: '', category: '', unit: 'pcs', cost_price: '0', sale_price: '0', stock_quantity: '0', reorder_level: '0' }
const money = (value: number) => `₨ ${value.toLocaleString('en-PK')}`

export default function LocalInventory() {
  const [products, setProducts] = useState<Product[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<ProductForm>(emptyForm)
  const [adjusting, setAdjusting] = useState<Product | null>(null)
  const [stockDelta, setStockDelta] = useState('')
  const [stockReason, setStockReason] = useState('')
  const [deleting, setDeleting] = useState<Product | null>(null)

  async function loadProducts() {
    setLoading(true)
    setError('')
    try {
      const response = await fetch(`/api/products?search=${encodeURIComponent(search)}`, { cache: 'no-store' })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error ?? 'Could not load products.')
      setProducts(body.data ?? [])
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load products.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void loadProducts() }, [search])

  function openNewProduct() {
    setEditingId(null)
    setForm(emptyForm)
    setError('')
    setFormOpen(true)
  }

  function openEditProduct(product: Product) {
    setEditingId(product.id)
    setForm({
      name: product.name,
      sku: product.sku ?? '',
      barcode: product.barcode ?? '',
      category: product.category ?? '',
      unit: product.unit || 'pcs',
      cost_price: String(product.cost_price),
      sale_price: String(product.sale_price),
      stock_quantity: String(product.stock_quantity),
      reorder_level: String(product.reorder_level),
    })
    setError('')
    setFormOpen(true)
  }

  async function saveProduct(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError('')
    const payload = {
      ...form,
      cost_price: Number(form.cost_price),
      sale_price: Number(form.sale_price),
      stock_quantity: Number(form.stock_quantity),
      reorder_level: Number(form.reorder_level),
    }
    try {
      const response = await fetch('/api/products', {
        method: editingId ? 'PUT' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(editingId ? { ...payload, id: editingId } : payload),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error ?? 'Could not save product.')
      setFormOpen(false)
      setSuccess(editingId ? 'Product updated.' : 'Product added.')
      await loadProducts()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save product.')
    } finally {
      setSaving(false)
    }
  }

  async function saveStockAdjustment(event: React.FormEvent) {
    event.preventDefault()
    if (!adjusting) return
    setSaving(true)
    setError('')
    try {
      const response = await fetch('/api/stock-moves', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ product_id: adjusting.id, delta: Number(stockDelta), reason: stockReason }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error ?? 'Could not adjust stock.')
      setAdjusting(null)
      setStockDelta('')
      setStockReason('')
      setSuccess('Stock updated.')
      await loadProducts()
    } catch (stockError) {
      setError(stockError instanceof Error ? stockError.message : 'Could not adjust stock.')
    } finally {
      setSaving(false)
    }
  }

  async function deleteProduct() {
    if (!deleting) return
    setSaving(true)
    setError('')
    try {
      const response = await fetch(`/api/products?id=${encodeURIComponent(deleting.id)}`, { method: 'DELETE' })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error ?? 'Could not delete product.')
      setDeleting(null)
      setSuccess('Product deleted.')
      await loadProducts()
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Could not delete product.')
    } finally {
      setSaving(false)
    }
  }

  const field = (name: keyof ProductForm, label: string, type = 'text', step?: string) => (
    <div>
      <Label htmlFor={`product-${name}`}>{label}</Label>
      <Input id={`product-${name}`} className="mt-1.5" type={type} step={step} min={type === 'number' ? 0 : undefined} required={name === 'name'} value={form[name]} onChange={(event) => setForm({ ...form, [name]: event.target.value })} />
    </div>
  )

  return (
    <section>
      <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div><h1 className="text-3xl font-bold tracking-tight">Inventory</h1><p className="mt-1 text-sm text-muted-foreground">Products and stock levels</p></div>
        <Button onClick={openNewProduct} className="bg-emerald-600 hover:bg-emerald-700"><Plus className="mr-2 size-4" />Add product</Button>
      </div>

      <div className="relative mb-4"><Search className="absolute left-3 top-3 size-4 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, SKU, or barcode" className="bg-white pl-9" /></div>
      {success && <p role="status" className="mb-4 text-sm text-emerald-700">{success}</p>}
      {error && !formOpen && !adjusting && !deleting && <p role="alert" className="mb-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}

      <Card>
        <CardHeader><CardTitle className="text-base">Products ({products.length})</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[850px] text-sm">
              <thead><tr className="border-b text-left text-muted-foreground"><th className="p-4">Product</th><th className="p-4">Category</th><th className="p-4">Cost</th><th className="p-4">Sale price</th><th className="p-4">Stock</th><th className="p-4">Reorder</th><th className="p-4 text-right">Actions</th></tr></thead>
              <tbody>{products.map((product) => <tr key={product.id} className="border-b last:border-0">
                <td className="p-4 font-medium">{product.name}<div className="text-xs text-muted-foreground">{product.sku || product.barcode || 'No SKU or barcode'}</div></td>
                <td className="p-4"><Badge variant="secondary">{product.category || 'Uncategorized'}</Badge></td>
                <td className="p-4">{money(product.cost_price)}</td><td className="p-4 font-semibold">{money(product.sale_price)}</td>
                <td className="p-4">{product.stock_quantity} {product.stock_quantity <= product.reorder_level && <Badge className="ml-1 bg-amber-100 text-amber-800">Low</Badge>}</td><td className="p-4">{product.reorder_level}</td>
                <td className="p-3 text-right"><div className="flex justify-end gap-1">
                  <Button variant="ghost" size="icon" aria-label={`Adjust stock for ${product.name}`} title="Adjust stock" onClick={() => { setAdjusting(product); setError('') }}><SlidersHorizontal className="size-4" /></Button>
                  <Button variant="ghost" size="icon" aria-label={`Edit ${product.name}`} title="Edit product" onClick={() => openEditProduct(product)}><Pencil className="size-4" /></Button>
                  <Button variant="ghost" size="icon" aria-label={`Delete ${product.name}`} title="Delete product" onClick={() => { setDeleting(product); setError('') }}><Trash2 className="size-4 text-rose-600" /></Button>
                </div></td>
              </tr>)}</tbody>
            </table>
            {loading && <div className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />Loading products…</div>}
            {!loading && !error && products.length === 0 && <p className="p-10 text-center text-sm text-muted-foreground">No products found. Add a product to get started.</p>}
          </div>
        </CardContent>
      </Card>

      <Dialog open={formOpen} onOpenChange={setFormOpen}><DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{editingId ? 'Edit product' : 'Add product'}</DialogTitle></DialogHeader>
        <form onSubmit={saveProduct} className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">{field('name', 'Product name')}</div>{field('sku', 'SKU')}{field('barcode', 'Barcode')}{field('category', 'Category')}{field('unit', 'Unit')}
          {field('cost_price', 'Cost price', 'number', '0.01')}{field('sale_price', 'Sale price', 'number', '0.01')}{field('stock_quantity', 'Stock quantity', 'number', '0.01')}{field('reorder_level', 'Reorder level', 'number', '0.01')}
          {error && <p role="alert" className="text-sm text-rose-600 sm:col-span-2">{error}</p>}
          <DialogFooter className="sm:col-span-2"><Button type="button" variant="outline" onClick={() => setFormOpen(false)}>Cancel</Button><Button type="submit" disabled={saving} className="bg-emerald-600 hover:bg-emerald-700">{saving ? 'Saving…' : editingId ? 'Save changes' : 'Add product'}</Button></DialogFooter>
        </form>
      </DialogContent></Dialog>

      <Dialog open={Boolean(adjusting)} onOpenChange={(open) => { if (!open) setAdjusting(null) }}><DialogContent>
        <DialogHeader><DialogTitle>Adjust stock{adjusting ? ` · ${adjusting.name}` : ''}</DialogTitle></DialogHeader>
        <form onSubmit={saveStockAdjustment} className="grid gap-4">
          <p className="text-sm text-muted-foreground">Current stock: {adjusting?.stock_quantity}</p>
          <div><Label htmlFor="stock-delta">Change in stock</Label><Input id="stock-delta" className="mt-1.5" type="number" step="0.01" value={stockDelta} onChange={(event) => setStockDelta(event.target.value)} placeholder="Use a negative number to remove stock" required /></div>
          <div><Label htmlFor="stock-reason">Reason</Label><Input id="stock-reason" className="mt-1.5" value={stockReason} onChange={(event) => setStockReason(event.target.value)} required maxLength={200} /></div>
          {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
          <DialogFooter><Button type="button" variant="outline" onClick={() => setAdjusting(null)}>Cancel</Button><Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Update stock'}</Button></DialogFooter>
        </form>
      </DialogContent></Dialog>

      <Dialog open={Boolean(deleting)} onOpenChange={(open) => { if (!open) setDeleting(null) }}><DialogContent>
        <DialogHeader><DialogTitle>Delete product?</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">{deleting?.name} will be removed from active inventory. Past sales will remain recorded.</p>
        {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
        <DialogFooter><Button variant="outline" onClick={() => setDeleting(null)}>Cancel</Button><Button variant="destructive" disabled={saving} onClick={() => void deleteProduct()}>{saving ? 'Deleting…' : 'Delete product'}</Button></DialogFooter>
      </DialogContent></Dialog>
    </section>
  )
}