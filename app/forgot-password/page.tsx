import { Suspense } from 'react'
import { AuthPage } from '@/app/auth-pages'
import { LocalForgotPasswordPage } from '@/components/auth/local-auth-pages'

export default function ForgotPassword() {
  return <Suspense fallback={null}>{process.env.SHOPOS_STORAGE === 'mariadb' ? <LocalForgotPasswordPage /> : <AuthPage type="forgot-password" />}</Suspense>
}

export const dynamic = 'force-dynamic'
