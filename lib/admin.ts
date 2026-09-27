import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

export async function getAdminContext() {
  const cookieStore = await cookies(); const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { cookies: { getAll: () => cookieStore.getAll(), setAll: (items) => { try { items.forEach(({ name, value, options }) => cookieStore.set(name, value, options)) } catch {} } } })
  const { data: { user } } = await supabase.auth.getUser(); if (!user) return { supabase, user: null, admin: null }
  const { data: admin } = await supabase.from('platform_admins').select('id, user_id, full_name').eq('user_id', user.id).maybeSingle(); return { supabase, user, admin }
}
export async function requireAdmin() { const context = await getAdminContext(); if (!context.user || !context.admin) throw new Error('Unauthorized'); return context }
export function adminDataClient() { return createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!) }
export function formatDate(value?: string | null) { return value ? new Date(value).toLocaleDateString('en-PK', { dateStyle: 'medium' }) : '—' }
export function statusClass(status?: string | null) { return status === 'active' ? 'bg-emerald-100 text-emerald-800' : status === 'trialing' ? 'bg-amber-100 text-amber-800' : 'bg-rose-100 text-rose-800' }
