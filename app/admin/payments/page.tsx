import Link from 'next/link'
import { PaymentProofList } from '@/components/payment-proofs'
import { formatDateTime, requirePlatformAdmin } from '@/lib/admin'
import { formatMoney, formatTotals } from '@/lib/money'
import { listPendingPaymentProofs, listSubscriptionPayments, platformOverview } from '@/lib/local-platform'

export const dynamic = 'force-dynamic'

export default async function PaymentsPage() {
  await requirePlatformAdmin()
  const [payments, overview, waiting] = await Promise.all([listSubscriptionPayments(200), platformOverview(), listPendingPaymentProofs()])

  return (
    <section className="p-5 sm:p-8">
      <p className="text-sm font-semibold text-emerald-700">Finance</p>
      <h1 className="mt-1 text-3xl font-bold">Payments</h1>
      <p className="mt-2 text-stone-500">Card payments arrive from Paddle by themselves; transfers are recorded from each shop&apos;s page.</p>
      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl bg-emerald-50 p-5"><p className="text-sm text-emerald-800">Collected this month</p><p className="mt-2 text-3xl font-bold text-emerald-950">{formatTotals(overview.revenueThisMonth)}</p></div>
        <div className="rounded-2xl bg-violet-50 p-5"><p className="text-sm text-violet-800">Monthly recurring</p><p className="mt-2 text-3xl font-bold text-violet-950">{formatTotals(overview.mrr)}</p></div>
        <div className="rounded-2xl bg-amber-50 p-5"><p className="text-sm text-amber-800">All time</p><p className="mt-2 text-3xl font-bold text-amber-950">{formatTotals(overview.revenueAllTime)}</p></div>
      </div>
      {waiting.length > 0 && <div className="mt-6 overflow-hidden rounded-2xl border border-amber-200 bg-white shadow-sm">
        <h2 className="border-b border-amber-100 bg-amber-50 px-5 py-4 font-bold text-amber-950">Proofs waiting ({waiting.length})</h2>
        <PaymentProofList proofs={waiting} showShop />
        <p className="border-t px-5 py-3 text-xs text-stone-500">Open the shop and record the payment once the money has arrived.</p>
      </div>}
      <div className="mt-6 overflow-x-auto rounded-2xl border border-stone-200 bg-white shadow-sm">
        {payments.length ? <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500"><tr>{['Date', 'Shop', 'Amount', 'Method', 'Reference', 'Months'].map((head) => <th key={head} className="px-5 py-3">{head}</th>)}</tr></thead>
          <tbody>{payments.map((payment) => <tr key={payment.id} className="border-t border-stone-100">
            <td className="px-5 py-4 text-stone-600">{formatDateTime(payment.created_at)}</td>
            <td className="px-5 py-4 font-semibold"><Link href={`/admin/shops/${payment.shop_id}`} className="hover:text-emerald-700">{payment.shop_name}</Link></td>
            <td className="px-5 py-4 font-semibold tabular-nums">{formatMoney(payment.amount, payment.currency)}</td>
            <td className="px-5 py-4 capitalize">{payment.method}</td>
            <td className="px-5 py-4 text-stone-600">{payment.reference ?? '—'}</td>
            <td className="px-5 py-4">{payment.months || 'Plan change'}</td>
          </tr>)}</tbody>
        </table> : <div className="p-10 text-center"><h2 className="font-bold">No payments yet</h2><p className="mt-2 text-sm text-stone-500">Open a shop and use “Record a payment” when money arrives.</p></div>}
      </div>
    </section>
  )
}
