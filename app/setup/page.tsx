import { Suspense } from 'react'
import { LocalSetupPage } from '@/components/auth/local-auth-pages'

export default function Setup() {
  return <Suspense fallback={null}><LocalSetupPage /></Suspense>
}

export const dynamic = 'force-dynamic'
