import { Suspense } from 'react'
import { notFound } from 'next/navigation'
import { LocalVerifyEmailPage } from '@/components/auth/local-auth-pages'

export default function VerifyEmail() {
  if (process.env.SHOPOS_STORAGE !== 'mariadb') notFound()
  return <Suspense fallback={null}><LocalVerifyEmailPage /></Suspense>
}

export const dynamic = 'force-dynamic'
