import { formatDateTime, pkr, requirePlatformAdmin } from '@/lib/admin'
import { listAffiliatesForAdmin, PAYOUT_METHODS, PROGRAM } from '@/lib/local-affiliates'
import { markAffiliatePaidAction, setAffiliateStatusAction } from '../actions'

export const dynamic = 'force-dynamic'

const STATUS = { pending: 'bg-amber-100 text-amber-800', approved: 'bg-emerald-100 text-emerald-800', rejected: 'bg-stone-100 text-stone-600' } as const

// Partner program: approve applications, see what each partner brought and is owed, record payouts.
export default async function AffiliatesPage({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  await requirePlatformAdmin()
  const [{ notice, error }, affiliates] = await Promise.all([searchParams, listAffiliatesForAdmin()])
  const owed = affiliates.reduce((sum, affiliate) => sum + affiliate.owed, 0)
  const pending = affiliates.filter((affiliate) => affiliate.status === 'pending').length

  return (
    <section className="p-5 sm:p-8">
      <p className="text-sm font-semibold text-emerald-700">Growth</p>
      <h1 className="mt-1 text-3xl font-bold">Affiliates</h1>
      <p className="mt-2 text-stone-500">Partners earn {PROGRAM.rate * 100}% of each payment from shops they referred, for those shops&apos; first {PROGRAM.months} paid months. Public page: <a className="font-semibold text-emerald-700" href="https://getshopos.online/partners" target="_blank" rel="noopener">getshopos.online/partners</a></p>
      {notice && <p role="status" className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
      {error && <p role="alert" className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl bg-amber-50 p-5"><p className="text-sm text-amber-800">Waiting for approval</p><p className="mt-2 text-3xl font-bold text-amber-950">{pending}</p></div>
        <div className="rounded-2xl bg-violet-50 p-5"><p className="text-sm text-violet-800">Owed to partners</p><p className="mt-2 text-3xl font-bold text-violet-950">{pkr(owed)}</p></div>
        <div className="rounded-2xl bg-emerald-50 p-5"><p className="text-sm text-emerald-800">Shops referred</p><p className="mt-2 text-3xl font-bold text-emerald-950">{affiliates.reduce((sum, affiliate) => sum + affiliate.shops, 0)}</p></div>
      </div>
      <div className="mt-6 grid gap-4">
        {affiliates.length ? affiliates.map((affiliate) => <article key={affiliate.id} className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-bold">{affiliate.name} <span className={`ml-2 rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${STATUS[affiliate.status]}`}>{affiliate.status}</span></h2>
              <p className="mt-1 text-sm text-stone-600">{affiliate.email} · {affiliate.phone}{affiliate.city || affiliate.country ? ` · ${[affiliate.city, affiliate.country].filter(Boolean).join(', ')}` : ''} · applied {formatDateTime(affiliate.created_at)}</p>
              <p className="mt-1 text-sm text-stone-600">Code <b className="font-mono">{affiliate.code}</b> · Paid by {PAYOUT_METHODS[affiliate.payout_method]}: {affiliate.payout_details}</p>
              {affiliate.about && <p className="mt-2 max-w-2xl text-sm italic text-stone-500">“{affiliate.about}”</p>}
            </div>
            <div className="text-right text-sm"><p>{affiliate.shops} shop{affiliate.shops === 1 ? '' : 's'} · {affiliate.paying_shops} paid</p><p className="mt-1">Owed <b>{pkr(affiliate.owed)}</b> · Paid {pkr(affiliate.paid)}</p></div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {affiliate.status !== 'approved' && <form action={setAffiliateStatusAction}><input type="hidden" name="affiliate_id" value={affiliate.id} /><input type="hidden" name="status" value="approved" /><button className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700">Approve</button></form>}
            {affiliate.status === 'pending' && <form action={setAffiliateStatusAction}><input type="hidden" name="affiliate_id" value={affiliate.id} /><input type="hidden" name="status" value="rejected" /><button className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-semibold text-stone-700 hover:bg-stone-50">Reject</button></form>}
            {affiliate.owed > 0 && <form action={markAffiliatePaidAction} className="flex flex-wrap items-center gap-2"><input type="hidden" name="affiliate_id" value={affiliate.id} /><input name="note" maxLength={200} placeholder="Payout reference, e.g. JazzCash TID 1234" aria-label={`Payout reference for ${affiliate.name}`} className="h-9 w-64 rounded-lg border border-stone-300 px-3 text-sm" /><button className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700">Mark {pkr(affiliate.owed)} paid</button></form>}
          </div>
        </article>) : <div className="rounded-2xl border border-stone-200 bg-white p-10 text-center"><h2 className="font-bold">No partners yet</h2><p className="mt-2 text-sm text-stone-500">Share <b>getshopos.online/partners</b> with people who know shop owners: distributors, salesmen, accountants.</p></div>}
      </div>
    </section>
  )
}
