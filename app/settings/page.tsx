import { notFound } from 'next/navigation'
import { AppRoot } from '@/components/app-root'

// Shop settings live in MariaDB; hosted (Supabase) shops have no settings screen here.
export default function Settings() {
  if (process.env.SHOPOS_STORAGE !== 'mariadb') notFound()
  return <AppRoot />
}

export const dynamic = 'force-dynamic'
