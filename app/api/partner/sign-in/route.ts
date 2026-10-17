import { NextResponse } from 'next/server'
import { z } from 'zod'
import { emailField } from '@/lib/auth-schemas'
import { sendPartnerSignInLink } from '@/lib/local-affiliates'
import { blockCrossOrigin, clientInfo, errorResponse, isSelfHosted, jsonResponse, parseBody } from '@/lib/local-session'
import { allowedPartnerSite, withPartnerCors } from '@/lib/partner-cors'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Public "Partner sign in" (getshopos.online/partners): emails a partner a new link to their private
// page. The answer is the same whether or not the email belongs to a partner.
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
  const body = await parseBody(request, z.object({ email: emailField }))
  if (body instanceof NextResponse) return withPartnerCors(body, site)
  try {
    await sendPartnerSignInLink(body.data.email, await clientInfo())
    return withPartnerCors(jsonResponse({ sent: true }), site)
  } catch (error) {
    return withPartnerCors(errorResponse(error, 'Unable to send the link.'), site)
  }
}
