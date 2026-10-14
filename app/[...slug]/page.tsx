import { notFound } from 'next/navigation'
import { AppRoot } from '@/components/app-root'

// Screens rendered by ShopOSApp; anything else would silently show the dashboard.
const appRoutes = new Set(['dashboard', 'inventory', 'sales', 'account', 'customers', 'suppliers', 'purchases', 'reports', 'expenses', 'day-end'])
// Backed by MariaDB storage only; Supabase accounts and data are managed elsewhere.
const selfHostedOnly = new Set(['sales', 'account', 'customers', 'suppliers', 'purchases', 'reports', 'expenses', 'day-end'])

export default async function ShopOSRoute({ params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params
  if (slug.length !== 1 || !appRoutes.has(slug[0])) notFound()
  if (selfHostedOnly.has(slug[0]) && process.env.SHOPOS_STORAGE !== 'mariadb') notFound()
  return <AppRoot />
}

export const dynamic = 'force-dynamic'
