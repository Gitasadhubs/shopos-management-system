import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, Ban, CalendarPlus, CreditCard, History, ImageIcon, PlayCircle, Receipt, Tag, TimerOff, Users } from 'lucide-react'
import { PaymentProofList } from '@/components/payment-proofs'
import { formatDate, formatDateTime, pkr, planPrice, requirePlatformAdmin, STATE_STYLES } from '@/lib/admin'
import { listBillingEvents } from '@/lib/local-billing'
import { getShopForAdmin } from '@/lib/local-platform'
import { formatMoney } from '@/lib/money'
import { PLANS } from '@/lib/plans'
import { changeSubscriptionAction, recordPaymentAction } from '../../actions'

export const dynamic = 'force-dynamic'

const input = 'mt-1.5 h-10 w-full rounded-lg border border-stone-200 bg-white px-3 text-sm outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10'
const EVENT_LABELS: Record<string, string> = {
  trial_started: 'Trial started', payment: 'Payment recorded', extended: 'Days added', suspended: 'Suspended', resumed: 'Resumed', expired: 'Ended', price_changed: 'Plan changed',
  proof_sent: 'Payment proof sent', card_cancelled: 'Card plan cancelled', card_resumed: 'Card plan resumed', card_past_due: 'Card payment failed',
}

export default async function ShopDetail({ params, searchParams }: { params: Promise<{ shopId: string }>; searchParams: Promise<{ notice?: string; error?: string }> }) {
  await requirePlatformAdmin()
  const { shopId } = await params
  if (!/^[0-9a-f-]{36}$/i.test(shopId)) notFound()
  const detail = await getShopForAdmin(shopId)
  if (!detail) notFound()
  const { notice, error } = await searchParams
  const { shop, usage, users, payments, proofs, events } = detail
  const waiting = proofs.filter((proof) => !proof.reviewed_at).length
  const sub = shop.subscription
  // A renewing card subscription's plan and price come from Paddle; only transfers set them here.
  const cardRenewing = sub.provider === 'paddle' && !sub.cancel_at_period_end
  const billingEvents = sub.provider === 'paddle' ? await listBillingEvents(shop.id) : []

  return (
    <section className="p-5 sm:p-8">
      <Link href="/admin/shops" className="inline-flex items-center gap-2 text-sm font-medium text-emerald-700"><ArrowLeft className="size-4" />All shops</Link>
      <div className="mt-4 flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div>
          <h1 className="text-3xl font-bold">{shop.name}</h1>
          <p className="mt-1 text-sm text-stone-500">{[shop.phone, shop.address].filter(Boolean).join(' · ') || 'No contact details'} · joined {formatDate(shop.created_at)} · ID {shop.id.slice(0, 8)}</p>
        </div>
        <div className="rounded-2xl border border-stone-200 bg-white p-4 text-right shadow-sm">
          <span className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ${STATE_STYLES[sub.state]}`}>{sub.state}</span>
          <p className="mt-2 text-sm text-stone-500">{sub.state === 'suspended' ? 'Period would end' : sub.state === 'expired' ? 'Ended' : 'Period ends'} {formatDate(sub.current_period_end)}</p>
          <p className="text-sm font-semibold">{sub.plan_name} · {planPrice(sub)}</p>
          <p className="text-xs text-stone-500">{sub.provider === 'paddle' ? `Card (Paddle)${sub.cancel_at_period_end ? ', not renewing' : ', renews by itself'}${sub.past_due ? ', payment failed' : ''}` : 'Pays by transfer'}</p>
        </div>
      </div>

      {notice && <p role="status" className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 shopos-rise">{notice}</p>}
      {error && <p role="alert" className="mt-6 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 shopos-rise">{error}</p>}

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {[['Products', usage.products], ['Customers', usage.customers], ['Sales (all time)', usage.sales], ['Revenue (30 days)', pkr(usage.revenue_30d)], ['Last sale', usage.last_sale_at ? formatDate(usage.last_sale_at) : 'None']].map(([label, value]) => <div key={String(label)} className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm"><p className="text-xs text-stone-500">{label}</p><p className="mt-1 text-xl font-bold tabular-nums">{value}</p></div>)}
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <form action={recordPaymentAction} className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
          <h2 className="flex items-center gap-2 font-bold"><Receipt className="size-4 text-emerald-600" />Record a payment</h2>
          <p className="mt-1 text-xs text-stone-500">Adds the months on top of any time already paid, and makes the shop active.</p>
          <input type="hidden" name="shop_id" value={shop.id} />
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-medium">Amount received<input name="amount" type="number" min="1" step="0.01" required defaultValue={sub.currency === 'PKR' ? sub.price : PLANS.basic.prices.month} className={input} /></label>
            <label className="text-sm font-medium">Currency<select name="currency" aria-label="Currency" defaultValue="PKR" className={input}><option value="PKR">PKR (₨)</option><option value="USD">USD ($)</option></select></label>
            <label className="text-sm font-medium">Months<input name="months" type="number" min="1" max="24" required defaultValue={1} className={input} /></label>
            <label className="text-sm font-medium">Method<select name="method" defaultValue="bank" className={input}><option value="bank">Bank transfer</option><option value="jazzcash">JazzCash</option><option value="easypaisa">EasyPaisa</option><option value="cash">Cash</option><option value="other">Other</option></select></label>
            <label className="text-sm font-medium">Reference<input name="reference" maxLength={120} placeholder="Transaction ID" className={input} /></label>
          </div>
          <button className="mt-4 h-11 w-full rounded-xl bg-emerald-600 font-semibold text-white hover:bg-emerald-700">Record payment</button>
        </form>

        <div className="grid gap-4 rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
          <h2 className="font-bold">Subscription controls</h2>
          <form action={changeSubscriptionAction} className="flex items-end gap-2">
            <input type="hidden" name="shop_id" value={shop.id} /><input type="hidden" name="action" value="add_days" />
            <label className="flex-1 text-sm font-medium">Free days to add<input name="days" type="number" min="1" max="365" required defaultValue={7} className={input} /></label>
            <button className="flex h-10 items-center gap-2 rounded-lg bg-stone-900 px-4 text-sm font-semibold text-white hover:bg-stone-800"><CalendarPlus className="size-4" />Add days</button>
          </form>
          {cardRenewing
            ? <p className="rounded-lg bg-sky-50 p-3 text-xs text-sky-900">Plan and price follow the shop&apos;s card subscription in Paddle. The owner changes them from Billing.</p>
            : <form action={changeSubscriptionAction} className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
              <input type="hidden" name="shop_id" value={shop.id} /><input type="hidden" name="action" value="set_plan" />
              <label className="text-sm font-medium">Plan<select name="plan" aria-label="Plan" defaultValue={sub.plan in PLANS ? sub.plan : 'basic'} className={input}>{Object.values(PLANS).map((plan) => <option key={plan.id} value={plan.id}>{plan.name} ({plan.currency})</option>)}</select></label>
              <label className="text-sm font-medium">Per<select name="interval" aria-label="Per" defaultValue={sub.interval} className={input}><option value="month">Month</option><option value="year">Year</option></select></label>
              <label className="text-sm font-medium">Price<input name="price" type="number" min="0" step="0.01" required defaultValue={sub.price} className={input} /></label>
              <button className="flex h-10 items-center justify-center gap-2 rounded-lg border border-stone-200 px-4 text-sm font-semibold hover:bg-stone-50"><Tag className="size-4" />Save plan</button>
            </form>}
          <div className="flex flex-wrap gap-2 border-t pt-4">
            {sub.state === 'suspended'
              ? <form action={changeSubscriptionAction}><input type="hidden" name="shop_id" value={shop.id} /><input type="hidden" name="action" value="resume" /><button className="flex h-10 items-center gap-2 rounded-lg bg-emerald-50 px-4 text-sm font-semibold text-emerald-800 hover:bg-emerald-100"><PlayCircle className="size-4" />Resume shop</button></form>
              : <form action={changeSubscriptionAction}><input type="hidden" name="shop_id" value={shop.id} /><input type="hidden" name="action" value="suspend" /><button className="flex h-10 items-center gap-2 rounded-lg bg-rose-50 px-4 text-sm font-semibold text-rose-700 hover:bg-rose-100"><Ban className="size-4" />Suspend shop</button></form>}
            {sub.state !== 'expired' && <form action={changeSubscriptionAction}><input type="hidden" name="shop_id" value={shop.id} /><input type="hidden" name="action" value="expire" /><button className="flex h-10 items-center gap-2 rounded-lg border border-stone-200 px-4 text-sm font-semibold text-stone-700 hover:bg-stone-50"><TimerOff className="size-4" />End subscription now</button></form>}
          </div>
          <p className="text-xs text-stone-500">Suspended or ended shops can still sign in and see their data, but cannot make changes.</p>
        </div>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <div className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
          <h2 className="flex items-center gap-2 border-b px-5 py-4 font-bold"><Users className="size-4 text-emerald-600" />People ({users.length})</h2>
          <ul className="divide-y">{users.map((user) => <li key={user.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
            <div><p className="font-medium">{user.full_name}{!user.is_active && <span className="ml-2 rounded bg-stone-100 px-1.5 text-xs text-stone-500">disabled</span>}{!user.email_verified && <span className="ml-2 rounded bg-amber-100 px-1.5 text-xs text-amber-800">unconfirmed</span>}</p><p className="text-xs text-stone-500">{user.email}</p></div>
            <div className="text-right"><p className="capitalize">{user.role}</p><p className="text-xs text-stone-400">{user.last_login_at ? `seen ${formatDate(user.last_login_at)}` : 'never signed in'}</p></div>
          </li>)}</ul>
        </div>

        <div className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
          <h2 className="flex items-center gap-2 border-b px-5 py-4 font-bold"><Receipt className="size-4 text-emerald-600" />Payments ({payments.length})</h2>
          {payments.length ? <ul className="divide-y">{payments.map((payment) => <li key={payment.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
            <div><p className="font-semibold">{formatMoney(payment.amount, payment.currency)} <span className="font-normal capitalize text-stone-500">· {payment.method}</span></p><p className="text-xs text-stone-500">{formatDateTime(payment.created_at)}{payment.reference ? ` · ${payment.reference}` : ''}</p></div>
            <p className="text-right text-xs text-stone-500">{payment.months ? `${payment.months} month${payment.months === 1 ? '' : 's'}` : 'Plan change'}<br />until {formatDate(payment.period_end)}</p>
          </li>)}</ul> : <p className="p-8 text-center text-sm text-stone-500">No payments yet.</p>}
        </div>
      </div>

      <div className="mt-6 overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
        <h2 className="flex items-center gap-2 border-b px-5 py-4 font-bold"><ImageIcon className="size-4 text-emerald-600" />Payment proofs ({proofs.length}){waiting > 0 && <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">{waiting} waiting</span>}</h2>
        {proofs.length ? <PaymentProofList proofs={proofs} /> : <p className="p-8 text-center text-sm text-stone-500">The shop has not sent any proofs. Owners upload them from Billing.</p>}
        {waiting > 0 && <p className="border-t px-5 py-3 text-xs text-stone-500">Recording a payment above marks the waiting proofs as recorded.</p>}
      </div>

      {billingEvents.length > 0 && <div className="mt-6 overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
        <h2 className="flex items-center gap-2 border-b px-5 py-4 font-bold"><CreditCard className="size-4 text-sky-600" />Card billing (Paddle webhooks)</h2>
        <ul className="divide-y text-sm">{billingEvents.map((event) => <li key={event.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
          <span><span className="font-mono text-xs">{event.type}</span>{event.outcome && <span className="text-stone-600"> — {event.outcome}</span>}</span>
          <span className="text-xs text-stone-500">{formatDateTime(event.received_at)}</span>
        </li>)}</ul>
      </div>}

      <div className="mt-6 rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
        <h2 className="flex items-center gap-2 font-bold"><History className="size-4 text-emerald-600" />History</h2>
        {events.length ? <ol className="mt-4 grid gap-4 border-l-2 border-stone-100 pl-5">{events.map((event) => <li key={event.id} className="relative text-sm">
          <span className="absolute -left-[27px] top-1 size-3 rounded-full border-2 border-white bg-emerald-500 ring-2 ring-emerald-100" />
          <p className="font-medium">{EVENT_LABELS[event.event] ?? event.event}{event.detail && <span className="font-normal text-stone-600"> — {event.detail}</span>}</p>
          <p className="text-xs text-stone-500">{formatDateTime(event.created_at)}{event.actor_name ? ` · by ${event.actor_name}` : ''}</p>
        </li>)}</ol> : <p className="mt-4 text-sm text-stone-500">No history yet.</p>}
      </div>
    </section>
  )
}
