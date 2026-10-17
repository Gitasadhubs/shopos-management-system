import { NextResponse } from 'next/server'
import { z } from 'zod'
import { emailField, nameField } from '@/lib/auth-schemas'
import { applyAffiliate } from '@/lib/local-affiliates'
import { blockCrossOrigin, clientInfo, errorResponse, isSelfHosted, jsonResponse, parseBody } from '@/lib/local-session'
import { allowedPartnerSite, withPartnerCors } from '@/lib/partner-cors'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Public: an application to the partner program, sent from the website's partner page
// (getshopos.online/partners, see lib/partner-cors.ts). An admin approves it in /admin/affiliates.
export async function OPTIONS(request: Request) {
  const origin = allowedPartnerSite(request)
  if (!origin) return new NextResponse(null, { status: 403 })
  return withPartnerCors(new NextResponse(null, { status: 204, headers: { 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Max-Age': '86400' } }), origin)
}

export async function POST(request: Request) {
  if (!isSelfHosted()) return jsonResponse(null, 'Not found.', 404)
  const site = allowedPartnerSite(request)
  if (!site) {
    const blocked = await blockCrossOrigin(request)
    if (blocked) return blocked
  }
  const body = await parseBody(request, z.object({
    name: nameField,
    email: emailField,
    phone: z.string().trim().min(7, 'Enter your phone or WhatsApp number.').max(40),
    city: z.string().trim().max(80).optional(),
    country: z.string().trim().max(80).optional(),
    payout_method: z.enum(['paypal', 'wise', 'payoneer', 'bank', 'mobile_wallet', 'other'], { message: 'Choose how you want to be paid.' }),
    payout_details: z.string().trim().min(5, 'Tell us where to send your earnings.').max(200),
    about: z.string().trim().max(500).optional(),
    agree: z.literal(true, { message: 'Please accept the partner terms.' }),
  }))
  if (body instanceof NextResponse) return withPartnerCors(body, site)
  try {
    return withPartnerCors(jsonResponse(await applyAffiliate(body.data, await clientInfo()), null, 201), site)
  } catch (error) {
    return withPartnerCors(errorResponse(error, 'Unable to send your application.'), site)
  }
}
