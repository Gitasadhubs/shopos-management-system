import { notFound } from 'next/navigation'
import { currentUser, isSelfHosted } from '@/lib/local-session'
import type { SubscriptionState } from '@/lib/local-platform'

// The ShopOS admin panel (/admin) is for platform admins only. Anyone else gets a plain 404, so the
// area is not even visible. The proxy checks this too; pages and actions check again.
export async function requirePlatformAdmin() {
  if (!isSelfHosted()) notFound()
  const user = await currentUser()
  if (!user || user.role !== 'admin') notFound()
  return user
}

export function formatDate(value?: string | null) {
  return value ? new Date(value).toLocaleDateString('en-PK', { dateStyle: 'medium', timeZone: 'Asia/Karachi' }) : '—'
}

export function formatDateTime(value?: string | null) {
  return value ? new Date(value).toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Karachi' }) : '—'
}

export const pkr = (value: number) => `₨${Number(value).toLocaleString('en-PK', { maximumFractionDigits: 2 })}`

export const STATE_STYLES: Record<SubscriptionState, string> = {
  active: 'bg-emerald-100 text-emerald-800',
  trialing: 'bg-amber-100 text-amber-800',
  expired: 'bg-rose-100 text-rose-800',
  suspended: 'bg-stone-200 text-stone-700',
}
