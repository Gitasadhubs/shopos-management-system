import Link from 'next/link'
import { Search } from 'lucide-react'
import { formatDate, planPrice, requirePlatformAdmin, STATE_STYLES } from '@/lib/admin'
import { listShopsForAdmin, type SubscriptionState } from '@/lib/local-platform'

export const dynamic = 'force-dynamic'

const STATES = ['all', 'trialing', 'active', 'expired', 'suspended'] as const

export default async function ShopsPage({ searchParams }: { searchParams: Promise<{ q?: string; state?: string }> }) {
  await requirePlatformAdmin()
  const params = await searchParams
  const q = (params.q ?? '').slice(0, 100)
  const state = (STATES as readonly string[]).includes(params.state ?? '') ? (params.state as SubscriptionState | 'all') : 'all'
  const shops = await listShopsForAdmin({ search: q, state })
  const link = (next: string) => `/admin/shops?${new URLSearchParams({ ...(q ? { q } : {}), ...(next !== 'all' ? { state: next } : {}) })}`

  return (
    <section className="p-5 sm:p-8">
      <h1 className="text-3xl font-bold">Shops</h1>
      <p className="mt-2 text-stone-500">Every shop on this ShopOS service.</p>

      <div className="my-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <form className="relative flex-1" action="/admin/shops">
          {state !== 'all' && <input type="hidden" name="state" value={state} />}
          <Search className="absolute left-3 top-3.5 size-4 text-stone-400" />
          <input name="q" defaultValue={q} aria-label="Search shops" placeholder="Search by shop, owner email or phone" className="h-11 w-full rounded-xl border border-stone-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10" />
        </form>
        <div className="flex flex-wrap gap-2">{STATES.map((item) => <Link key={item} href={link(item)} className={`rounded-full px-4 py-2 text-sm font-semibold capitalize ${state === item ? 'bg-emerald-600 text-white' : 'bg-white text-stone-600 ring-1 ring-stone-200'}`}>{item}</Link>)}</div>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-stone-200 bg-white shadow-sm">
        {shops.length ? <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500"><tr>{['Shop', 'Owner', 'Status', 'Price', 'Period ends', 'Users', 'Products', 'Sales (30d)', ''].map((head) => <th key={head} className="px-5 py-3">{head}</th>)}</tr></thead>
          <tbody>{shops.map((shop) => <tr key={shop.id} className="border-t border-stone-100 hover:bg-stone-50/60">
            <td className="px-5 py-4"><p className="font-semibold">{shop.name}</p><p className="text-xs text-stone-500">Joined {formatDate(shop.created_at)}{shop.phone ? ` · ${shop.phone}` : ''}</p></td>
            <td className="px-5 py-4"><p>{shop.owner_name ?? '—'}</p><p className="text-xs text-stone-500">{shop.owner_email ?? ''}</p></td>
            <td className="px-5 py-4"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${STATE_STYLES[shop.subscription.state]}`}>{shop.subscription.state}</span></td>
            <td className="px-5 py-4">{planPrice(shop.subscription)}</td>
            <td className="px-5 py-4 text-stone-600">{formatDate(shop.subscription.current_period_end)}<p className="text-xs text-stone-400">{shop.subscription.state === 'trialing' || shop.subscription.state === 'active' ? `${shop.subscription.days_left} days left` : ''}</p></td>
            <td className="px-5 py-4 tabular-nums">{shop.users}</td>
            <td className="px-5 py-4 tabular-nums">{shop.products}</td>
            <td className="px-5 py-4 tabular-nums">{shop.sales_30d}<p className="text-xs text-stone-400">{shop.last_sale_at ? `last ${formatDate(shop.last_sale_at)}` : 'no sales'}</p></td>
            <td className="px-5 py-4 text-right"><Link href={`/admin/shops/${shop.id}`} className="font-semibold text-emerald-700">Manage</Link></td>
          </tr>)}</tbody>
        </table> : <p className="p-10 text-center text-sm text-stone-500">{q || state !== 'all' ? 'No shops match.' : 'No shops yet.'}</p>}
      </div>
    </section>
  )
}
