import { Suspense } from 'react'
import { headers } from 'next/headers'
import { AuthPage } from '@/app/auth-pages'
import { LocalSignupPage } from '@/components/auth/local-auth-pages'
import { visitorCountry } from '@/lib/countries'
import { getPlatformSettings } from '@/lib/local-platform'

export default async function Signup() {
  if (process.env.SHOPOS_STORAGE !== 'mariadb') return <Suspense fallback={null}><AuthPage type="signup" /></Suspense>
  // While trials need a card, the form says so up front. The country starts at the visitor's location.
  const { require_card_for_trial } = await getPlatformSettings()
  const country = visitorCountry(await headers())
  return <Suspense fallback={null}><LocalSignupPage requireCard={require_card_for_trial} suggestedCountry={country} /></Suspense>
}

export const dynamic = 'force-dynamic'
