import { NextResponse } from 'next/server'
import { z } from 'zod'
import { emailField, nameField, passwordField } from '@/lib/auth-schemas'
import { isCountryCode, visitorCountry } from '@/lib/countries'
import { signUpShop } from '@/lib/local-auth'
import { blockCrossOrigin, clientInfo, errorResponse, isSelfHosted, jsonResponse, parseBody } from '@/lib/local-session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Public signup: creates a shop on a free trial and its owner account (unverified until the email link).
export async function POST(request: Request) {
  if (!isSelfHosted()) return jsonResponse(null, 'Not found.', 404)
  const blocked = await blockCrossOrigin(request)
  if (blocked) return blocked
  const body = await parseBody(request, z.object({
    shop_name: z.string().trim().min(1, 'Enter your shop name.').max(120),
    phone: z.string().trim().max(40).optional().default(''),
    full_name: nameField,
    email: emailField,
    password: passwordField,
    // A partner's referral code from the link the visitor came through (?ref=CODE).
    ref: z.string().trim().max(40).optional(),
    // ISO 3166-1 alpha-2, chosen on the form (pre-filled from the visitor's location).
    country: z.string().trim().toUpperCase().refine(isCountryCode, 'Choose your country.').optional(),
  }))
  if (body instanceof NextResponse) return body
  try {
    // Without a choice on the form: Cloudflare's guess from the visitor's IP address.
    const country = body.data.country ?? visitorCountry(request.headers)
    const user = await signUpShop({ ...body.data, country }, await clientInfo())
    return jsonResponse({ email: user.email }, null, 201)
  } catch (error) {
    return errorResponse(error, 'Unable to create your shop.')
  }
}
