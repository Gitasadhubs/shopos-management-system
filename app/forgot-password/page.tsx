import { Suspense } from 'react'
import { LocalForgotPasswordPage } from '@/components/auth/local-auth-pages'

export default function ForgotPassword() {
  return <Suspense fallback={null}><LocalForgotPasswordPage /></Suspense>
}

export const dynamic = 'force-dynamic'
