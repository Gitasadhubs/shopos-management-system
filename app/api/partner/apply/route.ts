import { NextResponse } from 'next/server'
import { z } from 'zod'
import { emailField, nameField } from '@/lib/auth-schemas'
import { applyAffiliate } from '@/lib/local-affiliates'
import { blockCrossOrigin, clientInfo, errorResponse, isSelfHosted, jsonResponse, parseBody } from '@/lib/local-session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Public: an application to the partner program. It comes from the app's own /partner page or from the
// partner page on the website (getshopos.online/partners), which is the one other origin allowed.
const partnerSites = () => (process.env.SHOPOS_PARTNER_SITE_ORIGINS ?? 'https://getshopos.online').split(',').map((origin) => origin.trim()).filter(Boolean)

function allowedSite(request: Request) {
  const origin = request.headers.get('origin')
  return origin && partnerSites().includes(origin) ? origin : null
}

function withCors(response: NextResponse, origin: string | null) {
  if (origin) {
    response.headers.set('Access-Control-Allow-Origin', origin)
    response.headers.set('Vary', 'Origin')
  }
  return response
}

export async function OPTIONS(request: Request) {
  const origin = allowedSite(request)
  if (!origin) return new NextResponse(null, { status: 403 })
  return withCors(new NextResponse(null, { status: 204, headers: { 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Max-Age': '86400' } }), origin)
}

export async function POST(request: Request) {
  if (!isSelfHosted()) return jsonResponse(null, 'Not found.', 404)
  const site = allowedSite(request)
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
  if (body instanceof NextResponse) return withCors(body, site)
  try {
    return withCors(jsonResponse(await applyAffiliate(body.data, await clientInfo()), null, 201), site)
  } catch (error) {
    return withCors(errorResponse(error, 'Unable to send your application.'), site)
  }
}
