import type { NextResponse } from 'next/server'

// The partner page lives on the website (getshopos.online/partners); its forms call the app's
// /api/partner/* routes. That origin is allowed by CORS; every other foreign origin is refused.
const partnerSites = () => (process.env.SHOPOS_PARTNER_SITE_ORIGINS ?? 'https://getshopos.online').split(',').map((origin) => origin.trim()).filter(Boolean)

export function allowedPartnerSite(request: Request) {
  const origin = request.headers.get('origin')
  return origin && partnerSites().includes(origin) ? origin : null
}

export function withPartnerCors(response: NextResponse, origin: string | null) {
  if (origin) {
    response.headers.set('Access-Control-Allow-Origin', origin)
    response.headers.set('Vary', 'Origin')
  }
  return response
}
