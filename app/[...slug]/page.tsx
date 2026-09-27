import ShopOSApp from '@/components/shopos-app'
import { AuthProvider } from '@/components/auth/auth-provider'
import { SyncProvider } from '@/hooks/use-sync-engine'

export default function ShopOSRoute() {
  return <AuthProvider><SyncProvider><ShopOSApp /></SyncProvider></AuthProvider>
}
