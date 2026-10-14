'use client'

import { useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, ArrowDownRight, ArrowUpRight, CheckCheck, ChevronLeft, ChevronRight, Mail, MessageCircle, Printer, Send, Settings, Trophy, Vault } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/components/auth/auth-provider'
import { CelebrateIllustration } from '@/components/illustrations'
import { api, dateTime, money, Notice, SkeletonRows, useAction, useApi, useCountUp } from '@/components/page-kit'
import { addDays, dayKey, DEFAULT_TIMEZONE } from '@/lib/time'

// The closing report for one day: what was sold, earned and spent, and what should be in the drawer.

type DayEnd = {
  day: string
  sales: { revenue: number; count: number; average: number; discounts: number; cogs: number }
  returns: { total: number; count: number; cash: number }
  vsYesterday: number | null
  methods: { cash: number; card: number; credit: number }
  grossProfit: number
  expenses: { total: number; expenses: Array<{ id: string; category: string; amount: number; note: string | null }> }
  netProfit: number
  khata: { given: number; received: number }
  suppliers: { purchases: number; purchaseCount: number; paid: number }
  cash: { in: number; out: number; expected: number }
  topItems: Array<{ name: string; quantity: number; revenue: number }>
  lowStock: number
}
type Response = {
  report: DayEnd
  text: string
  today: string
  delivery: { enabled: boolean; time: string; email: string | null; whatsapp: string | null; whatsapp_api: boolean; last_sent_on: string | null }
  deliveries: Array<{ id: string; day: string; channel: string; recipient: string; status: string; error: string | null; created_at: string }>
}

const METHOD_STYLE = { cash: 'from-emerald-400 to-emerald-600', card: 'from-sky-400 to-sky-600', credit: 'from-amber-400 to-amber-600' } as const
const METHOD_LABEL = { cash: 'Cash', card: 'Card', credit: 'Khata (credit)' } as const

function BigMoney({ value }: { value: number }) {
  const shown = useCountUp(value, 900)
  return <>{money(Math.round(shown * 100) / 100)}</>
}

// WhatsApp-style chat bubble; *bold* in the text is shown bold, as WhatsApp would.
function WhatsAppPreview({ text }: { text: string }) {
  return (
    <div className="rounded-2xl bg-[#e5ddd5] p-4" style={{ backgroundImage: 'radial-gradient(rgba(0,0,0,0.04) 1px, transparent 1px)', backgroundSize: '10px 10px' }}>
      <div className="relative ml-auto max-w-sm rounded-xl rounded-tr-sm bg-[#dcf8c6] px-3 py-2 text-[13px] leading-relaxed text-stone-900 shadow-sm">
        {text.split('\n').map((line, index) => <p key={index} className="min-h-[1em] whitespace-pre-wrap">{line.split(/(\*[^*]+\*)/).map((part, partIndex) => part.startsWith('*') && part.endsWith('*') ? <strong key={partIndex}>{part.slice(1, -1)}</strong> : part)}</p>)}
        <p className="mt-1 flex items-center justify-end gap-1 text-[10px] text-stone-500">{new Date().toLocaleTimeString('en-PK', { hour: 'numeric', minute: '2-digit' })}<CheckCheck className="size-3.5 text-sky-500" /></p>
      </div>
    </div>
  )
}

export default function DayEndPage() {
  const { shop, role } = useAuth()
  const today = dayKey(shop?.timezone ?? DEFAULT_TIMEZONE)
  const [day, setDay] = useState(today)
  const [counted, setCounted] = useState('')
  const result = useApi<Response>(`/api/day-end?day=${day}`)
  const action = useAction()
  const data = result.data
  const report = data?.report
  const difference = report && counted !== '' ? Math.round((Number(counted) - report.cash.expected) * 100) / 100 : null
  const methodMax = report ? Math.max(1, report.methods.cash, report.methods.card, report.methods.credit) : 1

  async function sendNow() {
    const ok = await action.run(async () => {
      const sent = await api<{ deliveries: Array<{ channel: string; recipient: string; status: string; error?: string }> }>('/api/day-end/send', { method: 'POST', body: { day } })
      const good = sent.deliveries.filter((delivery) => delivery.status === 'sent')
      const problems = sent.deliveries.filter((delivery) => delivery.status !== 'sent')
      if (!good.length) throw new Error(problems.map((delivery) => `${delivery.channel} to ${delivery.recipient}: ${delivery.error}`).join(' '))
      return `Report sent to ${good.map((delivery) => delivery.recipient).join(', ')}.${problems.length ? ` Not sent: ${problems.map((delivery) => `${delivery.recipient} (${delivery.error})`).join('; ')}` : ''}`
    }, 'success')
    if (ok) await result.reload()
  }

  return (
    <section>
      <div className="mb-6 flex flex-col justify-between gap-4 shopos-rise lg:flex-row lg:items-center">
        <div><h1 className="text-3xl font-bold tracking-tight text-stone-900">Day end</h1><p className="mt-1 text-sm text-muted-foreground">Close the day: sales, profit, expenses and cash in the drawer.</p></div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="icon" aria-label="Previous day" onClick={() => setDay(addDays(day, -1))}><ChevronLeft className="size-4" /></Button>
          <Input aria-label="Day" type="date" max={today} value={day} onChange={(event) => event.target.value && setDay(event.target.value)} className="w-40 bg-white" />
          <Button variant="outline" size="icon" aria-label="Next day" disabled={day >= today} onClick={() => setDay(addDays(day, 1))}><ChevronRight className="size-4" /></Button>
          {day !== today && <Button variant="ghost" onClick={() => setDay(today)}>Today</Button>}
        </div>
      </div>

      {action.success && <Notice tone="success">{action.success}</Notice>}
      {(result.error || action.error) && <Notice tone="error">{result.error || action.error}</Notice>}

      {!report ? <SkeletonRows rows={6} /> : <>
        <div className="relative mb-6 overflow-hidden rounded-2xl text-white shadow-lg shopos-hero shopos-rise">
          <div className="absolute inset-0 shopos-dots" />
          <div className="relative grid gap-6 p-6 sm:p-8 lg:grid-cols-[1fr_auto]">
            <div>
              <p className="text-sm font-medium text-emerald-100">{new Date(`${day}T12:00:00Z`).toLocaleDateString('en-PK', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })}</p>
              <p className="mt-3 text-sm text-emerald-100">Net profit</p>
              <p className="text-4xl font-bold tabular-nums sm:text-5xl" aria-label={`Net profit ${money(report.netProfit)}`}><BigMoney value={report.netProfit} /></p>
              <div className="mt-4 flex flex-wrap gap-2 text-sm">
                <span className="rounded-full bg-white/15 px-3 py-1">Sales {money(report.sales.revenue)}</span>
                <span className="rounded-full bg-white/15 px-3 py-1">Gross profit {money(report.grossProfit)}</span>
                <span className="rounded-full bg-white/15 px-3 py-1">Expenses {money(report.expenses.total)}</span>
                {report.vsYesterday !== null && <span className={`flex items-center gap-1 rounded-full px-3 py-1 font-semibold ${report.vsYesterday >= 0 ? 'bg-white text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>{report.vsYesterday >= 0 ? <ArrowUpRight className="size-4" /> : <ArrowDownRight className="size-4" />}{Math.abs(report.vsYesterday)}% vs previous day</span>}
              </div>
            </div>
            <CelebrateIllustration className="hidden h-36 w-auto shopos-float lg:block" />
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-3">
          <Card className="shopos-rise">
            <CardHeader><CardTitle className="text-base">Sales ({report.sales.count})</CardTitle><p className="text-xs text-muted-foreground">Average sale {money(report.sales.average)} · discounts {money(report.sales.discounts)}</p></CardHeader>
            <CardContent className="grid gap-4">
              {(['cash', 'card', 'credit'] as const).map((method) => <div key={method}>
                <div className="mb-1.5 flex justify-between text-sm"><span>{METHOD_LABEL[method]}</span><span className="font-semibold tabular-nums">{money(report.methods[method])}</span></div>
                <div className="h-2.5 overflow-hidden rounded-full bg-stone-100"><div className={`h-full rounded-full bg-gradient-to-r transition-all duration-700 ${METHOD_STYLE[method]}`} style={{ width: `${(report.methods[method] / methodMax) * 100}%` }} /></div>
              </div>)}
              <div className="grid grid-cols-2 gap-3 border-t pt-4 text-sm">
                <div><p className="text-xs text-muted-foreground">Khata given</p><p className="font-semibold tabular-nums text-amber-700">{money(report.khata.given)}</p></div>
                <div><p className="text-xs text-muted-foreground">Khata received</p><p className="font-semibold tabular-nums text-emerald-700">{money(report.khata.received)}</p></div>
              </div>
              {report.returns.count > 0 && <Link href="/sales" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800 hover:bg-rose-100">{report.returns.count} return{report.returns.count === 1 ? '' : 's'} · {money(report.returns.total)} refunded (already taken off the figures above)</Link>}
            </CardContent>
          </Card>

          <Card className="shopos-rise">
            <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Vault className="size-4 text-emerald-600" />Cash drawer</CardTitle><p className="text-xs text-muted-foreground">Assumes everything except card payments was cash.</p></CardHeader>
            <CardContent className="grid gap-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Cash in (sales + khata received)</span><span className="tabular-nums">{money(report.cash.in)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Cash out (expenses + suppliers{report.returns.cash ? ' + refunds' : ''})</span><span className="tabular-nums">−{money(report.cash.out)}</span></div>
              <div className="flex justify-between border-t pt-2 text-base font-bold"><span>Expected in drawer</span><span className="tabular-nums">{money(report.cash.expected)}</span></div>
              <div className="mt-2"><Label htmlFor="cash-counted" className="text-xs">Cash you counted (optional)</Label><Input id="cash-counted" type="number" min="0" step="1" className="mt-1" placeholder={String(report.cash.expected)} value={counted} onChange={(event) => setCounted(event.target.value)} /></div>
              {difference !== null && <p role="note" className={`rounded-lg px-3 py-2 font-semibold shopos-pop ${difference === 0 ? 'bg-emerald-50 text-emerald-800' : difference > 0 ? 'bg-sky-50 text-sky-800' : 'bg-rose-50 text-rose-700'}`}>{difference === 0 ? 'Drawer matches exactly. 👍' : difference > 0 ? `Over by ${money(difference)}` : `Short by ${money(-difference)}`}</p>}
            </CardContent>
          </Card>

          <Card className="shopos-rise">
            <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Trophy className="size-4 text-amber-500" />Top items</CardTitle></CardHeader>
            <CardContent>
              {report.topItems.length ? <ol className="grid gap-3">{report.topItems.map((item, index) => <li key={item.name} className="flex items-center gap-3 text-sm"><span className={`flex size-7 items-center justify-center rounded-full text-xs font-bold ${index === 0 ? 'bg-amber-400 text-white' : 'bg-stone-100 text-stone-600'}`}>{index + 1}</span><span className="flex-1 truncate font-medium">{item.name}</span><span className="text-xs text-muted-foreground">×{item.quantity}</span><span className="w-20 text-right font-semibold tabular-nums">{money(item.revenue)}</span></li>)}</ol> : <p className="py-6 text-center text-sm text-muted-foreground">Nothing sold on this day.</p>}
              {report.lowStock > 0 && <Link href="/inventory" className="mt-4 flex items-center gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 hover:bg-amber-100"><AlertTriangle className="size-4" />{report.lowStock} product{report.lowStock === 1 ? ' is' : 's are'} low on stock</Link>}
            </CardContent>
          </Card>
        </div>

        <div className="mt-6 grid gap-6 xl:grid-cols-[1.2fr_1fr]">
          <Card className="shopos-rise">
            <CardHeader><CardTitle className="flex items-center gap-2 text-base"><MessageCircle className="size-4 text-emerald-600" />Share the report</CardTitle><p className="text-xs text-muted-foreground">This is what goes out on WhatsApp.</p></CardHeader>
            <CardContent className="grid gap-4">
              <WhatsAppPreview text={data.text} />
              <div className="flex flex-wrap gap-2">
                <a href={`https://wa.me/?text=${encodeURIComponent(data.text)}`} target="_blank" rel="noreferrer" className="inline-flex h-12 items-center gap-2 rounded-lg bg-[#25d366] px-4 font-semibold text-white shadow-sm transition hover:bg-[#1fb957]"><MessageCircle className="size-5" />Share on WhatsApp</a>
                <Button variant="outline" className="h-12" disabled={action.busy} onClick={() => void sendNow()}><Send className="mr-2 size-4" />{action.busy ? 'Sending…' : 'Send now'}</Button>
                <Button variant="outline" className="h-12" onClick={() => window.print()}><Printer className="mr-2 size-4" />Print</Button>
              </div>
            </CardContent>
          </Card>

          <Card className="shopos-rise">
            <CardHeader><CardTitle className="text-base">Automatic report</CardTitle></CardHeader>
            <CardContent className="grid gap-3 text-sm">
              {data.delivery.enabled
                ? <p className="rounded-lg bg-emerald-50 p-3 text-emerald-800">On: sent every day at <strong>{data.delivery.time}</strong>{data.delivery.email ? <> to <strong>{data.delivery.email}</strong></> : ' to the owner’s email'}{data.delivery.whatsapp ? <> and WhatsApp <strong>{data.delivery.whatsapp}</strong></> : ''}.</p>
                : <p className="rounded-lg bg-stone-50 p-3 text-stone-700">Off. Turn it on to get this report every evening by email{data.delivery.whatsapp_api ? ' and WhatsApp' : ''}.</p>}
              {!data.delivery.whatsapp_api && <p className="text-xs text-muted-foreground">Automatic WhatsApp sending needs a WhatsApp Business account connected by the ShopOS team. Until then, use “Share on WhatsApp”.</p>}
              {role?.role === 'owner' && <Link href="/settings#day-end" className="inline-flex items-center gap-2 font-semibold text-emerald-700"><Settings className="size-4" />Day-end report settings</Link>}
              {data.deliveries.length > 0 && <ul className="mt-2 divide-y rounded-xl border">{data.deliveries.map((delivery) => <li key={delivery.id} className="flex items-start gap-3 p-3">
                {delivery.channel === 'email' ? <Mail className="mt-0.5 size-4 text-stone-500" /> : <MessageCircle className="mt-0.5 size-4 text-emerald-600" />}
                <div className="min-w-0 flex-1"><p className="truncate font-medium">{delivery.recipient}</p><p className="text-xs text-muted-foreground">{dateTime(delivery.created_at)} · report for {delivery.day}{delivery.error ? ` · ${delivery.error}` : ''}</p></div>
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${delivery.status === 'sent' ? 'bg-emerald-100 text-emerald-800' : delivery.status === 'skipped' ? 'bg-stone-100 text-stone-600' : 'bg-rose-100 text-rose-700'}`}>{delivery.status}</span>
              </li>)}</ul>}
            </CardContent>
          </Card>
        </div>

        {report.expenses.expenses.length > 0 && <Card className="mt-6 shopos-rise">
          <CardHeader className="flex flex-row items-center justify-between"><CardTitle className="text-base">Expenses</CardTitle><Link href="/expenses" className="text-sm font-medium text-emerald-700">Manage</Link></CardHeader>
          <CardContent><ul className="divide-y">{report.expenses.expenses.map((expense) => <li key={expense.id} className="flex justify-between py-2 text-sm"><span>{expense.category}{expense.note ? <span className="text-muted-foreground"> · {expense.note}</span> : null}</span><span className="font-semibold tabular-nums">{money(expense.amount)}</span></li>)}</ul></CardContent>
        </Card>}
      </>}
    </section>
  )
}
