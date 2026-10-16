import { randomUUID } from 'node:crypto'
import type { RowDataPacket } from 'mysql2/promise'
import { roundMoney, type Queryable } from '@/lib/local-db'

// The parts of the partner program that sign-up and payments need (lib/local-affiliates.ts has the rest).
// Kept to the database alone so lib/local-auth.ts and lib/local-platform.ts can use them without a cycle.

// A partner earns this share of every payment a referred shop makes in its first COMMISSION_MONTHS paid months.
export const COMMISSION_RATE = 0.2
export const COMMISSION_MONTHS = 12

// Referral codes compare in upper case, letters and digits only ("sh-7k2p" works as SH7K2P).
export const normalizeCode = (code: string) => code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16)

// The approved partner behind a referral code, or null (unknown, pending and rejected codes are ignored).
export async function approvedAffiliateId(db: Queryable, code: string | null | undefined) {
  const clean = code ? normalizeCode(code) : ''
  if (!clean) return null
  const [[row]] = await db.query<RowDataPacket[]>("SELECT id FROM affiliates WHERE code = ? AND status = 'approved'", [clean])
  return row ? (row.id as string) : null
}

// The commission for a payment that covers `months` months, of which `paidBefore` months were paid
// earlier: only the months inside the first COMMISSION_MONTHS count.
export function commissionFor(amount: number, months: number, paidBefore: number) {
  const counted = Math.max(0, Math.min(months, COMMISSION_MONTHS - paidBefore))
  return counted > 0 ? { months: counted, amount: roundMoney(amount * (counted / months) * COMMISSION_RATE) } : null
}

// Called inside the transaction that records a subscription payment (after it is inserted).
export async function addCommissionForPayment(db: Queryable, shopId: string, payment: { id: string; amount: number; months: number }, now: Date) {
  const [[shop]] = await db.query<RowDataPacket[]>('SELECT referred_by FROM shops WHERE id = ?', [shopId])
  if (!shop?.referred_by) return null
  const [[paid]] = await db.query<RowDataPacket[]>('SELECT COALESCE(SUM(months), 0) AS months FROM subscription_payments WHERE shop_id = ? AND id <> ?', [shopId, payment.id])
  const commission = commissionFor(payment.amount, payment.months, Number(paid.months))
  if (!commission || commission.amount <= 0) return null
  await db.query(
    'INSERT INTO affiliate_commissions (id, affiliate_id, shop_id, payment_id, months, amount, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [randomUUID(), shop.referred_by, shopId, payment.id, commission.months, commission.amount, now],
  )
  return commission
}
