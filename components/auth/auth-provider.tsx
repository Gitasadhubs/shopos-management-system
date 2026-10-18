'use client'

import { createContext, useCallback, useContext, useEffect, useState } from 'react'

type Account = { user: any; role: any; shop: any; loading: boolean; roleError: string | null; selfHosted: boolean; signOut: () => Promise<void>; refresh: () => Promise<void> }
const AuthContext = createContext<Account | null>(null)

// The signed-in account (MariaDB, lib/local-auth.ts) for client components. selfHosted is kept for
// callers that still pass it; every install is self-hosted.
export function AuthProvider({ children }: { children: React.ReactNode; selfHosted?: boolean }) {
  const [account, setAccount] = useState({ user: null as any, role: null as any, shop: null as any, loading: true, roleError: null as string | null })
  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/auth/me', { cache: 'no-store' })
      if (response.status === 401) { window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname)}`); return }
      const body = await response.json()
      if (!response.ok) throw new Error(body.error ?? 'Could not load your account.')
      const user = body.data.user
      // shop carries the name, time zone, country and subscription (see SessionShop in lib/local-auth.ts).
      setAccount({ user, role: { role: user.role, full_name: user.full_name, shop_id: user.shop?.id ?? null }, shop: user.shop ?? null, loading: false, roleError: null })
    } catch (error) {
      setAccount({ user: null, role: null, shop: null, loading: false, roleError: error instanceof Error ? error.message : 'Could not load your account.' })
    }
  }, [])
  useEffect(() => { void refresh() }, [refresh])
  const signOut = async () => {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined)
    window.location.assign('/login?signed_out=1')
  }
  return <AuthContext.Provider value={{ ...account, selfHosted: true, signOut, refresh }}>{children}</AuthContext.Provider>
}

export function useAuth() { const context = useContext(AuthContext); if (!context) throw new Error('useAuth must be used inside AuthProvider'); return context }
