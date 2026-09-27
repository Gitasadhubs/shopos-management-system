import { createClient } from '@/lib/supabase/server'

export async function signUp(email: string, password: string, fullName: string, shopName: string) {
  const supabase = await createClient()
  return supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: process.env.NEXT_PUBLIC_DEV_SUPABASE_REDIRECT_URL ?? undefined,
      data: { full_name: fullName, shop_name: shopName },
    },
  })
}

export async function signIn(email: string, password: string) {
  const supabase = await createClient()
  return supabase.auth.signInWithPassword({ email, password })
}

export async function signOut() {
  const supabase = await createClient()
  return supabase.auth.signOut()
}

export async function resetPassword(email: string) {
  const supabase = await createClient()
  return supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${process.env.NEXT_PUBLIC_DEV_SUPABASE_REDIRECT_URL ?? ''}/auth/callback?next=/reset-password`,
  })
}

export async function updatePassword(newPassword: string) {
  const supabase = await createClient()
  return supabase.auth.updateUser({ password: newPassword })
}

export async function getSession() {
  const supabase = await createClient()
  return supabase.auth.getSession()
}

export async function getUser() {
  const supabase = await createClient()
  return supabase.auth.getUser()
}

export async function getAccountContext() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { user: null, role: null, shop: null }
  const { data: role } = await supabase.from('user_roles').select('shop_id, role, full_name').eq('user_id', user.id).maybeSingle()
  const { data: shop } = role ? await supabase.from('shop_settings').select('*').eq('shop_id', role.shop_id).maybeSingle() : { data: null }
  return { user, role, shop }
}
