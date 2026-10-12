import { NextResponse } from 'next/server'
import { getBilling } from '@/lib/local-platform'
import { authorize, errorResponse, isSelfHosted, jsonResponse } from '@/lib/local-session'
import { can } from '@/lib/permissions'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Where shops send subscription payments. Set SHOPOS_PAY_* in the env file; unset or empty uses these defaults.
function paymentDetails() {
  const value = (name: string, fallback: string) => process.env[name] || fallback
  return {
    bank_name: value('SHOPOS_PAY_BANK_NAME', 'Meezan Bank'),
    account_title: value('SHOPOS_PAY_ACCOUNT_TITLE', 'ShopOS Technologies'),
    account_number: value('SHOPOS_PAY_ACCOUNT_NUMBER', '0123-4567890123'),
    iban: value('SHOPOS_PAY_IBAN', 'PK00MEZN0001234567890123'),
    wallet: value('SHOPOS_PAY_WALLET', '03044463268'),
    whatsapp: value('SHOPOS_PAY_WHATSAPP', '923044463268'),
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
