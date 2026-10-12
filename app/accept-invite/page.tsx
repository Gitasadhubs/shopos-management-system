import { Suspense } from 'react'
import { notFound } from 'next/navigation'
import { LocalAcceptInvitePage } from '@/components/auth/local-auth-pages'

export default function AcceptInvite() {
  if (process.env.SHOPOS_STORAGE !== 'mariadb') notFound()
  return <Suspense fallback={null}><LocalAcceptInvitePage /></Suspense>
}

export const dynamic = 'force-dynamic'
