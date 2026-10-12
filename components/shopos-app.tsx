'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ArrowUpRight, BarChart3, BookUser, Boxes, CalendarCheck, CreditCard, LayoutDashboard, LogOut, Menu, PackagePlus, RotateCcw, Settings, ShoppingCart, Store, Truck, UserPlus, UserRound, Users, Volume2, VolumeX, Wallet, WalletCards, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useAuth } from '@/components/auth/auth-provider'
import { can, type Permission } from '@/lib/permissions'
import { playSound, setSoundEnabled, useSoundEnabled } from '@/lib/sounds'
import LocalInventory from '@/components/local-inventory'
import StaffPage from '@/components/staff-page'
import AccountPage from '@/components/account-page'
import { CustomersPage, SuppliersPage } from '@/components/party-page'
import PurchasesPage from '@/components/purchases-page'
import ReportsPage from '@/components/reports-page'
import SettingsPage from '@/components/settings-page'
import BillingPage from '@/components/billing-page'
import ExpensesPage from '@/components/expenses-page'
import DayEndPage from '@/components/day-end-page'
import { EmptyState, ReceiptIllustration, StorefrontIllustration } from '@/components/illustrations'
import { Avatar, money, StatCard } from '@/components/page-kit'

type NavItem = { href: string; label: string; permission: Permission; icon: typeof LayoutDashboard; group: 'Workspace' | 'Manage'; selfHostedOnly?: boolean }

// selfHostedOnly: screens backed by MariaDB storage (lib/local-*.ts).
const navigation: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', permission: 'dashboard', icon: LayoutDashboard, group: 'Workspace' },
  { href: '/pos', label: 'POS', permission: 'pos', icon: ShoppingCart, group: 'Workspace' },
  { href: '/inventory', label: 'Inventory', permission: 'inventory', icon: Boxes, group: 'Workspace' },
  { href: '/customers', label: 'Customers', permission: 'customers', icon: BookUser, group: 'Workspace', selfHostedOnly: true },
  { href: '/suppliers', label: 'Suppliers', permission: 'suppliers', icon: Truck, group: 'Workspace', selfHostedOnly: true },
  { href: '/purchases', label: 'Purchases', permission: 'purchases', icon: PackagePlus, group: 'Workspace', selfHostedOnly: true },
  { href: '/expenses', label: 'Expenses', permission: 'expenses', icon: Wallet, group: 'Workspace', selfHostedOnly: true },
  { href: '/reports', label: 'Reports', permission: 'reports', icon: BarChart3, group: 'Workspace', selfHostedOnly: true },
  { href: '/day-end', label: 'Day end', permission: 'reports', icon: CalendarCheck, group: 'Workspace', selfHostedOnly: true },
  { href: '/settings/users', label: 'Staff', permission: 'users', icon: Users, group: 'Manage', selfHostedOnly: true },
  { href: '/settings', label: 'Settings', permission: 'dashboard', icon: Settings, group: 'Manage', selfHostedOnly: true },
  { href: '/billing', label: 'Billing', permission: 'billing', icon: CreditCard, group: 'Manage', selfHostedOnly: true },
  { href: '/account', label: 'Account', permission: 'dashboard', icon: UserRound, group: 'Manage', selfHostedOnly: true },
]

type Subscription = { state: 'trialing' | 'active' | 'suspended' | 'expired'; days_left: number; current_period_end: string; can_write: boolean }

type SaleRow = {
  id: string
  total: number
  payment_method: string
  created_at: string
  customer_name?: string | null
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
  week?: Array<{ day: string; total: number }>
  creditOutstanding?: number
  creditCustomers?: number
  target?: number | null
  expensesToday?: number
  checklist?: Record<'products' | 'sale' | 'customers' | 'staff' | 'profile' | 'dayEnd', boolean>
}

// Progress towards the daily sales target, as a ring that fills up.
function TargetRing({ sales, target }: { sales: number; target: number }) {
  const progress = Math.min(1, sales / target)
  const radius = 52
  const circumference = 2 * Math.PI * radius
  const reached = sales >= target
  return <div className="flex items-center gap-5">
    <div className="relative size-32 shrink-0" role="img" aria-label={`${Math.round(progress * 100)}% of the daily target`}>
      <svg viewBox="0 0 120 120" className="size-full -rotate-90">
        <circle cx="60" cy="60" r={radius} fill="none" stroke="#f5f5f4" strokeWidth="12" />
        <circle cx="60" cy="60" r={radius} fill="none" stroke={reached ? 'url(#target-done)' : 'url(#target-progress)'} strokeWidth="12" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - progress)} style={{ transition: 'stroke-dashoffset 1s cubic-bezier(0.22, 1, 0.36, 1)' }} />
        <defs>
          <linearGradient id="target-progress" x1="0" x2="1"><stop offset="0" stopColor="#34d399" /><stop offset="1" stopColor="#059669" /></linearGradient>
          <linearGradient id="target-done" x1="0" x2="1"><stop offset="0" stopColor="#fbbf24" /><stop offset="1" stopColor="#f59e0b" /></linearGradient>
        </defs>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center"><span className="text-2xl font-bold tabular-nums">{Math.round(progress * 100)}%</span><span className="text-[11px] text-muted-foreground">of target</span></div>
    </div>
    <div>
      <p className="text-sm text-muted-foreground">Today’s target</p>
      <p className="text-xl font-bold tabular-nums">{money(target)}</p>
      <p className={`mt-1 text-sm font-medium ${reached ? 'text-amber-600' : 'text-emerald-700'}`}>{reached ? 'Target reached! 🎉' : `${money(Math.round((target - sales) * 100) / 100)} to go`}</p>
    </div>
  </div>
}

const CHECKLIST: Array<{ key: keyof NonNullable<DashboardData['checklist']>; label: string; href: string }> = [
  { key: 'products', label: 'Add your products', href: '/inventory' },
  { key: 'sale', label: 'Make your first sale', href: '/pos' },
  { key: 'profile', label: 'Add your shop phone or address for receipts', href: '/settings' },
  { key: 'customers', label: 'Add a khata customer', href: '/customers' },
  { key: 'staff', label: 'Invite a cashier or manager', href: '/settings/users' },
  { key: 'dayEnd', label: 'Turn on the daily day-end report', href: '/settings#day-end' },
]

// First steps for a new shop. Hidden once everything is done or the owner dismisses it.
function GettingStarted({ checklist, shopId }: { checklist: NonNullable<DashboardData['checklist']>; shopId: string }) {
  const key = `shopos:checklist-hidden:${shopId}`
  const [hidden, setHidden] = useState(() => { try { return typeof window !== 'undefined' && window.localStorage.getItem(key) === '1' } catch { return false } })
  const done = CHECKLIST.filter((step) => checklist[step.key]).length
  if (hidden || done === CHECKLIST.length) return null
  return <Card className="mb-6 overflow-hidden border-emerald-200 shopos-rise">
    <CardHeader className="flex flex-row items-start justify-between gap-4">
      <div><CardTitle className="text-base">Get your shop ready</CardTitle><p className="mt-1 text-xs text-muted-foreground">{done} of {CHECKLIST.length} done</p></div>
      <button type="button" className="text-xs font-medium text-muted-foreground hover:text-stone-900" onClick={() => { setHidden(true); try { window.localStorage.setItem(key, '1') } catch {} }}>Hide</button>
    </CardHeader>
    <CardContent>
      <div className="mb-4 h-2 overflow-hidden rounded-full bg-stone-100"><div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-600 transition-all duration-700" style={{ width: `${(done / CHECKLIST.length) * 100}%` }} /></div>
      <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{CHECKLIST.map((step) => <li key={step.key}>
        <Link href={step.href} onClick={() => playSound('tap')} className={`flex items-center gap-3 rounded-xl border p-3 text-sm transition ${checklist[step.key] ? 'border-emerald-100 bg-emerald-50/60 text-emerald-800' : 'bg-white hover:border-emerald-200 hover:shadow-sm'}`}>
          <span className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${checklist[step.key] ? 'bg-emerald-600 text-white' : 'border-2 border-stone-300'}`}>{checklist[step.key] ? '✓' : ''}</span>
          <span className={checklist[step.key] ? 'line-through decoration-emerald-400' : 'font-medium'}>{step.label}</span>
        </Link>
      </li>)}</ul>
    </CardContent>
  </Card>
}

function AppSidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname()
  const { role, user, shop, loading, selfHosted, signOut } = useAuth()
  const name = role?.full_name || user?.email?.split('@')[0] || 'Local user'
  const links = navigation.filter((item) => can(role?.role, item.permission) && (selfHosted || !item.selfHostedOnly))
  const groups = (['Workspace', 'Manage'] as const).map((group) => ({ group, items: links.filter((item) => item.group === group) })).filter(({ items }) => items.length)

  return <aside className={`${open ? 'fixed inset-y-0 left-0 z-50 flex' : 'hidden'} w-64 shrink-0 flex-col border-r bg-white shadow-sm lg:fixed lg:flex`}>
    <div className="flex h-20 items-center gap-3 border-b px-6">
      <div className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-700 text-white shadow-md shadow-emerald-600/30"><Store /></div>
      <div className="min-w-0"><div className="text-lg font-bold">Shop<span className="text-emerald-600">OS</span></div><div className="truncate text-[11px] text-muted-foreground">{shop?.name ?? 'Shop management'}</div></div>
      <button type="button" aria-label="Close navigation" onClick={onClose} className="ml-auto lg:hidden"><X /></button>
    </div>
    <div className="flex-1 overflow-y-auto px-3 py-4">
      <nav className="flex flex-col gap-1">
        {loading ? <p className="px-3 py-4 text-sm text-muted-foreground">Loading account…</p> : groups.map(({ group, items }) => <div key={group} className="mb-2">
          <p className="px-3 pb-2 pt-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{group}</p>
          {items.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || (href === '/dashboard' && pathname === '/')
            return <Link key={href} href={href} onClick={() => { playSound('tap'); onClose() }} className={`group flex min-h-11 items-center gap-3 rounded-lg px-4 text-sm font-medium transition-colors ${active ? 'bg-emerald-50 text-emerald-700' : 'text-stone-600 hover:bg-stone-50 hover:text-stone-900'}`}>
              <Icon className={`size-[18px] transition-transform group-hover:scale-110 ${active ? 'text-emerald-600' : ''}`} />{label}
            </Link>
          })}
        </div>)}
      </nav>
    </div>
    <div className="m-3 rounded-xl bg-stone-50 p-4">
      <p className="text-xs font-medium text-stone-600">Signed in as</p>
      <Separator className="my-3" />
      <div className="flex items-center gap-2"><Avatar name={name} className="size-8 text-xs" /><div className="min-w-0"><p className="truncate text-xs font-semibold">{name}</p><p className="text-[11px] capitalize text-muted-foreground">{role?.role ?? 'Local'}</p></div></div>
      {selfHosted && <Button variant="ghost" size="sm" className="mt-3 w-full justify-start text-stone-600" onClick={() => void signOut()}><LogOut className="mr-2 size-4" />Sign out</Button>}
    </div>
  </aside>
}

function PlanBadge({ subscription, owner }: { subscription: Subscription; owner: boolean }) {
  const label = subscription.state === 'trialing' ? `Trial · ${subscription.days_left} day${subscription.days_left === 1 ? '' : 's'} left` : subscription.state === 'active' ? 'Active plan' : subscription.state === 'suspended' ? 'Suspended' : 'Expired'
  const tone = subscription.state === 'active' ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : subscription.state === 'trialing' ? 'bg-amber-50 text-amber-800 ring-amber-200' : 'bg-rose-50 text-rose-700 ring-rose-200'
  const className = `hidden rounded-full px-3 py-1 text-xs font-semibold ring-1 sm:inline-flex ${tone}`
  return owner ? <Link href="/billing" className={className}>{label}</Link> : <span className={className}>{label}</span>
}

function SoundToggle() {
  const enabled = useSoundEnabled()
  return <button type="button" aria-label={enabled ? 'Mute sounds' : 'Turn sounds on'} title={enabled ? 'Mute sounds' : 'Turn sounds on'} onClick={() => setSoundEnabled(!enabled)} className="flex size-10 items-center justify-center rounded-lg text-stone-500 transition hover:bg-stone-100 hover:text-stone-900">
    {enabled ? <Volume2 className="size-5" /> : <VolumeX className="size-5" />}
  </button>
}

function Header({ onMenu }: { onMenu: () => void }) {
  const pathname = usePathname()
  const { role, roleError, shop, selfHosted } = useAuth()
  const current = navigation.find((item) => item.href === pathname)?.label ?? 'Dashboard'
  const subscription = shop?.subscription as Subscription | undefined
  const owner = role?.role === 'owner'
  return <>
    {roleError && <div role="alert" className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">{roleError}</div>}
    {subscription && !subscription.can_write && <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-rose-200 bg-rose-50 px-4 py-2 text-center text-sm text-rose-800">
      <span>{subscription.state === 'suspended' ? 'This shop is suspended.' : 'Your subscription has ended.'} The shop is read-only until it is renewed.</span>
      {owner ? <Link href="/billing" className="font-semibold underline underline-offset-2">Renew in Billing</Link> : <span>Ask the shop owner to renew.</span>}
    </div>}
    {subscription?.state === 'trialing' && subscription.days_left <= 3 && owner && <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-sm text-amber-900">Your free trial ends in {subscription.days_left} day{subscription.days_left === 1 ? '' : 's'}. <Link href="/billing" className="font-semibold underline underline-offset-2">See plans</Link></div>}
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b bg-white/90 px-4 backdrop-blur sm:px-8">
      <button type="button" aria-label="Open navigation" className="lg:hidden" onClick={onMenu}><Menu /></button>
      <h1 className="text-sm font-semibold text-stone-900">{current}</h1>
      <div className="ml-auto flex items-center gap-2">
        {subscription && <PlanBadge subscription={subscription} owner={owner} />}
        <span className="hidden max-w-48 truncate text-xs text-muted-foreground md:inline">{shop?.name ?? (selfHosted ? 'Self-hosted' : role?.shop_id ? 'Hosted account' : 'Local')}</span>
        <SoundToggle />
      </div>
    </header>
  </>
}

function greeting() {
  const hour = new Date().getHours()
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
}

function WeekChart({ week }: { week: Array<{ day: string; total: number }> }) {
  const max = Math.max(1, ...week.map((day) => day.total))
  return <div className="flex h-40 items-end gap-2 sm:gap-3" role="img" aria-label="Sales over the last 7 days">
    {week.map((day, index) => {
      const date = new Date(`${day.day}T12:00:00Z`)
      const today = index === week.length - 1
      return <div key={day.day} className="flex flex-1 flex-col items-center gap-2" title={`${date.toLocaleDateString('en-PK', { weekday: 'long', day: 'numeric', month: 'short' })}: ${money(day.total)}`}>
        <div className="flex w-full flex-1 items-end">
          <div className={`w-full rounded-t-lg shopos-grow ${today ? 'bg-gradient-to-t from-emerald-600 to-emerald-400' : 'bg-gradient-to-t from-emerald-200 to-emerald-100'}`} style={{ height: `${Math.max(4, (day.total / max) * 100)}%`, animationDelay: `${index * 60}ms` }} />
        </div>
        <span className={`text-[11px] ${today ? 'font-semibold text-emerald-700' : 'text-muted-foreground'}`}>{date.toLocaleDateString('en-PK', { weekday: 'short' })}</span>
      </div>
    })}
  </div>
}

const quickActions = [
  { href: '/pos', label: 'Sell', note: 'Open the till', icon: ShoppingCart, tone: 'from-emerald-500 to-emerald-600', permission: 'pos' as Permission },
  { href: '/inventory', label: 'Stock', note: 'Add or adjust products', icon: Boxes, tone: 'from-sky-500 to-sky-600', permission: 'inventory' as Permission },
  { href: '/customers', label: 'Khata', note: 'Customer credit', icon: UserPlus, tone: 'from-amber-500 to-orange-500', permission: 'customers' as Permission },
  { href: '/purchases', label: 'Receive', note: 'Stock from suppliers', icon: PackagePlus, tone: 'from-violet-500 to-violet-600', permission: 'purchases' as Permission },
  { href: '/reports', label: 'Reports', note: 'Profit and trends', icon: BarChart3, tone: 'from-rose-500 to-rose-600', permission: 'reports' as Permission },
  { href: '/expenses', label: 'Expense', note: 'Rent, bills, chai', icon: Wallet, tone: 'from-pink-500 to-rose-500', permission: 'expenses' as Permission },
]

function Dashboard() {
  const { role, shop, selfHosted } = useAuth()
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
  const firstName = (role?.full_name as string | undefined)?.split(/\s+/)[0] ?? ''
  const actions = quickActions.filter((action) => can(role?.role, action.permission) && (selfHosted || action.href === '/pos' || action.href === '/inventory'))
  return <>
    <section className="relative mb-6 overflow-hidden rounded-2xl text-white shadow-lg shadow-emerald-900/10 shopos-hero shopos-rise">
      <div className="absolute inset-0 shopos-dots" />
      <div className="relative flex flex-col gap-6 p-6 sm:flex-row sm:items-center sm:p-8">
        <div className="flex-1">
          <p className="text-sm font-medium text-emerald-100">{new Date().toLocaleDateString('en-PK', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
          <h2 className="mt-1 text-2xl font-bold sm:text-3xl">Dashboard</h2>
          <p className="mt-1 text-emerald-50">{greeting()}{firstName ? `, ${firstName}` : ''}! Here is today&apos;s activity{shop?.name ? ` at ${shop.name}` : ''}.</p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button variant="outline" className="border-white/30 bg-white/10 text-white hover:bg-white/20 hover:text-white" onClick={() => { playSound('tap'); setRefreshKey((value) => value + 1) }}><RotateCcw data-icon="inline-start" />Refresh</Button>
            <Link href="/pos" className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-white px-4 text-sm font-semibold text-emerald-800 shadow-sm transition hover:bg-emerald-50"><ShoppingCart className="size-4" />New sale</Link>
            {selfHosted && can(role?.role, 'reports') && <Link href="/day-end" className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-white/30 bg-white/10 px-4 text-sm font-semibold text-white transition hover:bg-white/20"><CalendarCheck className="size-4" />Close the day</Link>}
          </div>
        </div>
        <StorefrontIllustration className="hidden h-40 w-auto shrink-0 drop-shadow-xl shopos-float sm:block" />
      </div>
    </section>

    {error && <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700"><span>{error}</span><Button size="sm" variant="outline" onClick={() => setRefreshKey((value) => value + 1)}>Retry</Button></div>}
    {role?.role === 'owner' && data?.checklist && shop?.id && <GettingStarted checklist={data.checklist} shopId={shop.id} />}
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard title="Sales today" value={dashboard.sales} format={money} loading={loading} note={`${dashboard.salesCount} completed sale${dashboard.salesCount === 1 ? '' : 's'}`} icon={CreditCard} tone="emerald" />
      <StatCard title="Gross profit today" value={dashboard.profit} format={money} loading={loading} note="Based on saved sale item costs" icon={WalletCards} tone="violet" delay={60} />
      <StatCard title="Low stock" value={dashboard.lowStock} loading={loading} note="At or below reorder level" icon={Boxes} tone="amber" delay={120} />
      <StatCard title="Transactions" value={dashboard.salesCount} loading={loading} note="Completed today" icon={BarChart3} tone="sky" delay={180} />
    </div>

    {selfHosted && <div className="mt-6 grid gap-6 xl:grid-cols-[1.4fr_1fr]">
      <Card className="shopos-rise">
        <CardHeader className="flex flex-row items-center justify-between"><div><CardTitle className="text-base">Last 7 days</CardTitle><p className="mt-1 text-xs text-muted-foreground">Daily sales</p></div><span className="text-sm font-semibold text-emerald-700">{money((data?.week ?? []).reduce((sum, day) => sum + day.total, 0))}</span></CardHeader>
        <CardContent>
          {loading && !data ? <div className="h-40 rounded-lg shopos-shimmer" /> : <WeekChart week={data?.week ?? []} />}
          <div className="mt-5 grid gap-4 border-t pt-5 sm:grid-cols-[auto_1fr] sm:items-center">
            {data?.target ? <TargetRing sales={dashboard.sales} target={data.target} /> : <Link href="/settings#day-end" className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground hover:border-emerald-300 hover:text-emerald-700">🎯 Set a daily sales target to track your progress here.</Link>}
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-xl bg-rose-50 p-3"><p className="text-xs text-rose-700">Expenses today</p><p className="font-bold tabular-nums text-rose-800">{money(data?.expensesToday ?? 0)}</p></div>
              <div className="rounded-xl bg-emerald-50 p-3"><p className="text-xs text-emerald-700">Net profit today</p><p className="font-bold tabular-nums text-emerald-800">{money(Math.round((dashboard.profit - (data?.expensesToday ?? 0)) * 100) / 100)}</p></div>
            </div>
          </div>
        </CardContent>
      </Card>
      <Card className="shopos-rise">
        <CardHeader><CardTitle className="text-base">Quick actions</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-2">
          {actions.map(({ href, label, note, icon: Icon, tone }) => <Link key={href} href={href} onClick={() => playSound('tap')} className="group rounded-xl border bg-white p-3 transition hover:-translate-y-0.5 hover:border-emerald-200 hover:shadow-md">
            <span className={`flex size-10 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-sm transition-transform group-hover:scale-110 ${tone}`}><Icon className="size-5" /></span>
            <span className="mt-2 block text-sm font-semibold text-stone-900">{label}</span><span className="block text-xs text-muted-foreground">{note}</span>
          </Link>)}
          {(data?.creditOutstanding ?? 0) > 0 && <Link href="/customers" className="col-span-full rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 transition hover:bg-amber-100">Customers owe <strong>{money(data!.creditOutstanding!)}</strong> on khata ({data!.creditCustomers} customer{data!.creditCustomers === 1 ? '' : 's'})</Link>}
        </CardContent>
      </Card>
    </div>}

    <div className="mt-6 grid gap-6 xl:grid-cols-[1.4fr_1fr]">
      <Card className="shopos-rise">
        <CardHeader className="flex flex-row items-center justify-between"><div><CardTitle className="text-base">Recent sales</CardTitle><p className="mt-1 text-xs text-muted-foreground">Completed today</p></div><Link href="/pos" className="text-sm font-medium text-emerald-700">Open POS <ArrowUpRight className="ml-1 inline size-4" /></Link></CardHeader>
        <CardContent>
          {loading ? <p className="py-8 text-center text-sm text-muted-foreground">Loading sales…</p> : dashboard.recent.length ? <Table><TableHeader><TableRow><TableHead>Receipt</TableHead><TableHead>Items</TableHead><TableHead>Payment</TableHead><TableHead>Amount</TableHead></TableRow></TableHeader><TableBody>{dashboard.recent.map((sale) => <TableRow key={sale.id}><TableCell className="font-medium">{sale.id.slice(0, 8)}</TableCell><TableCell>{sale.items?.map((item) => `${item.product_name} × ${item.quantity}`).join(', ') || sale.customers?.name || 'Sale'}{sale.customer_name && <span className="block text-xs text-muted-foreground">{sale.customer_name}</span>}</TableCell><TableCell><Badge variant="secondary" className={`capitalize ${sale.payment_method === 'credit' ? 'bg-amber-100 text-amber-800' : sale.payment_method === 'card' ? 'bg-sky-100 text-sky-800' : 'bg-emerald-100 text-emerald-800'}`}>{sale.payment_method}</Badge></TableCell><TableCell className="font-semibold">{money(sale.total)}</TableCell></TableRow>)}</TableBody></Table> : <EmptyState illustration={ReceiptIllustration} title="No sales recorded today.">Your first sale of the day will appear here.</EmptyState>}
        </CardContent>
      </Card>
      <Card className="shopos-rise">
        <CardHeader><CardTitle className="text-base">Low stock</CardTitle><p className="text-xs text-muted-foreground">Products at or below reorder level</p></CardHeader>
        <CardContent className="flex flex-col gap-3">
          {loading ? <p className="py-8 text-center text-sm text-muted-foreground">Loading inventory…</p> : dashboard.lowProducts.length ? dashboard.lowProducts.map((product) => <div key={product.id} className="flex items-center justify-between gap-3 rounded-lg border p-3"><span className="font-medium">{product.name}</span><span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-sm text-amber-700">{product.stock_quantity} left</span></div>) : <p className="py-8 text-center text-sm text-muted-foreground">No products need reordering.</p>}
        </CardContent>
      </Card>
    </div>
  </>
}

function pageFor(pathname: string) {
  switch (pathname) {
    case '/inventory': return <LocalInventory />
    case '/customers': return <CustomersPage />
    case '/suppliers': return <SuppliersPage />
    case '/purchases': return <PurchasesPage />
    case '/reports': return <ReportsPage />
    case '/expenses': return <ExpensesPage />
    case '/day-end': return <DayEndPage />
    case '/settings': return <SettingsPage />
    case '/settings/users': return <StaffPage />
    case '/billing': return <BillingPage />
    case '/account': return <AccountPage />
    default: return <Dashboard />
  }
}

export default function ShopOSApp() {
  const [menuOpen, setMenuOpen] = useState(false)
  const pathname = usePathname()

  return <div className="min-h-screen bg-stone-50 text-stone-900">
    <AppSidebar open={menuOpen} onClose={() => setMenuOpen(false)} />
    {menuOpen && <button type="button" aria-label="Close navigation overlay" className="fixed inset-0 z-40 bg-stone-900/20 lg:hidden" onClick={() => setMenuOpen(false)} />}
    <div className="lg:pl-64"><Header onMenu={() => setMenuOpen(true)} /><main key={pathname} className="p-4 sm:p-8">{pageFor(pathname)}</main></div>
  </div>
}
