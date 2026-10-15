import { NextResponse } from 'next/server'
import { getBilling } from '@/lib/local-platform'
import { authorize, errorResponse, isSelfHosted, jsonResponse } from '@/lib/local-session'
import { can } from '@/lib/permissions'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Where shops send subscription payments: SHOPOS_PAY_* in the env file. No defaults, so a shop is
// never shown an account that is not yours; anything unset is left off the Billing page.
function paymentDetails() {
  const value = (name: string) => process.env[name]?.trim() || ''
  return {
    bank_name: value('SHOPOS_PAY_BANK_NAME'),
    account_title: value('SHOPOS_PAY_ACCOUNT_TITLE'),
    account_number: value('SHOPOS_PAY_ACCOUNT_NUMBER'),
    iban: value('SHOPOS_PAY_IBAN'),
    wallet: value('SHOPOS_PAY_WALLET'),
    whatsapp: value('SHOPOS_PAY_WHATSAPP'),
  }
}

// The shop's plan, status and payment history. Owner only; readable even after the shop has expired.
export async function GET(request: Request) {
  if (!isSelfHosted()) return jsonResponse(null, 'Not found.', 404)
  try {
    const auth = await authorize(request)
    if (auth instanceof NextResponse) return auth
    if (!auth.user.shop || !can(auth.user.role, 'billing')) return jsonResponse(null, 'Your role does not allow this.', 403, 'forbidden')
    return jsonResponse({ ...(await getBilling(auth.user.shop.id)), payment_details: paymentDetails() })
  } catch (error) {
    return errorResponse(error, 'Unable to load billing.')
  }
}
