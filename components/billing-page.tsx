'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, Check, CreditCard, ExternalLink, FileText, Landmark, LoaderCircle, MessageCircle, Smartphone, Upload } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RocketIllustration } from '@/components/illustrations'
import { api, dateTime, errorMessage, Notice, shortDate, SkeletonRows, useApi } from '@/components/page-kit'
import { formatMoney, type Currency } from '@/lib/money'
import { PLANS, type BillingInterval, type CardPlanId, type Plan } from '@/lib/plans'
import { playSound } from '@/lib/sounds'

// The owner's view of their ShopOS subscription. Card plans (USD) are paid in Paddle's checkout and
// renew by themselves; the PKR plan is paid by transfer and recorded by the ShopOS team (admin panel).

type Proof = { id: string; url: string; content_type: string; note: string | null; created_at: string; reviewed_at: string | null }
type Subscription = {
  plan: string; plan_name: string; state: 'trialing' | 'active' | 'suspended' | 'expired'; price: number; currency: Currency; interval: BillingInterval
  current_period_end: string; days_left: number; provider: 'manual' | 'paddle'; cancel_at_period_end: boolean; past_due: boolean; needs_card: boolean
  payment_due: string | null
}
type CardInfo = {
  // false: card checkout is not open yet (SHOPOS_PADDLE_CHECKOUT=soon); "pay later" covers it.
  open: boolean
  environment: 'sandbox' | 'production'
  client_token: string
  available: Array<{ plan: CardPlanId; interval: BillingInterval }>
  subscription: { live: boolean; cancel_scheduled: boolean; plan: string; interval: BillingInterval } | null
}
type Billing = {
  shop: { id: string; name: string; subscription: Subscription }
  payments: Array<{ id: string; amount: number; currency: Currency; method: string; reference: string | null; months: number; period_end: string; created_at: string }>
  proofs: Proof[]
  payment_details: { bank_name: string; account_title: string; account_number: string; iban: string; wallet: string; whatsapp: string }
  plans: Plan[]
  card: CardInfo | null
  pay_later_days: number
}
type Checkout = { environment: 'sandbox' | 'production'; client_token: string; price_id: string; email: string; custom_data: Record<string, string> }

// --- Paddle.js (https://developer.paddle.com/paddlejs/overview) ---------------------------------

type PaddleEvent = { name?: string }
type PaddleJs = {
  Environment: { set: (environment: string) => void }
  Initialize: (options: { token: string; eventCallback?: (event: PaddleEvent) => void }) => void
  Checkout: { open: (options: Record<string, unknown>) => void }
}
declare global { interface Window { Paddle?: PaddleJs } }

const PADDLE_JS = 'https://cdn.paddle.com/paddle/v2/paddle.js'
let paddleReady: Promise<PaddleJs> | null = null
// Paddle.js takes one event callback, at Initialize; the page that opened the checkout listens here.
let onPaddleEvent: ((event: PaddleEvent) => void) | null = null
const listenToPaddle = (handler: ((event: PaddleEvent) => void) | null) => { onPaddleEvent = handler }

function loadPaddle(environment: string, token: string) {
  paddleReady ??= new Promise<PaddleJs>((resolve, reject) => {
    const ready = () => {
      const paddle = window.Paddle
      if (!paddle) return reject(new Error('The card payment window could not load.'))
      if (environment === 'sandbox') paddle.Environment.set('sandbox')
      paddle.Initialize({ token, eventCallback: (event) => onPaddleEvent?.(event) })
      resolve(paddle)
    }
    if (window.Paddle) return ready()
    const script = document.createElement('script')
    script.src = PADDLE_JS
    script.async = true
    script.onload = ready
    script.onerror = () => { paddleReady = null; reject(new Error('The card payment window could not load. Check your connection and try again.')) }
    document.head.appendChild(script)
  })
  return paddleReady
}

const per = (interval: BillingInterval) => (interval === 'year' ? 'year' : 'month')

// Upload a screenshot of the payment so the ShopOS team can match it and activate the shop.
function PaymentProofCard({ proofs, onSent }: { proofs: Proof[]; onSent: () => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)
  const [inputKey, setInputKey] = useState(0)

  async function send(event: React.FormEvent) {
    event.preventDefault()
    if (!file) return
    setBusy(true)
    setError('')
    setSent(false)
    try {
      const data = new FormData()
      data.append('file', file)
      data.append('note', note)
      const response = await fetch('/api/billing/proofs', { method: 'POST', body: data })
      const body = await response.json().catch(() => ({ error: 'Could not send the proof.' }))
      if (!response.ok) throw new Error(body.error ?? 'Could not send the proof.')
      playSound('success')
      setSent(true)
      setFile(null)
      setNote('')
      setInputKey((key) => key + 1)
      onSent()
    } catch (sendError) {
      playSound('error')
      setError(sendError instanceof Error ? sendError.message : 'Could not send the proof.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="mt-6 shopos-rise">
      <CardHeader><CardTitle className="text-base">Send payment proof</CardTitle><p className="text-xs text-muted-foreground">Upload the screenshot or receipt of your transfer. We check it and activate your plan.</p></CardHeader>
      <CardContent className="grid gap-6 lg:grid-cols-2">
        <form onSubmit={send} className="grid gap-3">
          <div><Label htmlFor="proof-file">Screenshot or PDF</Label><Input key={inputKey} id="proof-file" className="mt-1.5" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" required onChange={(event) => setFile(event.target.files?.[0] ?? null)} /><p className="mt-1 text-xs text-muted-foreground">JPG, PNG, WebP or PDF, up to 5 MB.</p></div>
          <div><Label htmlFor="proof-note">Note (optional)</Label><Input id="proof-note" className="mt-1.5" maxLength={300} value={note} onChange={(event) => setNote(event.target.value)} placeholder="e.g. 3 months via JazzCash, TID 12345" /></div>
          {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
          {sent && <p role="status" className="text-sm text-emerald-700">Proof sent. We will activate your plan once we confirm it.</p>}
          <Button type="submit" disabled={busy || !file} className="bg-emerald-600 hover:bg-emerald-700">{busy ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : <Upload className="mr-2 size-4" />}{busy ? 'Sending…' : 'Send proof'}</Button>
        </form>
        <div>
          <p className="text-sm font-semibold">Sent proofs</p>
          {proofs.length ? <ul className="mt-2 divide-y rounded-xl border">{proofs.map((proof) => <li key={proof.id} className="flex items-center gap-3 p-3 text-sm">
            <a href={proof.url} target="_blank" rel="noreferrer" className="shrink-0">{proof.content_type.startsWith('image/') ? <img src={proof.url} alt="Payment proof" className="size-12 rounded-lg border object-cover" /> : <span className="flex size-12 items-center justify-center rounded-lg border bg-stone-50"><FileText className="size-5 text-stone-500" /></span>}</a>
            <div className="min-w-0 flex-1"><p className="truncate">{proof.note || 'No note'}</p><p className="text-xs text-muted-foreground">{dateTime(proof.created_at)}</p></div>
            <Badge variant="secondary" className={proof.reviewed_at ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}>{proof.reviewed_at ? 'Confirmed' : 'Waiting'}</Badge>
          </li>)}</ul> : <p className="mt-2 text-sm text-muted-foreground">None yet.</p>}
        </div>
      </CardContent>
    </Card>
  )
}

const FEATURES = ['Fast counter sales with receipts', 'Stock, purchases and suppliers', 'Customer khata with WhatsApp reminders', 'Profit reports and CSV export', 'Staff accounts with roles', 'Works offline at the till']
const STATE_COPY = {
  trialing: { label: 'Free trial', tone: 'bg-amber-100 text-amber-800' },
  active: { label: 'Active', tone: 'bg-emerald-100 text-emerald-800' },
  suspended: { label: 'Suspended', tone: 'bg-rose-100 text-rose-800' },
  expired: { label: 'Expired', tone: 'bg-rose-100 text-rose-800' },
}
const METHOD_LABELS: Record<string, string> = { card: 'Card', bank: 'Bank transfer', jazzcash: 'JazzCash', easypaisa: 'EasyPaisa', cash: 'Cash', other: 'Other' }

// Card plans: pay in Paddle's checkout window, then switch plan, manage the card or undo a cancellation.
function CardPlans({ data, reload }: { data: Billing; reload: () => Promise<void> }) {
  const card = data.card!
  const sub = data.shop.subscription
  const current = card.subscription
  const [cycle, setCycle] = useState<BillingInterval>(current?.interval ?? 'month')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  // The plan whose card button was pressed while card checkout is not open yet.
  const [soonFor, setSoonFor] = useState<CardPlanId | null>(null)
  // After paying or changing plan, Paddle's webhook updates the shop within seconds: reload until it shows.
  const [waitingFor, setWaitingFor] = useState<null | ((billing: Billing) => boolean)>(null)

  useEffect(() => () => listenToPaddle(null), [])
  useEffect(() => {
    if (!waitingFor) return
    if (waitingFor(data)) {
      setWaitingFor(null)
      setNotice('Done. Your plan is updated.')
      playSound('success')
      return
    }
    // Each reload brings new data, which re-runs this effect; the timer only covers a webhook that is slow.
    const timer = window.setTimeout(() => void reload(), 3000)
    return () => window.clearTimeout(timer)
  }, [waitingFor, reload, data])
  // Give up waiting after a minute: the payment is safe, the page is just behind.
  useEffect(() => {
    if (!waitingFor) return
    const timer = window.setTimeout(() => {
      setWaitingFor(null)
      setNotice('Your payment went through. It can take a few minutes to show here; refresh the page in a moment.')
    }, 60_000)
    return () => window.clearTimeout(timer)
  }, [waitingFor])

  async function pay(plan: CardPlanId) {
    setError('')
    setNotice('')
    if (!card.open) { setSoonFor(plan); return }
    setBusy(plan)
    try {
      const checkout = await api<Checkout>('/api/billing/checkout', { method: 'POST', body: { plan, interval: cycle } })
      const paddle = await loadPaddle(checkout.environment, checkout.client_token)
      listenToPaddle((event) => {
        if (event.name !== 'checkout.completed') return
        setNotice('Payment received. Activating your plan…')
        setWaitingFor(() => (billing: Billing) => billing.shop.subscription.provider === 'paddle' && !billing.shop.subscription.needs_card && (billing.shop.subscription.state === 'active' || billing.shop.subscription.state === 'trialing') && Boolean(billing.card?.subscription?.live))
      })
      paddle.Checkout.open({
        items: [{ priceId: checkout.price_id, quantity: 1 }],
        customer: { email: checkout.email },
        customData: checkout.custom_data,
        settings: { displayMode: 'overlay', theme: 'light', allowLogout: false },
      })
    } catch (payError) {
      playSound('error')
      setError(errorMessage(payError, 'Could not open the card payment.'))
    } finally {
      setBusy('')
    }
  }

  // "Pay later": the plan starts now, payment is due in pay_later_days (by card or transfer).
  async function payLater(plan: CardPlanId) {
    const target = PLANS[plan]
    if (!window.confirm(`Start ${target.name} now (${formatMoney(target.prices[cycle] ?? 0, 'USD')}/${per(cycle)}) and pay within ${data.pay_later_days} days?`)) return
    setBusy(`later-${plan}`)
    setError('')
    setNotice('')
    try {
      const result = await api<{ payment_due: string }>('/api/billing/pay-later', { method: 'POST', body: { plan, interval: cycle } })
      setSoonFor(null)
      setNotice(`${target.name} is active. Payment is due by ${shortDate(result.payment_due)}.`)
      playSound('success')
      await reload()
    } catch (laterError) {
      playSound('error')
      setError(errorMessage(laterError, 'Could not start the plan.'))
    } finally {
      setBusy('')
    }
  }
  const canPayLater = !current?.live && !sub.payment_due && !sub.needs_card && sub.state !== 'suspended'

  async function change(plan: CardPlanId) {
    const target = PLANS[plan]
    if (!window.confirm(`Switch to ${target.name} (${formatMoney(target.prices[cycle] ?? 0, 'USD')}/${per(cycle)})? The difference is charged to your card now, pro rata.`)) return
    setBusy(plan)
    setError('')
    setNotice('')
    try {
      await api('/api/billing/change-plan', { method: 'POST', body: { action: 'change', plan, interval: cycle } })
      setNotice('Plan change sent. Updating…')
      setWaitingFor(() => (billing: Billing) => billing.shop.subscription.plan === plan && billing.shop.subscription.interval === cycle)
    } catch (changeError) {
      playSound('error')
      setError(errorMessage(changeError, 'Could not change the plan.'))
    } finally {
      setBusy('')
    }
  }

  async function resume() {
    setBusy('resume')
    setError('')
    try {
      await api('/api/billing/change-plan', { method: 'POST', body: { action: 'resume' } })
      setNotice('Your plan will keep renewing. Updating…')
      setWaitingFor(() => (billing: Billing) => !billing.shop.subscription.cancel_at_period_end)
    } catch (resumeError) {
      playSound('error')
      setError(errorMessage(resumeError, 'Could not resume the plan.'))
    } finally {
      setBusy('')
    }
  }

  // Portal links expire, so one is made per click. The tab is opened first, before the request,
  // so the browser does not treat it as an unwanted popup.
  async function portal(which: 'overview' | 'update_payment') {
    setBusy(which)
    setError('')
    const tab = window.open('', '_blank')
    try {
      const links = await api<{ overview: string; update_payment: string | null }>('/api/billing/portal', { method: 'POST' })
      const url = (which === 'update_payment' && links.update_payment) || links.overview
      if (tab) tab.location.href = url
      else window.location.assign(url)
    } catch (portalError) {
      tab?.close()
      playSound('error')
      setError(errorMessage(portalError, 'Could not open card billing.'))
    } finally {
      setBusy('')
    }
  }

  const available = (plan: CardPlanId) => card.available.some((item) => item.plan === plan && item.interval === cycle)
  const yearly = card.available.some((item) => item.interval === 'year')

  return (
    <Card className="mt-6 shopos-rise">
      <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle className="flex items-center gap-2 text-base"><CreditCard className="size-4 text-emerald-600" />Pay by card</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">Visa, Mastercard, Apple Pay, Google Pay and more, in US dollars. Renews automatically; cancel any time. Payments are handled by Paddle, our reseller.</p>
        </div>
        {yearly && <div role="group" aria-label="Billing period" className="flex shrink-0 rounded-xl border p-1 text-sm">
          {(['month', 'year'] as const).map((value) => <button key={value} type="button" aria-pressed={cycle === value} onClick={() => setCycle(value)} className={`rounded-lg px-3 py-1.5 font-medium ${cycle === value ? 'bg-emerald-600 text-white' : 'text-stone-600 hover:bg-stone-100'}`}>{value === 'month' ? 'Monthly' : 'Yearly · 2 months free'}</button>)}
        </div>}
      </CardHeader>
      <CardContent className="grid gap-4">
        {card.open && card.environment === 'sandbox' && <p className="rounded-xl border border-dashed border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">Test mode: no real money is taken. Use card 4242 4242 4242 4242, any future date, any CVC.</p>}
        {sub.cancel_at_period_end && current?.cancel_scheduled && <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <AlertTriangle className="size-4 shrink-0" /><span className="flex-1">Your card plan is cancelled. It stays active until {shortDate(sub.current_period_end)} and will not renew.</span>
          <Button size="sm" variant="outline" disabled={busy === 'resume'} onClick={() => void resume()}>{busy === 'resume' && <LoaderCircle className="mr-2 size-4 animate-spin" />}Keep my plan</Button>
        </div>}
        {sub.past_due && <div className="flex flex-wrap items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          <AlertTriangle className="size-4 shrink-0" /><span className="flex-1">Your last card payment did not go through. Paddle will try again; update your card to keep the shop running.</span>
          <Button size="sm" variant="outline" disabled={busy === 'update_payment'} onClick={() => void portal('update_payment')}>Update card</Button>
        </div>}
        {sub.payment_due && <div role="note" className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <AlertTriangle className="size-4 shrink-0" /><span className="flex-1">Payment due by {shortDate(sub.payment_due)}: {sub.plan_name}, {formatMoney(sub.price, sub.currency)} per {per(sub.interval)}. Pay by card{card.open ? '' : ' (opening soon)'} or by transfer below; unpaid, the shop turns read-only on that date.</span>
        </div>}
        {soonFor && <div role="note" className="flex flex-wrap items-center gap-3 rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
          <CreditCard className="size-4 shrink-0" /><span className="flex-1">Card payments open in a few days. {canPayLater ? `Choose "Pay later" to start ${PLANS[soonFor].name} now and pay within ${data.pay_later_days} days.` : 'You can also pay by transfer below.'}</span>
          {canPayLater && <Button size="sm" disabled={Boolean(busy)} onClick={() => void payLater(soonFor)}>{busy === `later-${soonFor}` && <LoaderCircle className="mr-2 size-4 animate-spin" />}Pay later</Button>}
        </div>}
        <div className="grid gap-4 md:grid-cols-2">
          {data.plans.filter((plan) => plan.id !== 'basic').map((plan) => {
            const id = plan.id as CardPlanId
            const price = plan.prices[cycle]
            const isCurrent = Boolean(current?.live) && current?.plan === id && current?.interval === cycle
            return <div key={id} className={`flex flex-col rounded-2xl border p-5 ${isCurrent ? 'border-emerald-500 ring-4 ring-emerald-500/10' : ''}`}>
              <div className="flex items-center justify-between gap-2"><p className="font-semibold">{plan.name}</p>{isCurrent && <Badge className="border-0 bg-emerald-100 text-emerald-800">Your plan</Badge>}{id === 'growth' && !isCurrent && <Badge variant="secondary">Most popular</Badge>}</div>
              <p className="mt-2 text-3xl font-bold">{price === undefined ? '—' : formatMoney(price, plan.currency)}<span className="text-sm font-normal text-muted-foreground">/{per(cycle)}</span></p>
              <p className="mt-2 flex-1 text-sm text-stone-600">{plan.summary}</p>
              {isCurrent
                ? <Button className="mt-4" variant="outline" disabled>Current plan</Button>
                : <Button className="mt-4 bg-emerald-600 hover:bg-emerald-700" disabled={!available(id) || Boolean(busy)} onClick={() => void (current?.live ? change(id) : pay(id))}>
                  {busy === id && <LoaderCircle className="mr-2 size-4 animate-spin" />}{!available(id) ? 'Not available yet' : current?.live ? `Switch to ${plan.name}` : sub.needs_card ? `Start free trial: ${plan.name}` : sub.state === 'trialing' ? `Start ${plan.name}` : `Pay for ${plan.name}`}
                </Button>}
              {!isCurrent && canPayLater && price !== undefined && <Button className="mt-2" variant="outline" disabled={Boolean(busy)} onClick={() => void payLater(id)}>{busy === `later-${id}` && <LoaderCircle className="mr-2 size-4 animate-spin" />}Pay later · {data.pay_later_days} days</Button>}
            </div>
          })}
        </div>
        {sub.needs_card && <p className="text-sm text-stone-700">Nothing is charged today. Your card is charged when the 14-day trial ends; cancel any time before that and you pay nothing.</p>}
        {sub.state === 'trialing' && !sub.needs_card && !current?.live && <p className="text-xs text-muted-foreground">Paying now starts your paid plan today; the trial ends when you pay.</p>}
        {current && <div className="flex flex-wrap gap-2 border-t pt-4">
          <Button variant="outline" disabled={busy === 'overview'} onClick={() => void portal('overview')}>{busy === 'overview' ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : <ExternalLink className="mr-2 size-4" />}Manage card, invoices or cancel</Button>
        </div>}
        {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
        {(notice || waitingFor) && <p role="status" className="flex items-center gap-2 text-sm text-emerald-700">{waitingFor && <LoaderCircle className="size-4 animate-spin" />}{notice}</p>}
      </CardContent>
    </Card>
  )
}

export default function BillingPage() {
  const billing = useApi<Billing>('/api/billing')
  const data = billing.data
  if (billing.error && !data) return <Notice tone="error">{billing.error}</Notice>
  if (!data) return <SkeletonRows rows={5} />
  const sub = data.shop.subscription
  const state = sub.needs_card ? { label: 'Card needed', tone: 'bg-amber-100 text-amber-800' } : STATE_COPY[sub.state]
  const details = data.payment_details
  const cardLive = Boolean(data.card?.subscription?.live)
  const message = `Assalam-o-Alaikum! Payment for ShopOS — shop "${data.shop.name}" (ID ${data.shop.id.slice(0, 8)}). Screenshot attached.`
  const renewing = sub.provider === 'paddle' && !sub.cancel_at_period_end
  const headline = sub.payment_due ? `Payment due by ${shortDate(sub.payment_due)}` : sub.needs_card ? 'Add a card to start your 14-day free trial' : sub.state === 'trialing' ? `${sub.days_left} day${sub.days_left === 1 ? '' : 's'} left in your free trial`
    : sub.state === 'active' ? (renewing ? `Renews on ${shortDate(sub.current_period_end)}` : `Paid until ${shortDate(sub.current_period_end)}`)
    : sub.state === 'suspended' ? 'Your shop is suspended' : 'Your subscription has ended'
  const pkrPrice = PLANS.basic.prices.month!

  return (
    <section>
      <div className="relative mb-6 overflow-hidden rounded-2xl text-white shopos-hero shopos-rise">
        <div className="absolute inset-0 shopos-dots" />
        <div className="relative flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:p-8">
          <div className="flex-1">
            <Badge className={`${state.tone} border-0`}>{state.label}</Badge>
            <h1 className="mt-3 text-3xl font-bold">Billing</h1>
            <p className="mt-1 text-lg text-emerald-50">{headline}</p>
            <p className="mt-1 text-sm text-emerald-100">{sub.needs_card ? 'Choose a plan below and add your card. Nothing is charged today; the shop opens as soon as the card is added.' : sub.state === 'expired' || sub.state === 'suspended' ? 'Your data is safe. The shop is read-only until the plan is renewed.' : `Current period ends ${shortDate(sub.current_period_end)}.`}</p>
          </div>
          <RocketIllustration className="hidden h-36 w-auto shopos-float sm:block" />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="shopos-rise">
          <CardHeader><CardTitle className="text-base">{sub.plan_name} plan</CardTitle></CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{formatMoney(sub.price, sub.currency)}<span className="text-sm font-normal text-muted-foreground">/{per(sub.interval)}</span></p>
            <ul className="mt-4 grid gap-2 text-sm text-stone-600">{FEATURES.map((feature) => <li key={feature} className="flex items-start gap-2"><Check className="mt-0.5 size-4 shrink-0 text-emerald-600" />{feature}</li>)}</ul>
          </CardContent>
        </Card>

        {cardLive ? <Card className="shopos-rise lg:col-span-2">
          <CardHeader><CardTitle className="text-base">Your card plan</CardTitle></CardHeader>
          <CardContent className="grid gap-2 text-sm text-stone-600">
            <p>{sub.plan_name}, {formatMoney(sub.price, sub.currency)} per {per(sub.interval)}. Next payment on {shortDate(sub.current_period_end)}.</p>
            <p>Receipts and invoices come by email from Paddle. Change your plan or card below.</p>
          </CardContent>
        </Card> : <Card className="shopos-rise lg:col-span-2">
          <CardHeader><CardTitle className="text-base">{data.card ? 'Or pay in rupees (PKR)' : 'How to pay'}</CardTitle><p className="text-xs text-muted-foreground">Send {formatMoney(pkrPrice, 'PKR')} per month (or several months at once) by bank transfer or mobile wallet, then share the receipt. We activate within 24 hours.</p></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            {details.account_number && <div className="rounded-xl border p-4 text-sm"><p className="mb-2 flex items-center gap-2 font-semibold"><Landmark className="size-4 text-emerald-600" />{details.bank_name || 'Bank transfer'}</p>{details.account_title && <p>{details.account_title}</p>}<p>Account: <span className="font-mono">{details.account_number}</span></p>{details.iban && <p>IBAN: <span className="font-mono">{details.iban}</span></p>}</div>}
            {details.wallet && <div className="rounded-xl border p-4 text-sm"><p className="mb-2 flex items-center gap-2 font-semibold"><Smartphone className="size-4 text-emerald-600" />JazzCash / EasyPaisa</p><p className="font-mono">{details.wallet}</p>{details.account_title && <p>{details.account_title}</p>}</div>}
            {details.whatsapp && <a href={`https://wa.me/${details.whatsapp.replace(/\D/g, '')}?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer" className="flex h-12 items-center justify-center gap-2 rounded-xl bg-emerald-600 font-semibold text-white transition hover:bg-emerald-700 sm:col-span-2"><MessageCircle className="size-5" />Send payment screenshot on WhatsApp</a>}
            {!details.account_number && !details.wallet && !details.whatsapp && <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground sm:col-span-2">Payment details are being set up. Once you have paid, send the receipt below and we will activate your plan.</p>}
          </CardContent>
        </Card>}
      </div>

      {data.card && <CardPlans data={data} reload={billing.reload} />}

      {!cardLive && <PaymentProofCard proofs={data.proofs} onSent={() => void billing.reload()} />}

      <Card className="mt-6 shopos-rise">
        <CardHeader><CardTitle className="text-base">Payment history</CardTitle></CardHeader>
        <CardContent className="p-0">
          {data.payments.length ? <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-sm">
            <thead><tr className="border-b text-left text-muted-foreground"><th className="p-4">Date</th><th className="p-4">Amount</th><th className="p-4">Method</th><th className="p-4">Months</th><th className="p-4">Paid until</th></tr></thead>
            <tbody>{data.payments.map((payment) => <tr key={payment.id} className="border-b last:border-0"><td className="p-4">{shortDate(payment.created_at)}</td><td className="p-4 font-semibold">{formatMoney(payment.amount, payment.currency)}</td><td className="p-4">{METHOD_LABELS[payment.method] ?? payment.method}{payment.reference && <span className="block text-xs text-muted-foreground">{payment.reference}</span>}</td><td className="p-4">{payment.months || 'Plan change'}</td><td className="p-4">{shortDate(payment.period_end)}</td></tr>)}</tbody>
          </table></div> : <p className="p-8 text-center text-sm text-muted-foreground">No payments yet.</p>}
        </CardContent>
      </Card>
    </section>
  )
}
