'use client'

import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type Account = { user: any; role: any; shop: any; loading: boolean; roleError: string | null; selfHosted: boolean; signOut: () => Promise<void>; refresh: () => Promise<void> }
const AuthContext = createContext<Account | null>(null)

// selfHosted: accounts live in MariaDB (lib/local-auth.ts) instead of Supabase.
export function AuthProvider({ children, selfHosted = false }: { children: React.ReactNode; selfHosted?: boolean }) {
  const [account, setAccount] = useState({ user: null as any, role: null as any, shop: null as any, loading: true, roleError: null as string | null })
  const refresh = useCallback(async () => {
    if (selfHosted) {
      try {
        const response = await fetch('/api/auth/me', { cache: 'no-store' })
        if (response.status === 401) { window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname)}`); return }
        const body = await response.json()
        if (!response.ok) throw new Error(body.error ?? 'Could not load your account.')
        const user = body.data.user
        // shop carries the name, time zone and subscription (see SessionShop in lib/local-auth.ts).
        setAccount({ user, role: { role: user.role, full_name: user.full_name, shop_id: user.shop?.id ?? null }, shop: user.shop ?? null, loading: false, roleError: null })
      } catch (error) {
        setAccount({ user: null, role: null, shop: null, loading: false, roleError: error instanceof Error ? error.message : 'Could not load your account.' })
      }
      return
    }
    let supabase
    try { supabase = createClient() } catch { setAccount({ user: null, role: { role: 'owner', full_name: 'Local user', shop_id: null }, shop: null, loading: false, roleError: null }); return }
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return setAccount({ user: null, role: null, shop: null, loading: false, roleError: null })
    const { data, error } = await supabase.from('user_roles').select('role, full_name, shop_id').eq('user_id', user.id).maybeSingle()
    if (error) console.error('user_roles fetch failed:', error)
    const role = data ?? { role: 'cashier', full_name: user.email?.split('@')[0] || 'User', shop_id: null }
    const { data: shop } = role.shop_id ? await supabase.from('shop_settings').select('*').eq('shop_id', role.shop_id).maybeSingle() : { data: null }
    setAccount({ user, role, shop, loading: false, roleError: error ? 'Your account role could not be loaded. Some permissions may be limited.' : null })
  }, [selfHosted])
  useEffect(() => {
    refresh()
    if (selfHosted) return undefined
    try { const supabase = createClient(); const { data: listener } = supabase.auth.onAuthStateChange(() => refresh()); return () => listener.subscription.unsubscribe() } catch { return undefined }
  }, [refresh, selfHosted])
  const signOut = async () => {
    if (selfHosted) {
      await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined)
      window.location.assign('/login?signed_out=1')
      return
    }
    try { await createClient().auth.signOut() } catch {}
    setAccount({ user: null, role: null, shop: null, loading: false, roleError: null })
    window.location.href = '/login'
  }
  return <AuthContext.Provider value={{ ...account, selfHosted, signOut, refresh }}>{children}</AuthContext.Provider>
}

export function useAuth() { const context = useContext(AuthContext); if (!context) throw new Error('useAuth must be used inside AuthProvider'); return context }
