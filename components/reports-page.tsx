'use client'

import { useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import { Banknote, Calculator, Download, PackagePlus, Percent, ReceiptText, TrendingUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/components/auth/auth-provider'
import { ChartIllustration, EmptyState } from '@/components/illustrations'
import { Avatar, money, Notice, PageHeader, SkeletonRows, StatCard, useApi } from '@/components/page-kit'
import { playSound } from '@/lib/sounds'
import { addDays, dayKey, DEFAULT_TIMEZONE } from '@/lib/time'

type Report = {
  from: string
  to: string
  totals: { revenue: number; cogs: number; profit: number; margin: number; count: number; average: number; discounts: number; creditGiven: number; purchases: number; purchaseCount: number; payables: number }
  daily: Array<{ day: string; revenue: number; profit: number; count: number }>
  methods: Array<{ method: string; total: number; count: number }>
  topProducts: Array<{ product_id: string; name: string; quantity: number; revenue: number; profit: number }>
  credit: { total: number; customers: number; buckets: Array<{ label: string; total: number; share: number }>; top: Array<{ id: string; name: string; phone: string | null; balance: number }> }
}

type Preset = 'today' | '7d' | '30d' | 'month' | 'custom'
const PRESETS: Array<{ id: Preset; label: string }> = [{ id: 'today', label: 'Today' }, { id: '7d', label: '7 days' }, { id: '30d', label: '30 days' }, { id: 'month', label: 'This month' }, { id: 'custom', label: 'Custom' }]
const METHOD_STYLE: Record<string, string> = { cash: 'bg-emerald-500', card: 'bg-sky-500', credit: 'bg-amber-500' }
const BUCKET_STYLE = ['bg-emerald-500', 'bg-amber-500', 'bg-rose-500']
const chartConfig = { revenue: { label: 'Revenue', color: '#10b981' }, profit: { label: 'Profit', color: '#8b5cf6' } }

function rangeFor(preset: Preset, today: string) {
  if (preset === 'today') return { from: today, to: today }
  if (preset === '7d') return { from: addDays(today, -6), to: today }
  if (preset === 'month') return { from: `${today.slice(0, 7)}-01`, to: today }
  return { from: addDays(today, -29), to: today }
}

function csvCell(value: string | number) {
  const text = String(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function downloadCsv(report: Report) {
  const rows: Array<Array<string | number>> = [
    ['ShopOS report', `${report.from} to ${report.to}`],
    [],
    ['Revenue', report.totals.revenue], ['Cost of goods', report.totals.cogs], ['Gross profit', report.totals.profit], ['Margin %', report.totals.margin], ['Sales', report.totals.count], ['Average sale', report.totals.average], ['Discounts', report.totals.discounts], ['Credit given', report.totals.creditGiven], ['Purchases', report.totals.purchases],
    [],
    ['Day', 'Revenue', 'Profit', 'Sales'],
    ...report.daily.map((day) => [day.day, day.revenue, day.profit, day.count]),
    [],
    ['Top products', 'Quantity', 'Revenue', 'Profit'],
    ...report.topProducts.map((product) => [product.name, product.quantity, product.revenue, product.profit]),
  ]
  const blob = new Blob([`﻿${rows.map((row) => row.map(csvCell).join(',')).join('\n')}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `shopos-report-${report.from}-to-${report.to}.csv`
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  playSound('success')
}

export default function ReportsPage() {
  const { shop } = useAuth()
  const today = dayKey(shop?.timezone ?? DEFAULT_TIMEZONE)
  const [preset, setPreset] = useState<Preset>('30d')
  const [custom, setCustom] = useState(() => rangeFor('30d', today))
  const range = preset === 'custom' ? custom : rangeFor(preset, today)
  const report = useApi<Report>(`/api/reports?from=${range.from}&to=${range.to}`)
  const data = report.data
  const loading = report.loading && !data
  const chartData = useMemo(() => (data?.daily ?? []).map((day) => ({ ...day, label: new Date(`${day.day}T12:00:00Z`).toLocaleDateString('en-PK', { day: 'numeric', month: 'short' }) })), [data])
  const methodTotal = Math.max(1, ...(data?.methods ?? []).map((method) => method.total))

  return (
    <section>
      <PageHeader title="Reports" description="How your shop is doing, from saved sales." art={<ChartIllustration className="h-16 w-auto" />} actions={<Button variant="outline" disabled={!data} onClick={() => data && downloadCsv(data)}><Download className="mr-2 size-4" />Export CSV</Button>} />

      <div className="mb-6 flex flex-wrap items-end gap-3">
        <div className="flex flex-wrap gap-1 rounded-xl bg-white p-1 ring-1 ring-stone-200" role="group" aria-label="Report period">
          {PRESETS.map((item) => <button key={item.id} type="button" aria-pressed={preset === item.id} onClick={() => { playSound('tap'); setPreset(item.id); if (item.id === 'custom') setCustom(range) }} className={`rounded-lg px-3 text-sm font-medium transition ${preset === item.id ? 'bg-emerald-600 text-white shadow-sm' : 'text-stone-600 hover:bg-stone-100'}`}>{item.label}</button>)}
        </div>
        {preset === 'custom' && <div className="flex flex-wrap items-end gap-2">
          <div><Label htmlFor="report-from" className="text-xs">From</Label><Input id="report-from" type="date" max={custom.to} value={custom.from} onChange={(event) => event.target.value && setCustom({ ...custom, from: event.target.value })} className="mt-1 w-40 bg-white" /></div>
          <div><Label htmlFor="report-to" className="text-xs">To</Label><Input id="report-to" type="date" min={custom.from} max={today} value={custom.to} onChange={(event) => event.target.value && setCustom({ ...custom, to: event.target.value })} className="mt-1 w-40 bg-white" /></div>
        </div>}
        <p className="pb-2 text-xs text-muted-foreground">{range.from === range.to ? range.from : `${range.from} → ${range.to}`}</p>
      </div>

      {report.error && <Notice tone="error" action={<Button size="sm" variant="outline" onClick={() => void report.reload()}>Retry</Button>}>{report.error}</Notice>}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Revenue" value={data?.totals.revenue ?? 0} format={money} loading={loading} note={`${data?.totals.count ?? 0} sales · avg ${money(data?.totals.average ?? 0)}`} icon={Banknote} tone="emerald" />
        <StatCard title="Gross profit" value={data?.totals.profit ?? 0} format={money} loading={loading} note={`${data?.totals.margin ?? 0}% margin`} icon={TrendingUp} tone="violet" delay={60} />
        <StatCard title="Cost of goods" value={data?.totals.cogs ?? 0} format={money} loading={loading} note={`Discounts ${money(data?.totals.discounts ?? 0)}`} icon={Calculator} tone="sky" delay={120} />
        <StatCard title="Purchases" value={data?.totals.purchases ?? 0} format={money} loading={loading} note={`${data?.totals.purchaseCount ?? 0} received · you owe ${money(data?.totals.payables ?? 0)}`} icon={PackagePlus} tone="amber" delay={180} />
      </div>

      <Card className="mt-6 shopos-rise">
        <CardHeader><CardTitle className="text-base">Sales and profit by day</CardTitle></CardHeader>
        <CardContent>
          {loading ? <div className="h-72 rounded-lg shopos-shimmer" /> : data && data.totals.count ? <ChartContainer config={chartConfig} className="h-72 w-full">
            <BarChart accessibilityLayer data={chartData} margin={{ left: 4, right: 4 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={16} />
              <YAxis tickLine={false} axisLine={false} width={56} tickFormatter={(value: number) => (value >= 1000 ? `${Math.round(value / 1000)}k` : String(value))} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <ChartLegend content={<ChartLegendContent />} />
              <Bar dataKey="revenue" fill="var(--color-revenue)" radius={[6, 6, 0, 0]} />
              <Bar dataKey="profit" fill="var(--color-profit)" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ChartContainer> : <EmptyState illustration={ChartIllustration} title="No sales in this period">Pick a longer period, or make a sale in the POS.</EmptyState>}
        </CardContent>
      </Card>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Card className="shopos-rise">
          <CardHeader><CardTitle className="text-base">Top products</CardTitle></CardHeader>
          <CardContent>
            {loading ? <SkeletonRows rows={3} /> : data?.topProducts.length ? <ol className="grid gap-3">
              {data.topProducts.map((product, index) => <li key={product.product_id} className="flex items-center gap-3">
                <span className={`flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${index === 0 ? 'bg-amber-400 text-white' : index === 1 ? 'bg-stone-300 text-stone-800' : index === 2 ? 'bg-orange-300 text-white' : 'bg-stone-100 text-stone-600'}`}>{index + 1}</span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{product.name}</span>
                <span className="text-xs text-muted-foreground">{product.quantity} sold</span>
                <span className="w-24 text-right text-sm font-semibold tabular-nums">{money(product.revenue)}</span>
              </li>)}
            </ol> : <p className="py-6 text-center text-sm text-muted-foreground">No products sold in this period.</p>}
          </CardContent>
        </Card>

        <Card className="shopos-rise">
          <CardHeader><CardTitle className="text-base">Payment methods</CardTitle></CardHeader>
          <CardContent className="grid gap-4">
            {loading ? <SkeletonRows rows={3} /> : data?.methods.length ? data.methods.map((method) => <div key={method.method}>
              <div className="mb-1.5 flex justify-between text-sm"><span className="font-medium capitalize">{method.method}<span className="ml-2 text-xs font-normal text-muted-foreground">{method.count} sale{method.count === 1 ? '' : 's'}</span></span><span className="font-semibold tabular-nums">{money(method.total)}</span></div>
              <div className="h-2.5 overflow-hidden rounded-full bg-stone-100"><div className={`h-full rounded-full transition-all duration-700 ${METHOD_STYLE[method.method] ?? 'bg-stone-400'}`} style={{ width: `${(method.total / methodTotal) * 100}%` }} /></div>
            </div>) : <p className="py-6 text-center text-sm text-muted-foreground">No payments in this period.</p>}
            {data && data.totals.creditGiven > 0 && <p className="flex items-center gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-900"><ReceiptText className="size-4" />{money(data.totals.creditGiven)} of these sales went on khata.</p>}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6 shopos-rise">
        <CardHeader className="flex flex-row items-center justify-between"><div><CardTitle className="text-base">Khata (customer credit)</CardTitle><p className="mt-1 text-xs text-muted-foreground">Outstanding today, by how long it has been owed</p></div><span className="text-lg font-bold tabular-nums">{money(data?.credit.total ?? 0)}</span></CardHeader>
        <CardContent className="grid gap-6 lg:grid-cols-2">
          <div className="grid gap-4">
            {(data?.credit.buckets ?? []).map((bucket, index) => <div key={bucket.label}>
              <div className="mb-1.5 flex justify-between text-sm"><span>{bucket.label}</span><span className="font-semibold tabular-nums">{money(bucket.total)}</span></div>
              <div className="h-2.5 overflow-hidden rounded-full bg-stone-100"><div className={`h-full rounded-full transition-all duration-700 ${BUCKET_STYLE[index]}`} style={{ width: `${bucket.share}%` }} /></div>
            </div>)}
          </div>
          <div>
            <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><Percent className="size-3.5" />Largest balances</p>
            {data?.credit.top.length ? <ul className="divide-y rounded-xl border">{data.credit.top.map((customer) => <li key={customer.id} className="flex items-center gap-3 p-3"><Avatar name={customer.name} className="size-8 text-xs" /><span className="flex-1 text-sm font-medium">{customer.name}</span><span className="text-sm font-semibold tabular-nums text-amber-700">{money(customer.balance)}</span></li>)}</ul> : <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">Nobody owes you anything. 🎉</p>}
          </div>
        </CardContent>
      </Card>
    </section>
  )
}
