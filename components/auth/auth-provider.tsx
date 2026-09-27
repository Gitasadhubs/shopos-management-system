'use client'

import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type Account = { user: any; role: any; shop: any; loading: boolean; signOut: () => Promise<void>; refresh: () => Promise<void> }
const AuthContext = createContext<Account | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [account, setAccount] = useState({ user: null as any, role: null as any, shop: null as any, loading: true })
  const refresh = useCallback(async () => {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return setAccount({ user: null, role: null, shop: null, loading: false })
    const { data: role } = await supabase.from('user_roles').select('shop_id, role, full_name').eq('user_id', user.id).maybeSingle()
    const { data: shop } = role ? await supabase.from('shop_settings').select('*').eq('shop_id', role.shop_id).maybeSingle() : { data: null }
    setAccount({ user, role, shop, loading: false })
  }, [])
  useEffect(() => { refresh(); const supabase = createClient(); const { data: listener } = supabase.auth.onAuthStateChange(() => refresh()); return () => listener.subscription.unsubscribe() }, [refresh])
  const signOut = async () => { await createClient().auth.signOut(); setAccount({ user: null, role: null, shop: null, loading: false }); window.location.href = '/login' }
  return <AuthContext.Provider value={{ ...account, signOut, refresh }}>{children}</AuthContext.Provider>
}

export function useAuth() { const context = useContext(AuthContext); if (!context) throw new Error('useAuth must be used inside AuthProvider'); return context }
