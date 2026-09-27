import { Suspense } from 'react'
import { AuthPage } from '@/app/auth-pages'

export default function Signup() {
  return <Suspense fallback={null}><AuthPage type="signup" /></Suspense>
}
