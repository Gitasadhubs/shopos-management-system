'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ArrowUpRight, BarChart3, Boxes, CreditCard, LayoutDashboard, Menu, RotateCcw, ShoppingCart, Store, WalletCards, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useAuth } from '@/components/auth/auth-provider'
import { can, type Permission } from '@/lib/permissions'
import LocalInventory from '@/components/local-inventory'

const navigation: Array<{ href: string; label: string; permission: Permission; icon: typeof LayoutDashboard }> = [
  { href: '/dashboard', label: 'Dashboard', permission: 'dashboard', icon: LayoutDashboard },
  { href: '/pos', label: 'POS', permission: 'pos', icon: ShoppingCart },
  { href: '/inventory', label: 'Inventory', permission: 'inventory', icon: Boxes },
]

type SaleRow = {
  id: string
  total: number
  payment_method: string
  created_at: string
  items?: Array<{ product_name: string; quantity: number }>
  customers?: { name?: string | null } | null
}

type DashboardData = {
  sales: number
  profit: number
  lowStock: number
  salesCount: number
  lowProducts: Array<{ id: string; name: string; stock_quantity: number; reorder_level: number }>
  recent: SaleRow[]
}

const money = (value: number) => `₨ ${Number(value).toLocaleString('en-PK', { maximumFractionDigits: 2 })}`

function AppSidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname()
  const { role, user, loading } = useAuth()
  const name = role?.full_name || user?.email?.split('@')[0] || 'Local user'
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((part: string) => part[0]).join('').toUpperCase()
  const links = navigation.filter((item) => can(role?.role, item.permission))

  return <aside className={`${open ? 'fixed inset-y-0 left-0 z-50 flex' : 'hidden'} w-64 shrink-0 flex-col border-r bg-white shadow-sm lg:fixed lg:flex`}>
    <div className="flex h-20 items-center gap-3 border-b px-6">
      <div className="flex size-10 items-center justify-center rounded-xl bg-emerald-600 text-white"><Store /></div>
      <div><div className="text-lg font-bold">Shop<span className="text-emerald-600">OS</span></div><div className="text-[11px] text-muted-foreground">Shop management</div></div>
      <button type="button" aria-label="Close navigation" onClick={onClose} className="ml-auto lg:hidden"><X /></button>
    </div>
    <div className="flex-1 px-3 py-5">
      <p className="px-3 pb-3 text-[11px] font-semibold uppercase text-muted-foreground">Workspace</p>
      <nav className="flex flex-col gap-1">
        {loading ? <p className="px-3 py-4 text-sm text-muted-foreground">Loading account…</p> : links.map(({ href, label, icon: Icon }) => <Link key={href} href={href} onClick={onClose} className={`flex min-h-11 items-center gap-3 rounded-lg px-4 text-sm font-medium ${pathname === href ? 'bg-emerald-50 text-emerald-700' : 'text-stone-600 hover:bg-stone-50 hover:text-stone-900'}`}>
          <Icon className="size-[18px]" />{label}
        </Link>)}
      </nav>
    </div>
    <div className="m-3 rounded-xl bg-stone-50 p-4">
      <p className="text-xs font-medium text-stone-600">Signed in as</p>
      <Separator className="my-3" />
      <div className="flex items-center gap-2"><div className="flex size-8 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-700">{initials || 'U'}</div><div><p className="text-xs font-semibold">{name}</p><p className="text-[11px] capitalize text-muted-foreground">{role?.role ?? 'Local'}</p></div></div>
    </div>
  </aside>
}

function Header({ onMenu }: { onMenu: () => void }) {
  const pathname = usePathname()
  const { role, roleError } = useAuth()
  const current = navigation.find((item) => item.href === pathname)?.label ?? 'Dashboard'
  return <>
    {roleError && <div role="alert" className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">{roleError}</div>}
    <header className="flex h-16 items-center gap-3 border-b bg-white px-4 sm:px-8">
      <button type="button" aria-label="Open navigation" className="lg:hidden" onClick={onMenu}><Menu /></button>
      <h1 className="text-sm font-semibold text-stone-900">{current}</h1>
      <span className="ml-auto text-xs text-muted-foreground">{role?.shop_id ? 'Hosted account' : 'Local SQLite'}</span>
    </header>
  </>
}

function StatCard({ title, value, note, icon: Icon }: { title: string; value: string; note: string; icon: typeof LayoutDashboard }) {
  return <Card><CardContent className="p-5"><div className="flex items-start justify-between gap-4"><div><p className="text-sm text-muted-foreground">{title}</p><p className="mt-2 text-2xl font-bold text-stone-900">{value}</p><p className="mt-2 text-xs text-muted-foreground">{note}</p></div><div className="flex size-10 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700"><Icon className="size-5" /></div></div></CardContent></Card>
}

function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    fetch('/api/dashboard', { cache: 'no-store' })
      .then(async (response) => {
        const body = await response.json()
        if (!response.ok) throw new Error(body.error ?? 'Could not load dashboard.')
        if (active) setData(body.data)
      })
      .catch((loadError) => { if (active) setError(loadError instanceof Error ? loadError.message : 'Could not load dashboard.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [refreshKey])

  const dashboard = data ?? { sales: 0, profit: 0, lowStock: 0, salesCount: 0, lowProducts: [], recent: [] }
  return <>
    <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
      <div><h2 className="text-2xl font-bold text-stone-900">Dashboard</h2><p className="mt-1 text-sm text-muted-foreground">Today&apos;s activity from saved records</p></div>
      <div className="flex gap-2"><Button variant="outline" onClick={() => setRefreshKey((value) => value + 1)}><RotateCcw data-icon="inline-start" />Refresh</Button><Link href="/pos" className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-medium text-white hover:bg-emerald-700"><ShoppingCart className="size-4" />New sale</Link></div>
    </div>
    {error && <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700"><span>{error}</span><Button size="sm" variant="outline" onClick={() => setRefreshKey((value) => value + 1)}>Retry</Button></div>}
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard title="Sales today" value={loading ? 'Loading…' : money(dashboard.sales)} note={`${dashboard.salesCount} completed sale${dashboard.salesCount === 1 ? '' : 's'}`} icon={CreditCard} />
      <StatCard title="Gross profit today" value={loading ? 'Loading…' : money(dashboard.profit)} note="Based on saved sale item costs" icon={WalletCards} />
      <StatCard title="Low stock" value={loading ? 'Loading…' : String(dashboard.lowStock)} note="At or below reorder level" icon={Boxes} />
      <StatCard title="Transactions" value={loading ? 'Loading…' : String(dashboard.salesCount)} note="Completed today" icon={BarChart3} />
    </div>
    <div className="mt-6 grid gap-6 xl:grid-cols-[1.4fr_1fr]">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between"><div><CardTitle className="text-base">Recent sales</CardTitle><p className="mt-1 text-xs text-muted-foreground">Completed today</p></div><Link href="/pos" className="text-sm font-medium text-emerald-700">Open POS <ArrowUpRight className="ml-1 inline size-4" /></Link></CardHeader>
        <CardContent>
          {loading ? <p className="py-8 text-center text-sm text-muted-foreground">Loading sales…</p> : dashboard.recent.length ? <Table><TableHeader><TableRow><TableHead>Receipt</TableHead><TableHead>Items</TableHead><TableHead>Payment</TableHead><TableHead>Amount</TableHead></TableRow></TableHeader><TableBody>{dashboard.recent.map((sale) => <TableRow key={sale.id}><TableCell className="font-medium">{sale.id.slice(0, 8)}</TableCell><TableCell>{sale.items?.map((item) => `${item.product_name} × ${item.quantity}`).join(', ') || sale.customers?.name || 'Sale'}</TableCell><TableCell><Badge variant="secondary" className="capitalize">{sale.payment_method}</Badge></TableCell><TableCell className="font-semibold">{money(sale.total)}</TableCell></TableRow>)}</TableBody></Table> : <p className="py-8 text-center text-sm text-muted-foreground">No sales recorded today.</p>}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Low stock</CardTitle><p className="text-xs text-muted-foreground">Products at or below reorder level</p></CardHeader>
        <CardContent className="flex flex-col gap-3">
          {loading ? <p className="py-8 text-center text-sm text-muted-foreground">Loading inventory…</p> : dashboard.lowProducts.length ? dashboard.lowProducts.map((product) => <div key={product.id} className="flex items-center justify-between gap-3 rounded-lg border p-3"><span className="font-medium">{product.name}</span><span className="shrink-0 text-sm text-amber-700">{product.stock_quantity} left</span></div>) : <p className="py-8 text-center text-sm text-muted-foreground">No products need reordering.</p>}
        </CardContent>
      </Card>
    </div>
  </>
}

export default function ShopOSApp() {
  const [menuOpen, setMenuOpen] = useState(false)
  const pathname = usePathname()
  const page = pathname === '/inventory' ? <LocalInventory /> : <Dashboard />

  return <div className="min-h-screen bg-stone-50 text-stone-900">
    <AppSidebar open={menuOpen} onClose={() => setMenuOpen(false)} />
    {menuOpen && <button type="button" aria-label="Close navigation overlay" className="fixed inset-0 z-40 bg-stone-900/20 lg:hidden" onClick={() => setMenuOpen(false)} />}
    <div className="lg:pl-64"><Header onMenu={() => setMenuOpen(true)} /><main className="p-4 sm:p-8">{page}</main></div>
  </div>
}