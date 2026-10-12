import { notFound } from 'next/navigation'
import { AppRoot } from '@/components/app-root'

export default function StaffRoute() {
  if (process.env.SHOPOS_STORAGE !== 'mariadb') notFound()
  return <AppRoot />
}

export const dynamic = 'force-dynamic'
