import { Suspense } from 'react'
import { AuthPage } from '@/app/auth-pages'

export default function ForgotPassword() {
  return <Suspense fallback={null}><AuthPage type="forgot-password" /></Suspense>
}
