'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { endSession } from '@/lib/local-auth'
import { LocalDataError } from '@/lib/local-db'
import { markAffiliatePaid, setAffiliateStatus } from '@/lib/local-affiliates'
import { changeSubscription, recordSubscriptionPayment, type SubscriptionAction } from '@/lib/local-platform'
import { formatMoney, formatTotals } from '@/lib/money'
import { clearSessionCookieOnAction, requireAdminForAction } from './session'

// Admin panel actions. Each checks the caller is a platform admin, then returns to the shop page
// with a notice (or an error) in the URL.

const shopId = z.string().uuid()

function back(id: string, key: 'notice' | 'error', message: string): never {
  revalidatePath('/admin', 'layout')
  redirect(`/admin/shops/${id}?${key}=${encodeURIComponent(message)}`)
}

const paymentSchema = z.object({
  amount: z.coerce.number().finite().positive('Enter the amount received.').max(10_000_000),
  currency: z.enum(['PKR', 'USD']).default('PKR'),
  method: z.enum(['bank', 'jazzcash', 'easypaisa', 'cash', 'other']),
  reference: z.string().trim().max(120).optional().default(''),
  months: z.coerce.number().int().min(1, 'At least 1 month.').max(24, 'At most 24 months at a time.'),
})

export async function recordPaymentAction(formData: FormData) {
  const admin = await requireAdminForAction()
  const id = shopId.parse(formData.get('shop_id'))
  const parsed = paymentSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) back(id, 'error', parsed.error.issues[0]?.message ?? 'Check the payment details.')
  try {
    await recordSubscriptionPayment(admin.id, id, parsed.data)
  } catch (error) {
    back(id, 'error', error instanceof LocalDataError ? error.message : 'Could not record the payment.')
  }
  back(id, 'notice', `Payment of ${formatMoney(parsed.data.amount, parsed.data.currency)} recorded. The shop is active.`)
}

const changeSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('add_days'), days: z.coerce.number().int().min(1, 'At least 1 day.').max(365, 'At most 365 days.') }),
  z.object({ action: z.literal('suspend') }),
  z.object({ action: z.literal('resume') }),
  z.object({ action: z.literal('expire') }),
  z.object({
    action: z.literal('set_plan'),
    plan: z.enum(['basic', 'starter', 'growth']),
    interval: z.enum(['month', 'year']),
    price: z.coerce.number().finite().min(0, 'The price cannot be negative.').max(1_000_000),
  }),
])

const DONE: Record<SubscriptionAction['action'], string> = {
  add_days: 'Days added.',
  suspend: 'Shop suspended. It is read-only until you resume it.',
  resume: 'Shop resumed.',
  expire: 'Subscription ended. The shop is read-only until it pays.',
  set_plan: 'Plan and price updated.',
}

export async function changeSubscriptionAction(formData: FormData) {
  const admin = await requireAdminForAction()
  const id = shopId.parse(formData.get('shop_id'))
  const parsed = changeSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) back(id, 'error', parsed.error.issues[0]?.message ?? 'Check the details.')
  try {
    await changeSubscription(admin.id, id, parsed.data)
  } catch (error) {
    back(id, 'error', error instanceof LocalDataError ? error.message : 'Could not update the subscription.')
  }
  back(id, 'notice', DONE[parsed.data.action])
}

export async function adminSignOut() {
  const { token } = await requireAdminForAction()
  await endSession(token)
  await clearSessionCookieOnAction()
  redirect('/login?signed_out=1')
}

// --- partner program (/admin/affiliates) --------------------------------------------------------

function backToAffiliates(key: 'notice' | 'error', message: string): never {
  revalidatePath('/admin/affiliates')
  redirect(`/admin/affiliates?${key}=${encodeURIComponent(message)}`)
}

const affiliateId = z.string().uuid()

export async function setAffiliateStatusAction(formData: FormData) {
  await requireAdminForAction()
  const id = affiliateId.parse(formData.get('affiliate_id'))
  const status = z.enum(['approved', 'rejected']).parse(formData.get('status'))
  try {
    const affiliate = await setAffiliateStatus(id, status)
    backToAffiliates('notice', status === 'approved' ? `${affiliate.name} is approved. Their referral link was emailed to ${affiliate.email}.` : `${affiliate.name}'s application was rejected.`)
  } catch (error) {
    if (error instanceof LocalDataError) backToAffiliates('error', error.message)
    throw error
  }
}

export async function markAffiliatePaidAction(formData: FormData) {
  await requireAdminForAction()
  const id = affiliateId.parse(formData.get('affiliate_id'))
  const note = z.string().trim().max(200).parse(formData.get('note') ?? '')
  try {
    const amount = await markAffiliatePaid(id, note)
    backToAffiliates('notice', `Payout of ${formatTotals(amount)} marked as paid.`)
  } catch (error) {
    if (error instanceof LocalDataError) backToAffiliates('error', error.message)
    throw error
  }
}
