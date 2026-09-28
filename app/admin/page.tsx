import Link from 'next/link'
import { requireAdmin, formatDate, statusClass } from '@/lib/admin'

function signupCutoff() {
  return new Date(Date.now() - 7 * 86400000).toISOString()
}

export default async function AdminDashboard() {
  const { supabase } = await requireAdmin()
  const [{ count: shops }, { count: active }, { count: trialing }, { count: expired }, { data: mrr }, { count: signups }, { data: recent }] = await Promise.all([
    supabase.from('shop_settings').select('*', { count: 'exact', head: true }),
    supabase.from('subscriptions').select('*', { count: 'exact', head: true }).eq('status', 'active'),
    supabase.from('subscriptions').select('*', { count: 'exact', head: true }).eq('status', 'trialing'),
    supabase.from('subscriptions').select('*', { count: 'exact', head: true }).eq('status', 'expired'),
    supabase.from('subscriptions').select('amount_pkr').eq('status', 'active'),
    supabase.from('shop_settings').select('*', { count: 'exact', head: true }).gt('created_at', signupCutoff()),
    supabase.from('shop_settings').select('shop_id,name,created_at,subscription_status').order('created_at', { ascending: false }).limit(20),
  ])
  const totalMrr = (mrr ?? []).reduce((sum, row) => sum + Number(row.amount_pkr ?? 0), 0)
  const ids = (recent ?? []).map((row) => row.shop_id)
  const { data: subs } = ids.length ? await supabase.from('subscriptions').select('shop_id,plan,current_period_end,status').in('shop_id', ids) : { data: [] }
  const subByShop = new Map((subs ?? []).map((row) => [row.shop_id, row]))
  const stats = [['Total shops', shops ?? 0, 'bg-emerald-50 text-emerald-800'], ['Active', active ?? 0, 'bg-emerald-50 text-emerald-800'], ['Trialing', trialing ?? 0, 'bg-amber-50 text-amber-800'], ['Expired', expired ?? 0, 'bg-rose-50 text-rose-800'], ['MRR', `₨${totalMrr.toLocaleString()}`, 'bg-emerald-50 text-emerald-800'], ['Signups / 7 days', signups ?? 0, 'bg-amber-50 text-amber-800']]
  return <section className="p-5 sm:p-8"><div className="mb-8"><p className="text-sm font-semibold text-emerald-700">Platform overview</p><h1 className="mt-1 text-3xl font-bold tracking-tight">Good morning, operator</h1><p className="mt-2 text-stone-500">Keep an eye on every ShopOS business.</p></div><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{stats.map(([label, value, tone]) => <div key={String(label)} className={`rounded-2xl p-5 ${tone}`}><p className="text-sm font-medium opacity-80">{label}</p><p className="mt-3 text-3xl font-bold">{value}</p></div>)}</div><div className="mt-8 overflow-hidden rounded-2xl border border-stone-200 bg-white"><div className="flex items-center justify-between border-b border-stone-200 px-5 py-4"><h2 className="font-bold">Latest shops</h2><Link href="/admin/shops" className="text-sm font-semibold text-emerald-700">View all</Link></div><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500"><tr><th className="px-5 py-3">Shop name</th><th className="px-5 py-3">Status</th><th className="px-5 py-3">Plan</th><th className="px-5 py-3">Period ends</th><th className="px-5 py-3" /></tr></thead><tbody>{(recent ?? []).map((shop) => { const sub = subByShop.get(shop.shop_id); return <tr key={shop.shop_id} className="border-t border-stone-100"><td className="px-5 py-4 font-semibold">{shop.name ?? 'Unnamed shop'}</td><td className="px-5 py-4"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusClass(sub?.status ?? shop.subscription_status)}`}>{sub?.status ?? shop.subscription_status ?? 'unknown'}</span></td><td className="px-5 py-4 capitalize text-stone-600">{sub?.plan ?? '—'}</td><td className="px-5 py-4 text-stone-600">{formatDate(sub?.current_period_end)}</td><td className="px-5 py-4 text-right"><Link href={`/admin/shops/${shop.shop_id}`} className="font-semibold text-emerald-700">View</Link></td></tr> })}</tbody></table></div></div></section>
}
