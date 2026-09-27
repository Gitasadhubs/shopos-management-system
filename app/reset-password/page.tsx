import { Suspense } from 'react'
import { AuthPage } from '@/app/auth-pages'

export default function ResetPassword() {
  return <Suspense fallback={null}><AuthPage type="reset-password" /></Suspense>
}
