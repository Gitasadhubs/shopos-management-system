import { Suspense } from 'react'
import { AuthPage } from '@/app/auth-pages'
import { LocalSignupPage } from '@/components/auth/local-auth-pages'

export default function Signup() {
  return <Suspense fallback={null}>{process.env.SHOPOS_STORAGE === 'mariadb' ? <LocalSignupPage /> : <AuthPage type="signup" />}</Suspense>
}

export const dynamic = 'force-dynamic'
