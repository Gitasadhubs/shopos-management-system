import ShopOSApp from '@/components/shopos-app'
import { AuthProvider } from '@/components/auth/auth-provider'

export default function ShopOSRoute() {
  return <AuthProvider><ShopOSApp /></AuthProvider>
}
