import ShopOSApp from '@/components/shopos-app'
import { AuthProvider } from '@/components/auth/auth-provider'
import { SyncProvider } from '@/hooks/use-sync-engine'

export default function Page() {
  return (
    <AuthProvider>
      <SyncProvider enabled={process.env.SHOPOS_STORAGE !== 'sqlite'}>
        <ShopOSApp />
      </SyncProvider>
    </AuthProvider>
  )
}

export const dynamic = 'force-dynamic'
