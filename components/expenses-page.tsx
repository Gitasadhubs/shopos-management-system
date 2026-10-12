'use client'

import { useState } from 'react'
import { Bus, CalendarDays, Coffee, Lightbulb, Package, Plus, Receipt, Store, Trash2, Users, Wallet, Wrench, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/components/auth/auth-provider'
import { EmptyState, ReceiptIllustration } from '@/components/illustrations'
import { api, money, Notice, PageHeader, SkeletonRows, StatCard, useAction, useApi } from '@/components/page-kit'
import { addDays, dayKey, DEFAULT_TIMEZONE } from '@/lib/time'

// Money spent running the shop. Expenses lower net profit in Reports and the day-end report.

type Expense = { id: string; category: string; amount: number; note: string | null; spent_on: string; created_by_name: string | null }
type ExpenseList = { expenses: Expense[]; total: number; byCategory: Array<{ category: string; total: number }>; categories: string[]; from: string; to: string }

const ICONS: Record<string, LucideIcon> = { Rent: Store, 'Electricity & gas': Lightbulb, Salaries: Users, Transport: Bus, 'Tea & food': Coffee, Repairs: Wrench, Supplies: Package, Other: Receipt }
const TONES: Record<string, string> = { Rent: 'bg-violet-100 text-violet-700', 'Electricity & gas': 'bg-amber-100 text-amber-700', Salaries: 'bg-sky-100 text-sky-700', Transport: 'bg-teal-100 text-teal-700', 'Tea & food': 'bg-orange-100 text-orange-700', Repairs: 'bg-rose-100 text-rose-700', Supplies: 'bg-lime-100 text-lime-700', Other: 'bg-stone-100 text-stone-700' }
const CATEGORIES = ['Rent', 'Electricity & gas', 'Salaries', 'Transport', 'Tea & food', 'Repairs', 'Supplies', 'Other']

function lastDayOfMonth(month: string) {
  const date = new Date(`${month}-01T00:00:00Z`)
  date.setUTCMonth(date.getUTCMonth() + 1)
  date.setUTCDate(0)
  return date.toISOString().slice(0, 10)
}

const dayLabel = (day: string, today: string) => day === today ? 'Today' : day === addDays(today, -1) ? 'Yesterday' : new Date(`${day}T12:00:00Z`).toLocaleDateString('en-PK', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' })

export default function ExpensesPage() {
  const { shop } = useAuth()
  const today = dayKey(shop?.timezone ?? DEFAULT_TIMEZONE)
  const [month, setMonth] = useState(today.slice(0, 7))
  const to = month === today.slice(0, 7) ? today : lastDayOfMonth(month)
  const list = useApi<ExpenseList>(`/api/expenses?from=${month}-01&to=${to}`)
  const action = useAction()
  const [form, setForm] = useState({ category: 'Tea & food', amount: '', note: '', spent_on: today })
  const [deleting, setDeleting] = useState<Expense | null>(null)
  const data = list.data
  const todayTotal = (data?.expenses ?? []).filter((expense) => expense.spent_on === today).reduce((sum, expense) => sum + expense.amount, 0)
  const maxCategory = Math.max(1, ...(data?.byCategory ?? []).map((item) => item.total))
  const days = [...new Set((data?.expenses ?? []).map((expense) => expense.spent_on))]

  async function add(event: React.FormEvent) {
    event.preventDefault()
    const ok = await action.run(async () => {
      await api('/api/expenses', { method: 'POST', body: { ...form, amount: Number(form.amount) } })
      return `${form.category} expense of ${money(Number(form.amount))} saved.`
    }, 'add')
    if (ok) {
      setForm({ ...form, amount: '', note: '' })
      if (form.spent_on.slice(0, 7) !== month) setMonth(form.spent_on.slice(0, 7))
      else await list.reload()
    }
  }

  async function remove() {
    if (!deleting) return
    const ok = await action.run(async () => {
      await api(`/api/expenses/${deleting.id}`, { method: 'DELETE' })
      return 'Expense deleted.'
    })
    if (ok) {
      setDeleting(null)
      await list.reload()
    }
  }

  return (
    <section>
      <PageHeader title="Expenses" description="Rent, bills, wages and the daily chai: what it costs to run the shop." art={<ReceiptIllustration className="h-16 w-auto" />} actions={<div className="flex items-center gap-2"><CalendarDays className="size-4 text-muted-foreground" /><Input aria-label="Month" type="month" max={today.slice(0, 7)} value={month} onChange={(event) => event.target.value && setMonth(event.target.value)} className="w-44 bg-white" /></div>} />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard title="Spent this month" value={data?.total ?? 0} format={money} loading={list.loading && !data} note={`${data?.expenses.length ?? 0} expense${data?.expenses.length === 1 ? '' : 's'}`} icon={Wallet} tone="rose" />
        <StatCard title="Spent today" value={month === today.slice(0, 7) ? todayTotal : 0} format={money} loading={list.loading && !data} note={month === today.slice(0, 7) ? 'Counts against today’s profit' : 'Pick this month to see today'} icon={Receipt} tone="amber" delay={60} />
        <StatCard title="Biggest cost" value={data?.byCategory[0]?.total ?? 0} format={money} loading={list.loading && !data} note={data?.byCategory[0]?.category ?? 'Nothing yet'} icon={Store} tone="violet" delay={120} />
      </div>

      {action.success && !deleting && <Notice tone="success">{action.success}</Notice>}
      {(list.error || (action.error && !deleting)) && <Notice tone="error">{list.error || action.error}</Notice>}

      <div className="grid gap-6 xl:grid-cols-[380px_1fr]">
        <div className="grid content-start gap-6">
          <Card className="shopos-rise">
            <CardHeader><CardTitle className="text-base">Add an expense</CardTitle></CardHeader>
            <CardContent>
              <form onSubmit={add} className="grid gap-4">
                <div role="group" aria-label="Category" className="grid grid-cols-2 gap-2">
                  {CATEGORIES.map((category) => {
                    const Icon = ICONS[category]
                    const active = form.category === category
                    return <button key={category} type="button" aria-pressed={active} onClick={() => setForm({ ...form, category })} className={`flex items-center gap-2 rounded-xl border px-3 text-left text-sm font-medium transition ${active ? 'border-emerald-500 bg-emerald-50 text-emerald-800 ring-2 ring-emerald-100' : 'bg-white text-stone-600 hover:bg-stone-50'}`}>
                      <span className={`flex size-7 shrink-0 items-center justify-center rounded-lg ${TONES[category]}`}><Icon className="size-4" /></span>{category}
                    </button>
                  })}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label htmlFor="expense-amount">Amount (₨)</Label><Input id="expense-amount" className="mt-1.5" type="number" min="0.01" step="0.01" required value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} /></div>
                  <div><Label htmlFor="expense-day">Date</Label><Input id="expense-day" className="mt-1.5" type="date" max={today} required value={form.spent_on} onChange={(event) => setForm({ ...form, spent_on: event.target.value })} /></div>
                </div>
                <div><Label htmlFor="expense-note">Note</Label><Input id="expense-note" className="mt-1.5" maxLength={300} placeholder="e.g. October rent, K-Electric bill" value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} /></div>
                <Button type="submit" disabled={action.busy} className="bg-emerald-600 hover:bg-emerald-700"><Plus className="mr-2 size-4" />{action.busy ? 'Saving…' : 'Add expense'}</Button>
              </form>
            </CardContent>
          </Card>

          {Boolean(data?.byCategory.length) && <Card className="shopos-rise">
            <CardHeader><CardTitle className="text-base">Where the money went</CardTitle></CardHeader>
            <CardContent className="grid gap-3">
              {data!.byCategory.map((item) => {
                const Icon = ICONS[item.category] ?? Receipt
                return <div key={item.category} className="flex items-center gap-3">
                  <span className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${TONES[item.category] ?? TONES.Other}`}><Icon className="size-4" /></span>
                  <div className="flex-1"><div className="mb-1 flex justify-between text-sm"><span>{item.category}</span><span className="font-semibold tabular-nums">{money(item.total)}</span></div><div className="h-2 overflow-hidden rounded-full bg-stone-100"><div className="h-full rounded-full bg-gradient-to-r from-rose-400 to-rose-500 transition-all duration-700" style={{ width: `${(item.total / maxCategory) * 100}%` }} /></div></div>
                </div>
              })}
            </CardContent>
          </Card>}
        </div>

        <Card className="shopos-rise">
          <CardHeader className="flex flex-row items-center justify-between"><CardTitle className="text-base">{new Date(`${month}-15T00:00:00Z`).toLocaleDateString('en-PK', { month: 'long', year: 'numeric', timeZone: 'UTC' })}</CardTitle><span className="text-sm font-semibold tabular-nums">{money(data?.total ?? 0)}</span></CardHeader>
          <CardContent className="p-0">
            {list.loading && !data ? <SkeletonRows /> : days.length ? days.map((day) => {
              const items = data!.expenses.filter((expense) => expense.spent_on === day)
              return <div key={day} className="border-t first:border-t-0">
                <div className="flex justify-between bg-stone-50/80 px-4 py-2 text-xs font-semibold text-muted-foreground"><span>{dayLabel(day, today)}</span><span className="tabular-nums">{money(items.reduce((sum, expense) => sum + expense.amount, 0))}</span></div>
                <ul className="divide-y">{items.map((expense) => {
                  const Icon = ICONS[expense.category] ?? Receipt
                  return <li key={expense.id} className="flex items-center gap-3 px-4 py-3">
                    <span className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${TONES[expense.category] ?? TONES.Other}`}><Icon className="size-5" /></span>
                    <div className="min-w-0 flex-1"><p className="font-medium">{expense.category}</p><p className="truncate text-xs text-muted-foreground">{expense.note || 'No note'}{expense.created_by_name ? ` · ${expense.created_by_name}` : ''}</p></div>
                    <span className="font-semibold tabular-nums">{money(expense.amount)}</span>
                    <Button variant="ghost" size="icon" aria-label={`Delete ${expense.category} expense of ${money(expense.amount)}`} onClick={() => { setDeleting(expense); action.setError(''); action.setSuccess('') }}><Trash2 className="size-4 text-rose-600" /></Button>
                  </li>
                })}</ul>
              </div>
            }) : <EmptyState illustration={ReceiptIllustration} title="No expenses this month">Add rent, bills and daily costs to see your real (net) profit.</EmptyState>}
          </CardContent>
        </Card>
      </div>

      <Dialog open={Boolean(deleting)} onOpenChange={(open) => { if (!open) setDeleting(null) }}><DialogContent>
        <DialogHeader><DialogTitle>Delete expense?</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">{deleting?.category} · {money(deleting?.amount ?? 0)}{deleting?.note ? ` · ${deleting.note}` : ''}</p>
        {action.error && <p role="alert" className="text-sm text-rose-600">{action.error}</p>}
        <DialogFooter><Button variant="outline" onClick={() => setDeleting(null)}>Cancel</Button><Button variant="destructive" disabled={action.busy} onClick={() => void remove()}>{action.busy ? 'Deleting…' : 'Delete expense'}</Button></DialogFooter>
      </DialogContent></Dialog>
    </section>
  )
}
