import Link from 'next/link'
import { AlarmClock, Banknote, CircleDollarSign, Store, TrendingUp, UserPlus } from 'lucide-react'
import { ControlPanelIllustration } from '@/components/illustrations'
import { formatDate, planPrice, requirePlatformAdmin, STATE_STYLES } from '@/lib/admin'
import { platformOverview } from '@/lib/local-platform'
import { CURRENCIES, formatMoney, formatTotals } from '@/lib/money'

// One bar per currency (never added together), each scaled to its own best month.
const BAR_TONES = { USD: ['from-emerald-600 to-emerald-400', 'from-emerald-200 to-emerald-100'], PKR: ['from-amber-500 to-amber-300', 'from-amber-200 to-amber-100'] } as const

export const dynamic = 'force-dynamic'

function greeting() {
  const hour = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Asia/Karachi' }).format(new Date()))
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
}

export default async function AdminOverview() {
  const admin = await requirePlatformAdmin()
  const data = await platformOverview()
  const shown = CURRENCIES.filter((currency) => data.revenueByMonth.some((month) => month.total[currency]))
  const series = shown.length ? shown : (['USD'] as const)
  const maxOf = Object.fromEntries(series.map((currency) => [currency, Math.max(1, ...data.revenueByMonth.map((month) => month.total[currency] ?? 0))]))
  const stats = [
    { label: 'Total shops', value: String(data.totalShops), note: `${data.signups7d} new this week`, icon: Store, tone: 'bg-emerald-50 text-emerald-700' },
    { label: 'Paying shops', value: String(data.active), note: `${data.trialing} on trial`, icon: TrendingUp, tone: 'bg-sky-50 text-sky-700' },
    { label: 'Monthly recurring', value: formatTotals(data.mrr), note: 'From active plans (yearly ÷ 12)', icon: CircleDollarSign, tone: 'bg-violet-50 text-violet-700' },
    { label: 'Collected this month', value: formatTotals(data.revenueThisMonth), note: `${formatTotals(data.revenueAllTime)} all time`, icon: Banknote, tone: 'bg-amber-50 text-amber-700' },
  ]

  return (
    <section className="p-5 sm:p-8">
      <div className="relative mb-8 overflow-hidden rounded-2xl bg-stone-900 p-6 text-white sm:p-8">
        <div className="absolute inset-0 shopos-dots opacity-60" />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="flex-1">
            <p className="text-sm font-semibold text-emerald-300">Platform overview</p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight">{greeting()}, {admin.full_name.split(/\s+/)[0]}</h1>
            <p className="mt-2 text-stone-300">Every ShopOS shop, its plan and its payments.</p>
            <div className="mt-4 flex flex-wrap gap-2 text-xs">
              {(['trialing', 'active', 'expired', 'suspended'] as const).map((state) => <Link key={state} href={`/admin/subscriptions?state=${state}`} className={`rounded-full px-3 py-1 font-semibold capitalize ${STATE_STYLES[state]}`}>{data[state]} {state}</Link>)}
            </div>
          </div>
          <ControlPanelIllustration className="hidden h-36 w-auto shopos-float sm:block" />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map(({ label, value, note, icon: Icon, tone }, index) => <div key={label} className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm shopos-rise" style={{ animationDelay: `${index * 60}ms` }}>
          <div className="flex items-start justify-between"><p className="text-sm text-stone-500">{label}</p><span className={`flex size-10 items-center justify-center rounded-xl ${tone}`}><Icon className="size-5" /></span></div>
          <p className="mt-2 text-2xl font-bold tabular-nums">{value}</p><p className="mt-1 text-xs text-stone-500">{note}</p>
        </div>)}
      </div>

      <div className="mt-8 grid gap-6 xl:grid-cols-[1.3fr_1fr]">
        <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-bold">Collected per month</h2>
            {series.length > 1 && <div className="flex gap-3 text-xs text-stone-500">{series.map((currency) => <span key={currency} className="flex items-center gap-1.5"><span className={`size-2.5 rounded-full bg-gradient-to-t ${BAR_TONES[currency][0]}`} />{currency}</span>)}</div>}
          </div>
          <div className="mt-6 flex h-48 items-end gap-3" role="img" aria-label="Subscription payments over the last six months, per currency">
            {data.revenueByMonth.map((month, index) => <div key={month.month} className="flex flex-1 flex-col items-center gap-2">
              <span className="text-center text-[11px] font-semibold leading-tight text-stone-500">{series.filter((currency) => month.total[currency]).map((currency) => <span key={currency} className="block">{formatMoney(month.total[currency]!, currency)}</span>)}</span>
              <div className="flex w-full flex-1 items-end gap-0.5">{series.map((currency) => <div key={currency} className={`flex-1 rounded-t-lg bg-gradient-to-t shopos-grow ${BAR_TONES[currency][index === data.revenueByMonth.length - 1 ? 0 : 1]}`} style={{ height: `${Math.max(3, ((month.total[currency] ?? 0) / maxOf[currency]) * 100)}%`, animationDelay: `${index * 70}ms` }} />)}</div>
              <span className="text-xs text-stone-500">{new Date(`${month.month}-15T00:00:00Z`).toLocaleDateString('en-PK', { month: 'short' })}</span>
            </div>)}
          </div>
        </div>
        <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
          <h2 className="flex items-center gap-2 font-bold"><AlarmClock className="size-4 text-amber-600" />Ending within 7 days</h2>
          {data.expiringSoon.length ? <ul className="mt-4 divide-y">{data.expiringSoon.map((shop) => <li key={shop.id}><Link href={`/admin/shops/${shop.id}`} className="flex items-center justify-between gap-3 py-3 hover:text-emerald-700"><span className="font-medium">{shop.name}</span><span className="text-right text-xs"><span className={`rounded-full px-2 py-0.5 font-semibold capitalize ${STATE_STYLES[shop.subscription.state]}`}>{shop.subscription.state}</span><span className="mt-1 block text-stone-500">{formatDate(shop.subscription.current_period_end)}</span></span></Link></li>)}</ul> : <p className="mt-6 rounded-xl border border-dashed p-6 text-center text-sm text-stone-500">Nothing ends this week.</p>}
        </div>
      </div>

      <div className="mt-8 overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-stone-200 px-5 py-4"><h2 className="flex items-center gap-2 font-bold"><UserPlus className="size-4 text-emerald-600" />Latest shops</h2><Link href="/admin/shops" className="text-sm font-semibold text-emerald-700">View all</Link></div>
        {data.latest.length ? <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-left text-sm">
          <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500"><tr><th className="px-5 py-3">Shop</th><th className="px-5 py-3">Status</th><th className="px-5 py-3">Price</th><th className="px-5 py-3">Period ends</th><th className="px-5 py-3">Joined</th><th className="px-5 py-3" /></tr></thead>
          <tbody>{data.latest.map((shop) => <tr key={shop.id} className="border-t border-stone-100"><td className="px-5 py-4 font-semibold">{shop.name}</td><td className="px-5 py-4"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${STATE_STYLES[shop.subscription.state]}`}>{shop.subscription.state}</span></td><td className="px-5 py-4">{planPrice(shop.subscription)}</td><td className="px-5 py-4 text-stone-600">{formatDate(shop.subscription.current_period_end)}</td><td className="px-5 py-4 text-stone-600">{formatDate(shop.created_at)}</td><td className="px-5 py-4 text-right"><Link href={`/admin/shops/${shop.id}`} className="font-semibold text-emerald-700">Manage</Link></td></tr>)}</tbody>
        </table></div> : <p className="p-10 text-center text-sm text-stone-500">No shops yet. Shops appear here when they sign up at /signup.</p>}
      </div>
    </section>
  )
}
