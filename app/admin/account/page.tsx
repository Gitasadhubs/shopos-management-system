import AccountPage from '@/components/account-page'
import { AuthProvider } from '@/components/auth/auth-provider'
import { requirePlatformAdmin } from '@/lib/admin'

export const dynamic = 'force-dynamic'

// The admin's own sign-in details: the same screen shop users get.
export default async function AdminAccount() {
  await requirePlatformAdmin()
  return <section className="p-5 sm:p-8"><AuthProvider selfHosted><AccountPage /></AuthProvider></section>
}
