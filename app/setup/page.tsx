import { Suspense } from 'react'
import SetupForm from './setup-form'
import { LocalSetupPage } from '@/components/auth/local-auth-pages'

export default function Setup() {
  return <Suspense fallback={null}>{process.env.SHOPOS_STORAGE === 'mariadb' ? <LocalSetupPage /> : <SetupForm />}</Suspense>
}

export const dynamic = 'force-dynamic'
