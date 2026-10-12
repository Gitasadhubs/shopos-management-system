'use client'

import { Check, Landmark, MessageCircle, Smartphone } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { RocketIllustration } from '@/components/illustrations'
import { money, Notice, shortDate, SkeletonRows, useApi } from '@/components/page-kit'

// The owner's view of their ShopOS subscription. Payments are recorded by the ShopOS team (admin panel).

type Billing = {
  shop: { id: string; name: string; subscription: { plan: string; state: 'trialing' | 'active' | 'suspended' | 'expired'; price_pkr: number; current_period_end: string; days_left: number } }
  payments: Array<{ id: string; amount: number; method: string; reference: string | null; months: number; period_end: string; created_at: string }>
  payment_details: { bank_name: string; account_title: string; account_number: string; iban: string; wallet: string; whatsapp: string }
}

const FEATURES = ['Fast counter sales with receipts', 'Stock, purchases and suppliers', 'Customer khata with WhatsApp reminders', 'Profit reports and CSV export', 'Staff accounts with roles', 'Works offline at the till']
const STATE_COPY = {
  trialing: { label: 'Free trial', tone: 'bg-amber-100 text-amber-800' },
  active: { label: 'Active', tone: 'bg-emerald-100 text-emerald-800' },
  suspended: { label: 'Suspended', tone: 'bg-rose-100 text-rose-800' },
  expired: { label: 'Expired', tone: 'bg-rose-100 text-rose-800' },
}

export default function BillingPage() {
  const billing = useApi<Billing>('/api/billing')
  const data = billing.data
  if (billing.error) return <Notice tone="error">{billing.error}</Notice>
  if (!data) return <SkeletonRows rows={5} />
  const sub = data.shop.subscription
  const state = STATE_COPY[sub.state]
  const details = data.payment_details
  const message = `Assalam-o-Alaikum! Payment for ShopOS — shop "${data.shop.name}" (ID ${data.shop.id.slice(0, 8)}). Screenshot attached.`
  const headline = sub.state === 'trialing' ? `${sub.days_left} day${sub.days_left === 1 ? '' : 's'} left in your free trial` : sub.state === 'active' ? `Paid until ${shortDate(sub.current_period_end)}` : sub.state === 'suspended' ? 'Your shop is suspended' : 'Your subscription has ended'

  return (
    <section>
      <div className="relative mb-6 overflow-hidden rounded-2xl text-white shopos-hero shopos-rise">
        <div className="absolute inset-0 shopos-dots" />
        <div className="relative flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:p-8">
          <div className="flex-1">
            <Badge className={`${state.tone} border-0`}>{state.label}</Badge>
            <h1 className="mt-3 text-3xl font-bold">Billing</h1>
            <p className="mt-1 text-lg text-emerald-50">{headline}</p>
            <p className="mt-1 text-sm text-emerald-100">{sub.state === 'expired' || sub.state === 'suspended' ? 'Your data is safe. The shop is read-only until the plan is renewed.' : `Current period ends ${shortDate(sub.current_period_end)}.`}</p>
          </div>
          <RocketIllustration className="hidden h-36 w-auto shopos-float sm:block" />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="shopos-rise">
          <CardHeader><CardTitle className="text-base capitalize">{sub.plan} plan</CardTitle></CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{money(sub.price_pkr)}<span className="text-sm font-normal text-muted-foreground">/month</span></p>
            <ul className="mt-4 grid gap-2 text-sm text-stone-600">{FEATURES.map((feature) => <li key={feature} className="flex items-start gap-2"><Check className="mt-0.5 size-4 shrink-0 text-emerald-600" />{feature}</li>)}</ul>
          </CardContent>
        </Card>

        <Card className="shopos-rise lg:col-span-2">
          <CardHeader><CardTitle className="text-base">How to pay</CardTitle><p className="text-xs text-muted-foreground">Send {money(sub.price_pkr)} per month (or several months at once), then share the receipt. We activate within 24 hours.</p></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            {details.account_number && <div className="rounded-xl border p-4 text-sm"><p className="mb-2 flex items-center gap-2 font-semibold"><Landmark className="size-4 text-emerald-600" />{details.bank_name || 'Bank transfer'}</p>{details.account_title && <p>{details.account_title}</p>}<p>Account: <span className="font-mono">{details.account_number}</span></p>{details.iban && <p>IBAN: <span className="font-mono">{details.iban}</span></p>}</div>}
            {details.wallet && <div className="rounded-xl border p-4 text-sm"><p className="mb-2 flex items-center gap-2 font-semibold"><Smartphone className="size-4 text-emerald-600" />JazzCash / EasyPaisa</p><p className="font-mono">{details.wallet}</p>{details.account_title && <p>{details.account_title}</p>}</div>}
            {details.whatsapp && <a href={`https://wa.me/${details.whatsapp.replace(/\D/g, '')}?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer" className="flex h-12 items-center justify-center gap-2 rounded-xl bg-emerald-600 font-semibold text-white transition hover:bg-emerald-700 sm:col-span-2"><MessageCircle className="size-5" />Send payment screenshot on WhatsApp</a>}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6 shopos-rise">
        <CardHeader><CardTitle className="text-base">Payment history</CardTitle></CardHeader>
        <CardContent className="p-0">
          {data.payments.length ? <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-sm">
            <thead><tr className="border-b text-left text-muted-foreground"><th className="p-4">Date</th><th className="p-4">Amount</th><th className="p-4">Method</th><th className="p-4">Months</th><th className="p-4">Paid until</th></tr></thead>
            <tbody>{data.payments.map((payment) => <tr key={payment.id} className="border-b last:border-0"><td className="p-4">{shortDate(payment.created_at)}</td><td className="p-4 font-semibold">{money(payment.amount)}</td><td className="p-4 capitalize">{payment.method}{payment.reference && <span className="block text-xs text-muted-foreground">{payment.reference}</span>}</td><td className="p-4">{payment.months}</td><td className="p-4">{shortDate(payment.period_end)}</td></tr>)}</tbody>
          </table></div> : <p className="p-8 text-center text-sm text-muted-foreground">No payments yet.</p>}
        </CardContent>
      </Card>
    </section>
  )
}
