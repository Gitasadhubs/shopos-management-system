import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { RowDataPacket } from 'mysql2/promise'
import { COMMISSION_MONTHS, COMMISSION_RATE } from '@/lib/affiliate-core'
import { emailBucket, enforceLimit, ipBucket, normalizeEmail, recordAttempt, type ClientInfo } from '@/lib/local-auth'
import { ER_DUP_ENTRY, getPool, iso, isDbError, LocalDataError, roundMoney, withTransaction } from '@/lib/local-db'
import { subscriptionState, type SubscriptionState } from '@/lib/local-platform'
import { publicUrl, sendAffiliateApprovedEmail, sendAffiliateReceivedEmail, sendAffiliateSignInEmail } from '@/lib/mailer'

// The partner (affiliate) program. Anyone applies at /partner; a platform admin approves them in
// /admin/affiliates. An approved partner's link (getshopos.online/?ref=CODE) credits the shops that sign
// up through it (lib/affiliate-core.ts), and each payment in a referred shop's first 12 paid months earns
// them 20%. Payouts are made by hand each month and marked paid here. Each partner has a private page,
// /partner/<token>, with their link and earnings; only the token's hash is stored.

export type PayoutMethod = 'paypal' | 'wise' | 'payoneer' | 'bank' | 'mobile_wallet' | 'other'
export const PAYOUT_METHODS: Record<PayoutMethod, string> = { paypal: 'PayPal', wise: 'Wise', payoneer: 'Payoneer', bank: 'Bank transfer', mobile_wallet: 'Mobile wallet', other: 'Other' }
export type AffiliateStatus = 'pending' | 'approved' | 'rejected'
export type AffiliateApplication = { name: string; email: string; phone: string; city?: string; country?: string; payout_method: PayoutMethod; payout_details: string; about?: string }
export type Affiliate = {
  id: string; code: string; name: string; email: string; phone: string; city: string | null; country: string | null; payout_method: PayoutMethod; payout_details: string
  about: string | null; status: AffiliateStatus; created_at: string; approved_at: string | null
}
export type AdminAffiliate = Affiliate & { shops: number; paying_shops: number; owed: number; paid: number }
export type ReferredShop = { name: string; signed_up: string; state: SubscriptionState; paid_months: number; earned: number }
export type PartnerPage = { affiliate: Affiliate; referral_link: string; signup_link: string; shops: ReferredShop[]; owed: number; paid: number; payouts: Array<{ paid_at: string; amount: number; note: string | null }> }

export const PROGRAM = { rate: COMMISSION_RATE, months: COMMISSION_MONTHS }
const SITE_URL = () => (process.env.SHOPOS_SITE_URL ?? 'https://getshopos.online').replace(/\/$/, '')
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')
// Easy to read out and type: no 0/O, 1/I/L.
const CODE_LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const newCode = () => Array.from(randomBytes(6), (byte) => CODE_LETTERS[byte % CODE_LETTERS.length]).join('')
const pageUrl = (token: string) => publicUrl(`/partner/${token}`)

function affiliateFromRow(row: RowDataPacket): Affiliate {
  return {
    id: row.id, code: row.code, name: row.name, email: row.email, phone: row.phone, city: row.city ?? null, country: row.country ?? null, payout_method: row.payout_method,
    payout_details: row.payout_details, about: row.about ?? null, status: row.status, created_at: iso(row.created_at), approved_at: row.approved_at ? iso(row.approved_at) : null,
  }
}

// A new application. The private page link goes to the applicant by email (and is returned once, to show).
export async function applyAffiliate(input: AffiliateApplication, client: ClientInfo) {
  const pool = await getPool()
  await enforceLimit(pool, ipBucket('partner', client.ip), 5, 60)
  await recordAttempt(pool, ipBucket('partner', client.ip))
  const token = randomBytes(24).toString('base64url')
  const now = new Date()
  const email = normalizeEmail(input.email)
  for (let attempt = 0; ; attempt += 1) {
    try {
      await pool.query(
        `INSERT INTO affiliates (id, code, name, email, phone, city, country, payout_method, payout_details, about, status, token_hash, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
        [randomUUID(), newCode(), input.name.trim(), email, input.phone.trim(), input.city?.trim() || null, input.country?.trim() || null, input.payout_method, input.payout_details.trim(), input.about?.trim() || null, sha256(token), now, now],
      )
      break
    } catch (error) {
      if (isDbError(error, ER_DUP_ENTRY) && error.message.includes('affiliates_email_uq')) throw new LocalDataError('This email has already applied. Check your inbox for your partner page link.', 409, 'email_taken')
      // A code collision: try another code.
      if (isDbError(error, ER_DUP_ENTRY) && attempt < 3) continue
      throw error
    }
  }
  await sendAffiliateReceivedEmail(email, input.name.trim(), pageUrl(token)).catch((error) => console.error('partner email failed', error))
  return { page: pageUrl(token) }
}

export async function listAffiliatesForAdmin(status?: AffiliateStatus) {
  const pool = await getPool()
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT affiliates.*,
       (SELECT COUNT(*) FROM shops WHERE shops.referred_by = affiliates.id) AS shops,
       (SELECT COUNT(DISTINCT shop_id) FROM affiliate_commissions WHERE affiliate_commissions.affiliate_id = affiliates.id) AS paying_shops,
       (SELECT COALESCE(SUM(amount), 0) FROM affiliate_commissions WHERE affiliate_id = affiliates.id AND paid_at IS NULL) AS owed,
       (SELECT COALESCE(SUM(amount), 0) FROM affiliate_commissions WHERE affiliate_id = affiliates.id AND paid_at IS NOT NULL) AS paid
     FROM affiliates ${status ? 'WHERE status = ?' : ''}
     ORDER BY status = 'pending' DESC, owed DESC, created_at DESC LIMIT 500`,
    status ? [status] : [],
  )
  return rows.map((row): AdminAffiliate => ({ ...affiliateFromRow(row), shops: Number(row.shops), paying_shops: Number(row.paying_shops), owed: roundMoney(Number(row.owed)), paid: roundMoney(Number(row.paid)) }))
}

// Approving emails the partner their link. A fresh private-page token goes with it (the old one stops working),
// since the original one is not stored.
// "Partner sign in": a partner who lost their link asks for a new one by email. The caller always shows
// the same answer, so this never reveals who is a partner. A new link replaces the old one.
export async function sendPartnerSignInLink(email: string, client: ClientInfo) {
  const pool = await getPool()
  const clean = normalizeEmail(email)
  await enforceLimit(pool, ipBucket('partner-signin', client.ip), 10, 15)
  await enforceLimit(pool, emailBucket('partner-signin', clean), 3, 15)
  await recordAttempt(pool, ipBucket('partner-signin', client.ip))
  await recordAttempt(pool, emailBucket('partner-signin', clean))
  const [[row]] = await pool.query<RowDataPacket[]>("SELECT id, name FROM affiliates WHERE email = ? AND status <> 'rejected'", [clean])
  if (!row) return
  const token = randomBytes(24).toString('base64url')
  await pool.query('UPDATE affiliates SET token_hash = ?, updated_at = ? WHERE id = ?', [sha256(token), new Date(), row.id])
  await sendAffiliateSignInEmail(clean, row.name, pageUrl(token)).catch((error) => console.error('partner email failed', error))
}

export async function setAffiliateStatus(affiliateId: string, status: 'approved' | 'rejected') {
  const token = randomBytes(24).toString('base64url')
  const affiliate = await withTransaction(async (connection) => {
    const [[row]] = await connection.query<RowDataPacket[]>('SELECT * FROM affiliates WHERE id = ? FOR UPDATE', [affiliateId])
    if (!row) throw new LocalDataError('Partner not found.', 404)
    const now = new Date()
    if (status === 'approved') {
      await connection.query("UPDATE affiliates SET status = 'approved', approved_at = COALESCE(approved_at, ?), token_hash = ?, updated_at = ? WHERE id = ?", [now, sha256(token), now, affiliateId])
    } else {
      await connection.query("UPDATE affiliates SET status = 'rejected', updated_at = ? WHERE id = ?", [now, affiliateId])
    }
    return affiliateFromRow(row)
  })
  if (status === 'approved') {
    await sendAffiliateApprovedEmail(affiliate.email, affiliate.name, `${SITE_URL()}/?ref=${affiliate.code}`, pageUrl(token)).catch((error) => console.error('partner email failed', error))
  }
  return affiliate
}

// Everything owed to a partner is marked paid with the payout's note (e.g. "JazzCash TID 12345").
export async function markAffiliatePaid(affiliateId: string, note: string) {
  return withTransaction(async (connection) => {
    const [[owed]] = await connection.query<RowDataPacket[]>('SELECT COALESCE(SUM(amount), 0) AS amount, COUNT(*) AS n FROM affiliate_commissions WHERE affiliate_id = ? AND paid_at IS NULL FOR UPDATE', [affiliateId])
    if (!Number(owed.n)) throw new LocalDataError('Nothing is owed to this partner.', 409)
    await connection.query('UPDATE affiliate_commissions SET paid_at = ?, payout_note = ? WHERE affiliate_id = ? AND paid_at IS NULL', [new Date(), note.trim() || null, affiliateId])
    return roundMoney(Number(owed.amount))
  })
}

// The partner's private page. Shop names are shown so partners can follow up with the shops they brought.
export async function getPartnerPage(token: string): Promise<PartnerPage | null> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null
  const pool = await getPool()
  const [[row]] = await pool.query<RowDataPacket[]>('SELECT * FROM affiliates WHERE token_hash = ?', [sha256(token)])
  if (!row) return null
  const affiliate = affiliateFromRow(row)
  const [shops] = await pool.query<RowDataPacket[]>(
    `SELECT shops.name, shops.created_at, subscriptions.status, subscriptions.current_period_end,
       (SELECT COALESCE(SUM(months), 0) FROM subscription_payments WHERE subscription_payments.shop_id = shops.id) AS paid_months,
       (SELECT COALESCE(SUM(amount), 0) FROM affiliate_commissions WHERE affiliate_commissions.shop_id = shops.id AND affiliate_id = ?) AS earned
     FROM shops JOIN subscriptions ON subscriptions.shop_id = shops.id WHERE shops.referred_by = ? ORDER BY shops.created_at DESC`,
    [affiliate.id, affiliate.id],
  )
  const [[totals]] = await pool.query<RowDataPacket[]>(
    'SELECT COALESCE(SUM(CASE WHEN paid_at IS NULL THEN amount END), 0) AS owed, COALESCE(SUM(CASE WHEN paid_at IS NOT NULL THEN amount END), 0) AS paid FROM affiliate_commissions WHERE affiliate_id = ?',
    [affiliate.id],
  )
  const [payouts] = await pool.query<RowDataPacket[]>(
    'SELECT paid_at, SUM(amount) AS amount, MAX(payout_note) AS note FROM affiliate_commissions WHERE affiliate_id = ? AND paid_at IS NOT NULL GROUP BY paid_at ORDER BY paid_at DESC LIMIT 24',
    [affiliate.id],
  )
  return {
    affiliate,
    referral_link: `${SITE_URL()}/?ref=${affiliate.code}`,
    signup_link: `${publicUrl('/signup')}?ref=${affiliate.code}`,
    shops: shops.map((shop) => ({ name: shop.name, signed_up: iso(shop.created_at), state: subscriptionState(shop.status, shop.current_period_end), paid_months: Number(shop.paid_months), earned: roundMoney(Number(shop.earned)) })),
    owed: roundMoney(Number(totals.owed)),
    paid: roundMoney(Number(totals.paid)),
    payouts: payouts.map((payout) => ({ paid_at: iso(payout.paid_at), amount: roundMoney(Number(payout.amount)), note: payout.note ?? null })),
  }
}
