import Link from 'next/link'
import { formatDate, planPrice, requirePlatformAdmin, STATE_STYLES } from '@/lib/admin'
import { listShopsForAdmin, type SubscriptionState } from '@/lib/local-platform'

export const dynamic = 'force-dynamic'

const STATES = ['all', 'trialing', 'active', 'expired', 'suspended'] as const

export default async function SubscriptionsPage({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  await requirePlatformAdmin()
  const requested = (await searchParams).state ?? 'all'
  const state = (STATES as readonly string[]).includes(requested) ? (requested as SubscriptionState | 'all') : 'all'
  const shops = (await listShopsForAdmin({ state })).sort((a, b) => a.subscription.current_period_end.localeCompare(b.subscription.current_period_end))

  return (
    <section className="p-5 sm:p-8">
      <h1 className="text-3xl font-bold">Subscriptions</h1>
      <p className="mt-2 text-stone-500">Plans and renewal dates, soonest first.</p>
      <div className="my-6 flex flex-wrap gap-2">{STATES.map((item) => <Link key={item} href={item === 'all' ? '/admin/subscriptions' : `/admin/subscriptions?state=${item}`} className={`rounded-full px-4 py-2 text-sm font-semibold capitalize ${state === item ? 'bg-emerald-600 text-white' : 'bg-white text-stone-600 ring-1 ring-stone-200'}`}>{item}</Link>)}</div>
      <div className="overflow-x-auto rounded-2xl border border-stone-200 bg-white shadow-sm">
        {shops.length ? <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500"><tr>{['Shop', 'Plan', 'Status', 'Period end', 'Days left', 'Price', ''].map((head) => <th key={head} className="px-5 py-3">{head}</th>)}</tr></thead>
          <tbody>{shops.map((shop) => <tr key={shop.id} className="border-t border-stone-100">
            <td className="px-5 py-4 font-semibold">{shop.name}<p className="text-xs font-normal text-stone-500">{shop.owner_email}</p></td>
            <td className="px-5 py-4">{shop.subscription.plan_name}{shop.subscription.provider === 'paddle' && <span className="ml-1.5 rounded bg-sky-100 px-1.5 text-xs text-sky-800">card{shop.subscription.cancel_at_period_end ? ', ending' : ''}</span>}</td>
            <td className="px-5 py-4"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${STATE_STYLES[shop.subscription.state]}`}>{shop.subscription.state}</span></td>
            <td className="px-5 py-4 text-stone-600">{formatDate(shop.subscription.current_period_end)}</td>
            <td className="px-5 py-4 tabular-nums">{shop.subscription.state === 'trialing' || shop.subscription.state === 'active' ? shop.subscription.days_left : '—'}</td>
            <td className="px-5 py-4">{planPrice(shop.subscription)}</td>
            <td className="px-5 py-4 text-right"><Link href={`/admin/shops/${shop.id}`} className="font-semibold text-emerald-700">Manage</Link></td>
          </tr>)}</tbody>
        </table> : <p className="p-10 text-center text-sm text-stone-500">No subscriptions{state !== 'all' ? ` are ${state}` : ' yet'}.</p>}
      </div>
    </section>
  )
}
