'use server'

import { revalidatePath } from 'next/cache'
import { requireAdmin } from '@/lib/admin'

export async function updateSubscription(shopId: string, action: 'activate' | 'extend' | 'suspend' | 'expire') {
  const { supabase, user } = await requireAdmin()
  const status = action === 'suspend' ? 'suspended' : action === 'expire' ? 'expired' : 'active'
  const update = action === 'activate' ? { status, current_period_end: new Date(Date.now() + 30 * 86400000).toISOString() } : action === 'extend' ? null : { status }
  if (update) await supabase.from('subscriptions').update(update).eq('shop_id', shopId)
  else {
    const { data } = await supabase.from('subscriptions').select('current_period_end').eq('shop_id', shopId).single()
    const base = data?.current_period_end && new Date(data.current_period_end) > new Date() ? new Date(data.current_period_end) : new Date()
    await supabase.from('subscriptions').update({ status: 'active', current_period_end: new Date(base.getTime() + 30 * 86400000).toISOString() }).eq('shop_id', shopId)
  }
  await supabase.from('shop_settings').update({ subscription_status: status }).eq('shop_id', shopId)
  await supabase.from('subscription_events').insert({ shop_id: shopId, event_type: action, metadata: { status }, created_by: user.id })
  revalidatePath(`/admin/shops/${shopId}`)
  revalidatePath('/admin')
  revalidatePath('/admin/shops')
  revalidatePath('/admin/subscriptions')
}

export async function resetDemoData(shopId: string) {
  if (shopId !== '00000000-0000-0000-0000-000000000001') throw new Error('Not the demo shop')
  const { supabase, user } = await requireAdmin()
  await supabase.from('subscription_events').insert({ shop_id: shopId, event_type: 'reset_demo_data', metadata: {}, created_by: user.id })
  revalidatePath(`/admin/shops/${shopId}`)
}

export async function adminSignOut() {
  const { supabase } = await requireAdmin()
  await supabase.auth.signOut()
}
