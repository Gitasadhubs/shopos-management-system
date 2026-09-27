import ShopOSApp from '@/components/shopos-app'
import { AuthProvider } from '@/components/auth/auth-provider'

export default function Page() {
  return (
    <AuthProvider>
      <ShopOSApp />
    </AuthProvider>
  )
}

export const dynamic = 'force-dynamic'
