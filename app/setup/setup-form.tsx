'use client'

import { useEffect, useState } from 'react'
import { Store, Check } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

export default function SetupForm() {
  const [name, setName] = useState('')
  const [shopId, setShopId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    const load = async () => {
      const supabase = createClient()
      const { data: { user }, error: userError } = await supabase.auth.getUser()
      if (userError || !user) { window.location.href = '/login'; return }
      const { data: role, error: roleError } = await supabase.from('user_roles').select('shop_id').eq('user_id', user.id).maybeSingle()
      if (roleError) { if (active) { setError(roleError.message); setLoading(false) }; return }
      if (!role) { if (active) { setError('Your shop account could not be found. Please contact support.'); setLoading(false) }; return }
      setShopId(role.shop_id)
      const { data: shop, error: shopError } = await supabase.from('shop_settings').select('shop_id, name, setup_completed').eq('shop_id', role.shop_id).maybeSingle()
      if (shopError) { if (active) { setError(shopError.message); setLoading(false) }; return }
      if (shop?.setup_completed) { window.location.href = '/dashboard'; return }
      if (!shop) {
        const { error: insertError } = await supabase.from('shop_settings').insert({ shop_id: role.shop_id, setup_completed: false })
        if (insertError) { if (active) { setError(insertError.message); setLoading(false) }; return }
      } else if (shop.name) setName(shop.name)
      if (active) setLoading(false)
    }
    load()
    return () => { active = false }
  }, [])

  const save = async (complete: boolean) => {
    if (!shopId) return
    setSaving(true); setError('')
    const supabase = createClient()
    const { error: saveError } = await supabase.from('shop_settings').update({ name: name.trim() || 'My Shop', currency: 'PKR', tax_percent: 0, receipt_header: name.trim() || 'My Shop', receipt_footer: 'Thank you for shopping with us!', setup_completed: complete }).eq('shop_id', shopId).select().single()
    if (saveError) { console.error('Setup save failed:', saveError); setError(`Could not save: ${saveError.message}`); setSaving(false); return }
    window.location.href = '/dashboard'
  }

  if (loading) return <main className="flex min-h-screen items-center justify-center bg-[#fbfaf7]"><p className="text-stone-500">Loading setup…</p></main>
  return <main className="flex min-h-screen items-center justify-center bg-[#fbfaf7] px-4"><section className="w-full max-w-lg rounded-3xl border border-stone-200/80 bg-white p-8 shadow-xl shadow-stone-900/5"><div className="mb-6 flex size-12 items-center justify-center rounded-2xl bg-emerald-600 text-white"><Store /></div><p className="text-sm font-semibold text-emerald-700">One quick step</p><h1 className="mt-2 text-3xl font-bold text-stone-900">Let&apos;s set up your shop</h1><p className="mt-2 text-stone-500">Tell us your shop name and we&apos;ll take care of the rest.</p>{error && <p role="alert" className="mt-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>}<form onSubmit={(event) => { event.preventDefault(); save(true) }} className="mt-8 flex flex-col gap-4"><input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="Your shop name" className="h-13 rounded-xl border border-stone-200 bg-stone-50 px-4 outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10" required /><button disabled={saving || !shopId} className="flex h-12 items-center justify-center gap-2 rounded-full bg-emerald-600 font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">{saving ? 'Saving…' : <><Check className="size-4" />Finish setup</>}</button></form><button type="button" onClick={() => save(true)} disabled={saving || !shopId} className="mt-5 w-full text-center text-sm text-stone-500 underline underline-offset-4 hover:text-emerald-700">Skip setup — take me to my dashboard</button></section></main>
}
