'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { endSession } from '@/lib/local-auth'
import { LocalDataError } from '@/lib/local-db'
import { changeSubscription, recordSubscriptionPayment, type SubscriptionAction } from '@/lib/local-platform'
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
  back(id, 'notice', `Payment of ₨${parsed.data.amount.toLocaleString('en-PK')} recorded. The shop is active.`)
}

const changeSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('add_days'), days: z.coerce.number().int().min(1, 'At least 1 day.').max(365, 'At most 365 days.') }),
  z.object({ action: z.literal('suspend') }),
  z.object({ action: z.literal('resume') }),
  z.object({ action: z.literal('expire') }),
  z.object({ action: z.literal('set_price'), price: z.coerce.number().finite().min(0, 'The price cannot be negative.').max(1_000_000) }),
])

const DONE: Record<SubscriptionAction['action'], string> = {
  add_days: 'Days added.',
  suspend: 'Shop suspended. It is read-only until you resume it.',
  resume: 'Shop resumed.',
  expire: 'Subscription ended. The shop is read-only until it pays.',
  set_price: 'Monthly price updated.',
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
