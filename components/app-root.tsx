import ShopOSApp from '@/components/shopos-app'
import { AuthProvider } from '@/components/auth/auth-provider'
import { SyncProvider } from '@/hooks/use-sync-engine'

// Server wrapper for every in-app screen; the storage mode is read at request time.
export function AppRoot() {
  const selfHosted = process.env.SHOPOS_STORAGE === 'mariadb'
  return <AuthProvider selfHosted={selfHosted}><SyncProvider enabled={!selfHosted}><ShopOSApp /></SyncProvider></AuthProvider>
}
