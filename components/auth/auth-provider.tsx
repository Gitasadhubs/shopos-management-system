'use client'

import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type Account = { user: any; role: any; shop: any; loading: boolean; roleError: string | null; signOut: () => Promise<void>; refresh: () => Promise<void> }
const AuthContext = createContext<Account | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [account, setAccount] = useState({ user: null as any, role: null as any, shop: null as any, loading: true, roleError: null as string | null })
  const refresh = useCallback(async () => {
    let supabase
    try { supabase = createClient() } catch { setAccount({ user: null, role: { role: 'owner', full_name: 'Local user', shop_id: null }, shop: null, loading: false, roleError: null }); return }
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return setAccount({ user: null, role: null, shop: null, loading: false, roleError: null })
    const { data, error } = await supabase.from('user_roles').select('role, full_name, shop_id').eq('user_id', user.id).maybeSingle()
    if (error) console.error('user_roles fetch failed:', error)
    const role = data ?? { role: 'cashier', full_name: user.email?.split('@')[0] || 'User', shop_id: null }
    const { data: shop } = role.shop_id ? await supabase.from('shop_settings').select('*').eq('shop_id', role.shop_id).maybeSingle() : { data: null }
    setAccount({ user, role, shop, loading: false, roleError: error ? 'Your account role could not be loaded. Some permissions may be limited.' : null })
  }, [])
  useEffect(() => { refresh(); try { const supabase = createClient(); const { data: listener } = supabase.auth.onAuthStateChange(() => refresh()); return () => listener.subscription.unsubscribe() } catch { return undefined } }, [refresh])
  const signOut = async () => { try { await createClient().auth.signOut() } catch {} setAccount({ user: null, role: null, shop: null, loading: false, roleError: null }); window.location.href = '/login' }
  return <AuthContext.Provider value={{ ...account, signOut, refresh }}>{children}</AuthContext.Provider>
}

export function useAuth() { const context = useContext(AuthContext); if (!context) throw new Error('useAuth must be used inside AuthProvider'); return context }
