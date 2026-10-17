import { Suspense } from 'react'
import { AuthPage } from '@/app/auth-pages'
import { LocalSignupPage } from '@/components/auth/local-auth-pages'
import { getPlatformSettings } from '@/lib/local-platform'

export default async function Signup() {
  if (process.env.SHOPOS_STORAGE !== 'mariadb') return <Suspense fallback={null}><AuthPage type="signup" /></Suspense>
  // While trials need a card, the form says so up front.
  const { require_card_for_trial } = await getPlatformSettings()
  return <Suspense fallback={null}><LocalSignupPage requireCard={require_card_for_trial} /></Suspense>
}

export const dynamic = 'force-dynamic'
