import { Suspense } from 'react'
import { LocalResetPasswordPage } from '@/components/auth/local-auth-pages'

export default function ResetPassword() {
  return <Suspense fallback={null}><LocalResetPasswordPage /></Suspense>
}

export const dynamic = 'force-dynamic'
