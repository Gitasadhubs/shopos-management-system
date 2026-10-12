import { Suspense } from 'react'
import { AuthPage } from '@/app/auth-pages'
import { LocalResetPasswordPage } from '@/components/auth/local-auth-pages'

export default function ResetPassword() {
  return <Suspense fallback={null}>{process.env.SHOPOS_STORAGE === 'mariadb' ? <LocalResetPasswordPage /> : <AuthPage type="reset-password" />}</Suspense>
}

export const dynamic = 'force-dynamic'
