import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getPartnerPage, PAYOUT_METHODS, PROGRAM } from '@/lib/local-affiliates'
import { formatTotals, type MoneyTotals } from '@/lib/money'

export const metadata = { title: 'My ShopOS partner page', robots: { index: false, follow: false } }
export const dynamic = 'force-dynamic'

// Earnings are per currency (a commission keeps the currency of the payment it came from).
const money = (value: MoneyTotals) => formatTotals(value)
const day = (value: string) => new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
const STATE: Record<string, [string, string]> = {
  trialing: ['On free trial', 'bg-sky-100 text-sky-800'],
  active: ['Paying', 'bg-emerald-100 text-emerald-800'],
  expired: ['Not paying', 'bg-stone-100 text-stone-600'],
  suspended: ['Suspended', 'bg-rose-100 text-rose-800'],
}

// A partner's private page (/partner/<token>, sent by email): their link, their shops and their earnings.
export default async function PartnerDashboard({ params }: { params: Promise<{ token: string }> }) {
  const data = await getPartnerPage((await params).token)
  if (!data) notFound()
  const { affiliate, shops } = data
  const paying = shops.filter((shop) => shop.state === 'active').length

  return (
    <main className="min-h-screen bg-stone-50 px-5 py-8 sm:px-8">
      <div className="mx-auto max-w-4xl">
        <Link href="https://getshopos.online/partners" className="text-lg font-bold">Shop<span className="text-emerald-600">OS</span> <span className="text-sm font-medium text-stone-500">partner</span></Link>
        <h1 className="mt-6 text-3xl font-bold">Hi {affiliate.name}</h1>

        {affiliate.status === 'pending' && <p className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-amber-900">Your application is waiting for approval. We usually review within a day and email you your referral link.</p>}
        {affiliate.status === 'rejected' && <p className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 p-5 text-rose-900">Your application was not approved. Reply to our email if you have questions.</p>}

        {affiliate.status === 'approved' && <>
          <div className="mt-6 rounded-2xl border border-emerald-200 bg-white p-5 shadow-sm">
            <p className="text-sm font-semibold text-emerald-700">Your referral link</p>
            <p className="mt-2 break-all rounded-lg bg-stone-50 p-3 font-mono text-sm">{data.referral_link}</p>
            <p className="mt-2 text-xs text-stone-500">Or straight to sign-up: <span className="break-all font-mono">{data.signup_link}</span> · Your code: <b className="font-mono">{affiliate.code}</b></p>
            <p className="mt-3 text-sm text-stone-600">Shops that create their account through this link are yours. You earn {PROGRAM.rate * 100}% of their payments for their first {PROGRAM.months} paid months.</p>
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-4">
            {[['Shops', String(shops.length), 'bg-white'], ['Paying now', String(paying), 'bg-white'], ['Owed to you', money(data.owed), 'bg-amber-50'], ['Paid to you', money(data.paid), 'bg-emerald-50']].map(([label, value, tone]) => <div key={label} className={`rounded-2xl border border-stone-200 p-5 ${tone}`}><p className="text-sm text-stone-600">{label}</p><p className="mt-1 text-2xl font-bold tabular-nums">{value}</p></div>)}
          </div>

          <div className="mt-6 overflow-x-auto rounded-2xl border border-stone-200 bg-white shadow-sm">
            {shops.length ? <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500"><tr>{['Shop', 'Signed up', 'Status', 'Paid months', 'You earned'].map((head) => <th key={head} className="px-5 py-3">{head}</th>)}</tr></thead>
              <tbody>{shops.map((shop, index) => <tr key={`${shop.name}-${index}`} className="border-t border-stone-100">
                <td className="px-5 py-3 font-semibold">{shop.name}</td>
                <td className="px-5 py-3 text-stone-600">{day(shop.signed_up)}</td>
                <td className="px-5 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATE[shop.state]?.[1] ?? ''}`}>{STATE[shop.state]?.[0] ?? shop.state}</span></td>
                <td className="px-5 py-3 tabular-nums">{shop.paid_months}</td>
                <td className="px-5 py-3 font-semibold tabular-nums">{money(shop.earned)}</td>
              </tr>)}</tbody>
            </table> : <p className="p-8 text-center text-sm text-stone-500">No shops yet. Share your link with shop owners you know.</p>}
          </div>

          {data.payouts.length > 0 && <div className="mt-6 rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
            <h2 className="font-bold">Payouts</h2>
            <ul className="mt-3 divide-y text-sm">{data.payouts.map((payout) => <li key={payout.paid_at} className="flex justify-between gap-4 py-2"><span className="text-stone-600">{day(payout.paid_at)}{payout.note ? ` · ${payout.note}` : ''}</span><b className="tabular-nums">{money(payout.amount)}</b></li>)}</ul>
          </div>}
        </>}
        <p className="mt-8 text-xs text-stone-500">This page is private: anyone with its link can see it. Lost the link? Use Partner sign in on getshopos.online/partners. Payouts go to your {PAYOUT_METHODS[affiliate.payout_method]} account on file.</p>
      </div>
    </main>
  )
}
